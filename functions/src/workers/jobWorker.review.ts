import { getSystemConfigCached } from '../admin/systemConfig';
import { GEMINI_API_KEY } from '../config/runtime';
import { buildGeminiRejectedFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { validatePlannedPhotoReview } from '../media/photoPlanFile';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { Job } from '../../../shared/src/types';
import { productReferencePaths, ProviderResult } from './jobWorker.generation';
import {
  buildStoredReview,
  failGeneratedAttemptAfterReviewError,
  persistGeneratedAttempt,
} from './jobWorker.persistence';
import { downloadStorageImage } from './jobWorker.resources';

// Review step of the pipeline: build the Gemini review request, run it, and persist the attempt according
// to the verdict (approved -> completed, rejected -> pending with revised prompt or failed on last attempt).

export type ReviewResult = Awaited<ReturnType<typeof reviewGeneratedImageWithGemini>>;
type ReviewRequest = Parameters<typeof reviewGeneratedImageWithGemini>[0];
type StoredImage = Awaited<ReturnType<typeof downloadStorageImage>>;

export type AttemptContext = {
  claimedJob: Job;
  jobId: string;
  providerResult: ProviderResult;
  durationSeconds: number;
  generationAttempt: number;
  maxAutoReviewAttempts: number;
};

/** Automation jobs are reviewed against the exact prompt and charge the review to the automation budget. */
const buildAutomationReviewFields = async (job: Job, jobId: string, poseReference: StoredImage) => {
  if (!job.automationManaged || !job.automationJobId) return {};

  const automationReferencePaths = job.automationReferencePaths || [job.garmentFilePath];
  const productReferences = job.generationKind !== 'product'
    ? { productReferences: [poseReference, ...await Promise.all(automationReferencePaths.map(downloadStorageImage))] }
    : {};
  return {
    exactAutomationPrompt: true,
    automation: {
      id: job.automationJobId,
      key: `review:${jobId}:${job.claimToken}`,
      kind: 'review' as const,
      generation: { id: jobId, claimToken: job.claimToken },
    },
    ...productReferences,
  };
};

const downloadProductReferences = async (job: Job) => {
  if (job.generationKind !== 'product') return {};
  return { productReferences: await Promise.all(productReferencePaths(job).map(downloadStorageImage)) };
};

export const buildReviewRequest = async (
  { claimedJob: job, jobId, providerResult, generationAttempt, maxAutoReviewAttempts }: AttemptContext,
  signal: AbortSignal,
): Promise<ReviewRequest> => {
  const [poseReference, garmentReference] = await Promise.all([
    downloadStorageImage(job.poseImagePath),
    downloadStorageImage(job.garmentFilePath),
  ]);
  const systemConfig = await getSystemConfigCached();
  const automationFields = await buildAutomationReviewFields(job, jobId, poseReference);
  const productFields = await downloadProductReferences(job);

  return {
    ...automationFields,
    ...(job.imageEdit ? { imageEditInstructions: job.imageEdit.instructions, productReferences: [poseReference] } : {}),
    ...(job.photoTask ? { photoTask: job.photoTask } : {}),
    generationKind: job.generationKind,
    ...(job.productQuantity ? { productQuantity: job.productQuantity } : {}),
    ...productFields,
    apiKey: GEMINI_API_KEY.value(),
    model: systemConfig.geminiImageReviewModel,
    batchId: job.batchId,
    jobId,
    clientId: job.clientId,
    clientNameSnapshot: job.clientNameSnapshot,
    modelId: job.modelId,
    modelNameSnapshot: job.modelNameSnapshot,
    garmentId: job.garmentId,
    garmentName: job.garmentName,
    poseId: job.poseImageId,
    userUid: job.createdByUid,
    requestedPromptBase: job.requestedPromptBase || job.promptBase,
    ...(job.promptFormat ? { promptFormat: job.promptFormat } : {}),
    promptBase: job.promptBase,
    finalPrompt: job.finalPrompt,
    modelIdentityTraitsSnapshot: job.modelIdentityTraitsSnapshot || null,
    attemptNumber: generationAttempt,
    maxAttempts: maxAutoReviewAttempts,
    poseReference,
    garmentReference,
    generatedImage: {
      bytes: providerResult.imageBytes,
      mimeType: providerResult.contentType,
    },
    signal,
  };
};

/**
 * Runs the Gemini review and, for planned photos, the final-file validation (which may downgrade the verdict).
 * Any error in either step persists the generated attempt, image and cost included, through
 * failGeneratedAttemptAfterReviewError and returns null, so the caller must stop.
 */
export const reviewGeneratedAttempt = async (
  attempt: AttemptContext,
  signal: AbortSignal,
): Promise<ReviewResult | null> => {
  try {
    const request = await buildReviewRequest(attempt, signal);
    const review = await reviewGeneratedImageWithGemini(request);
    const { photoTask } = attempt.claimedJob;
    if (photoTask) await validatePlannedPhotoReview(attempt.providerResult.imageBytes, photoTask, review);
    return review;
  } catch (reviewError) {
    await failGeneratedAttemptAfterReviewError({
      claimedJob: attempt.claimedJob,
      providerResult: attempt.providerResult,
      durationSeconds: attempt.durationSeconds,
      generationAttempt: attempt.generationAttempt,
      error: reviewError,
    });
    return null;
  }
};

const buildRejectionFailureInfo = (attempt: AttemptContext, review: ReviewResult, retryable: boolean) =>
  buildGeminiRejectedFailureInfo({
    summary: review.summary,
    attemptNumber: attempt.generationAttempt,
    maxAttempts: attempt.maxAutoReviewAttempts,
    provider: attempt.providerResult.provider,
    requestId: attempt.providerResult.requestId,
    retryable,
    raw: {
      criteria: review.criteria,
      revisedPrompt: review.revisedPrompt,
    },
  });

/**
 * Persists the reviewed attempt: approved -> completed; rejected with attempts left -> pending with Gemini's
 * revised prompt; rejected on the last attempt -> failed.
 */
export const persistReviewOutcome = async (attempt: AttemptContext, review: ReviewResult): Promise<void> => {
  const storedAttempt = {
    claimedJob: attempt.claimedJob,
    providerResult: attempt.providerResult,
    durationSeconds: attempt.durationSeconds,
    generationAttempt: attempt.generationAttempt,
    autoReview: buildStoredReview(review, attempt.generationAttempt),
  };

  if (review.verdict === 'approved') {
    await persistGeneratedAttempt({ ...storedAttempt, nextStatus: 'completed', failureInfo: null, lastError: null });
    return;
  }

  if (attempt.generationAttempt < attempt.maxAutoReviewAttempts) {
    const failureInfo = buildRejectionFailureInfo(attempt, review, true);
    await persistGeneratedAttempt({
      ...storedAttempt,
      nextStatus: 'pending',
      failureInfo,
      nextPromptBase: review.revisedPrompt || undefined,
      lastError: toFailureSummary(failureInfo),
    });
    return;
  }

  const failureInfo = buildRejectionFailureInfo(attempt, review, false);
  await persistGeneratedAttempt({
    ...storedAttempt,
    nextStatus: 'failed',
    failureInfo,
    lastError: toFailureSummary(failureInfo),
  });
};
