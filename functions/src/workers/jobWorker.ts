import { neutralWhiteBackground } from '../media/neutralWhiteBackground';
import { validatePlannedPhotoReview } from '../media/photoPlanFile';
import { withManglarJobBudget } from '../manglar/budget';
import { AutomationBudgetError, reserveAutomationOperation, settleAutomationOperation, pauseAutomationGeneration } from '../automation/budget';
import { estimateGenerationHold } from '../costs/generationEstimates';
import { randomUUID } from 'node:crypto';
import { compressGeneratedImageIfNeeded } from '../media/compressGeneratedImage';
import { Provider } from '../../../shared/src/types';
import { normalizeProviderImageConfig, summarizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { generateWithProvider } from '../providers';
import {
  FAL_KEY,
  GEMINI_API_KEY,
  getJobAutoReviewMaxAttempts,
  getJobTimeoutMs,
} from '../config/runtime';
import { getSystemConfigCached } from '../admin/systemConfig';
import {
  buildGeminiRejectedFailureInfo,
  toFailureSummary,
} from '../errors/jobFailure';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { claimJob, createLog, isClaimStillActive } from './jobWorker.claims';
import {
  buildStoredReview,
  failGeneratedAttemptAfterReviewError,
  persistGeneratedAttempt,
  retryOrFailJob,
} from './jobWorker.persistence';
import { requeueExpiredJobs } from './jobWorker.requeue';
import { downloadStorageImage, getSignedUrl } from './jobWorker.resources';

// Job processing pipeline: claim -> provider -> Gemini review -> persist. The pieces live in the
// neighbouring jobWorker.*.ts modules; requeueExpiredJobs is re-exported to keep the public surface.
export { requeueExpiredJobs } from './jobWorker.requeue';

const processJobCore = async (
  jobId: string,
  source: 'create' | 'requeue',
  options?: { skipBacklogSweep?: boolean },
): Promise<void> => {
  if (!options?.skipBacklogSweep) {
    await requeueExpiredJobs();
  }

  const workerId = `worker:${source}:${randomUUID()}`;
  const claimedJob = await claimJob(jobId, workerId);
  if (!claimedJob) {
    return;
  }

  await createLog(jobId, {
    type: 'claim',
    level: 'info',
    message: 'Trabajo reclamado por el worker.',
    payload: {
      workerId,
      claimToken: claimedJob.claimToken,
      source,
    },
  });

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), getJobTimeoutMs());

  try {
    const normalizedImageConfig = normalizeProviderImageConfig(
      claimedJob.provider as Provider,
      claimedJob.imageConfig,
      claimedJob.aspectRatio,
    );
    const [poseImageUrl, garmentImageUrl] = await Promise.all([
      getSignedUrl(claimedJob.poseImagePath),
      getSignedUrl(claimedJob.garmentFilePath),
    ]);

    const resumeReview = Boolean(claimedJob.automationManaged && claimedJob.automationReviewPending && claimedJob.currentOutput);
    await createLog(jobId, {
      type: resumeReview ? 'quality_review' : 'provider_request',
      level: 'info',
      message: resumeReview ? 'Se reanudó la revisión del output existente sin otra generación.' : 'Se enviaron los insumos al proveedor.',
      payload: {
        provider: claimedJob.provider,
        aspectRatio: normalizedImageConfig.aspectRatio,
        imageConfig: normalizedImageConfig.imageConfig,
        imageConfigSummary: summarizeProviderImageConfig(normalizedImageConfig.imageConfig),
        poseImagePath: claimedJob.poseImagePath,
        garmentFilePath: claimedJob.garmentFilePath,
        garmentPhotoId: claimedJob.garmentPhotoId || null,
        garmentPhotoFileName: claimedJob.garmentPhotoFileName || null,
        garmentView: claimedJob.garmentView || null,
        requestedPromptBase: claimedJob.requestedPromptBase || claimedJob.promptBase,
        ...(claimedJob.promptFormat ? { promptFormat: claimedJob.promptFormat } : {}),
        promptBase: claimedJob.promptBase,
      },
    });

    const generationHold = estimateGenerationHold(claimedJob.provider, normalizedImageConfig.imageConfig, claimedJob.generationKind === 'product' ? (claimedJob.productReferencePaths || [claimedJob.poseImagePath]).length : 2);
    const budgetOperation = !resumeReview && claimedJob.photoTask?.composition !== 'reference' && claimedJob.automationManaged && claimedJob.automationJobId
      ? await reserveAutomationOperation(claimedJob.automationJobId, `generation:${jobId}:${claimedJob.claimToken}`, 'generation', generationHold.holdUsd, { id: jobId, claimToken: claimedJob.claimToken }) : null;
    let providerResult: Awaited<ReturnType<typeof generateWithProvider>>;
    try {
    providerResult = resumeReview ? {
      provider: claimedJob.currentOutput!.provider, imageBytes: (await downloadStorageImage(claimedJob.currentOutput!.resultImagePath)).bytes,
      contentType: claimedJob.currentOutput!.contentType, remoteUrl: claimedJob.currentOutput!.remoteUrl,
      requestId: claimedJob.currentOutput!.requestId, responseSummary: claimedJob.currentOutput!.providerResponseSummary || {},
    } : claimedJob.photoTask?.composition === 'reference' ? { provider: claimedJob.provider, imageBytes: (await downloadStorageImage(claimedJob.garmentFilePath)).bytes, contentType: 'image/jpeg', remoteUrl: null, requestId: null, responseSummary: { reusedReference: true } } : await generateWithProvider(
      claimedJob.provider as Provider,
      {
        poseImageUrl,
        garmentImageUrl,
        ...(claimedJob.generationKind === 'product' ? { referenceImageUrls: await Promise.all((claimedJob.productReferencePaths || [claimedJob.poseImagePath]).map(getSignedUrl)) } : {}),
        prompt: claimedJob.finalPrompt,
        imageConfig: normalizedImageConfig.imageConfig,
        signal: controller.signal,
      },
      {
        falKey: FAL_KEY.value(),
      },
    );

    } catch (error) {
      if (budgetOperation) await settleAutomationOperation(claimedJob.automationJobId!, budgetOperation, null);
      throw error;
    }
    if (budgetOperation) await settleAutomationOperation(claimedJob.automationJobId!, budgetOperation, generationHold.estimateUsd, generationHold.fixed);

    if (!(await isClaimStillActive(jobId, claimedJob.claimToken))) {
      return;
    }

    const startedAtMs = toMillis(claimedJob.lastAttemptStartedAt) || Date.now();
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
    const generationAttempt = resumeReview ? claimedJob.generationAttemptCount || 1 : (claimedJob.generationAttemptCount || 0) + 1;
    const maxAutoReviewAttempts = claimedJob.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts();

    if (claimedJob.photoTask && !resumeReview) {
      const corrected = claimedJob.photoTask.backgroundCorrection ? await neutralWhiteBackground(providerResult.imageBytes) : { bytes: providerResult.imageBytes, correctedPixels: 0 };
      providerResult.responseSummary = { ...providerResult.responseSummary, backgroundCorrectedPixels: corrected.correctedPixels };
      providerResult.preparedPhoto = await compressGeneratedImageIfNeeded({ bytes: corrected.bytes, contentType: providerResult.contentType,
        photoProfile: claimedJob.photoProfile, imageConfig: normalizedImageConfig.imageConfig, plannedPhoto: true, syntheticPerformer: claimedJob.photoTask.syntheticPerformer });
      providerResult.imageBytes = providerResult.preparedPhoto.bytes;
      providerResult.contentType = providerResult.preparedPhoto.contentType;
    }
    let review: Awaited<ReturnType<typeof reviewGeneratedImageWithGemini>>;
    try {
      const [poseReference, garmentReference] = await Promise.all([
        downloadStorageImage(claimedJob.poseImagePath),
        downloadStorageImage(claimedJob.garmentFilePath),
      ]);

      const jobSystemConfig = await getSystemConfigCached();
      review = await reviewGeneratedImageWithGemini({
        ...(claimedJob.automationManaged && claimedJob.automationJobId ? {
          exactAutomationPrompt: true,
          automation: { id: claimedJob.automationJobId, key: `review:${jobId}:${claimedJob.claimToken}`, kind: 'review' as const, generation: { id: jobId, claimToken: claimedJob.claimToken } },
          ...(claimedJob.generationKind !== 'product' ? { productReferences: [poseReference, ...await Promise.all((claimedJob.automationReferencePaths || [claimedJob.garmentFilePath]).map(downloadStorageImage))] } : {}),
        } : {}),
        ...(claimedJob.photoTask ? { photoTask: claimedJob.photoTask } : {}),
        generationKind: claimedJob.generationKind,
        ...(claimedJob.generationKind === 'product' ? { productReferences: await Promise.all((claimedJob.productReferencePaths || [claimedJob.poseImagePath]).map(downloadStorageImage)) } : {}),
        apiKey: GEMINI_API_KEY.value(),
        model: jobSystemConfig.geminiImageReviewModel,
        batchId: claimedJob.batchId,
        jobId,
        clientId: claimedJob.clientId,
        clientNameSnapshot: claimedJob.clientNameSnapshot,
        modelId: claimedJob.modelId,
        modelNameSnapshot: claimedJob.modelNameSnapshot,
        garmentId: claimedJob.garmentId,
        garmentName: claimedJob.garmentName,
        poseId: claimedJob.poseImageId,
        userUid: claimedJob.createdByUid,
        requestedPromptBase: claimedJob.requestedPromptBase || claimedJob.promptBase,
        ...(claimedJob.promptFormat ? { promptFormat: claimedJob.promptFormat } : {}),
        promptBase: claimedJob.promptBase,
        finalPrompt: claimedJob.finalPrompt,
        modelIdentityTraitsSnapshot: claimedJob.modelIdentityTraitsSnapshot || null,
        attemptNumber: generationAttempt,
        maxAttempts: maxAutoReviewAttempts,
        poseReference,
        garmentReference,
        generatedImage: {
          bytes: providerResult.imageBytes,
          mimeType: providerResult.contentType,
        },
        signal: controller.signal,
      });

    } catch (reviewError) {
      await failGeneratedAttemptAfterReviewError({
        claimedJob,
        providerResult,
        durationSeconds,
        generationAttempt,
        error: reviewError,
      });
      return;
    }
    if (claimedJob.photoTask) await validatePlannedPhotoReview(providerResult.imageBytes, claimedJob.photoTask, review);
    const storedReview = buildStoredReview(review, generationAttempt);

    if (review.verdict === 'approved') {
      await persistGeneratedAttempt({
        claimedJob,
        providerResult,
        durationSeconds,
        generationAttempt,
        nextStatus: 'completed',
        autoReview: storedReview,
        failureInfo: null,
        lastError: null,
      });
      return;
    }

    if (generationAttempt < maxAutoReviewAttempts) {
      const failureInfo = buildGeminiRejectedFailureInfo({
        summary: review.summary,
        attemptNumber: generationAttempt,
        maxAttempts: maxAutoReviewAttempts,
        provider: providerResult.provider,
        requestId: providerResult.requestId,
        retryable: true,
        raw: {
          criteria: review.criteria,
          revisedPrompt: review.revisedPrompt,
        },
      });
      await persistGeneratedAttempt({
        claimedJob,
        providerResult,
        durationSeconds,
        generationAttempt,
        nextStatus: 'pending',
        autoReview: storedReview,
        failureInfo,
        nextPromptBase: review.revisedPrompt || undefined,
        lastError: toFailureSummary(failureInfo),
      });
      return;
    }

    const failureInfo = buildGeminiRejectedFailureInfo({
      summary: review.summary,
      attemptNumber: generationAttempt,
      maxAttempts: maxAutoReviewAttempts,
      provider: providerResult.provider,
      requestId: providerResult.requestId,
      retryable: false,
      raw: {
        criteria: review.criteria,
        revisedPrompt: review.revisedPrompt,
      },
    });
    await persistGeneratedAttempt({
      claimedJob,
      providerResult,
      durationSeconds,
      generationAttempt,
      nextStatus: 'failed',
      autoReview: storedReview,
      failureInfo,
      lastError: toFailureSummary(failureInfo),
    });

  } catch (error) {
    if (error instanceof AutomationBudgetError && claimedJob.automationManaged) await pauseAutomationGeneration(claimedJob, error.message);
    else await retryOrFailJob(claimedJob, error);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const processJob: typeof processJobCore = (jobId, source, options) =>
  withManglarJobBudget(jobId, () => processJobCore(jobId, source, options));
