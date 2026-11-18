import { reserveAutomationOperation, settleAutomationOperation } from '../automation/budget';
import { FAL_KEY } from '../config/runtime';
import { estimateGenerationHold } from '../costs/generationEstimates';
import { compressGeneratedImageIfNeeded } from '../media/compressGeneratedImage';
import { neutralWhiteBackground } from '../media/neutralWhiteBackground';
import { generateWithProvider } from '../providers';
import { normalizeProviderImageConfig, summarizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { Job, Provider } from '../../../shared/src/types';
import { createLog } from './jobWorker.claims';
import { downloadStorageImage, getSignedUrl } from './jobWorker.resources';

// Provider step of the pipeline: decide where the image comes from (existing output, reused reference or a
// real provider call) and wrap paid generations in the automation budget reservation.

export type ProviderResult = Awaited<ReturnType<typeof generateWithProvider>>;
export type NormalizedImageConfig = ReturnType<typeof normalizeProviderImageConfig>;
export type InputImageUrls = { poseImageUrl: string; garmentImageUrl: string };

type ProviderStepInput = {
  job: Job;
  jobId: string;
  imageConfig: NormalizedImageConfig;
  inputUrls: InputImageUrls;
  signal: AbortSignal;
};

/**
 * Automation job whose output was stored but whose Gemini review never finished: review again, never regenerate.
 * Shared by the worker (which downloads currentOutput) and persistence (which rewrites outputs/{currentOutputId}),
 * so both must be present; otherwise the job generates a new output.
 */
export const isReviewResume = (job: Job): boolean =>
  Boolean(job.automationManaged && job.automationReviewPending && job.currentOutput && job.currentOutputId);

/** Planned photos with `reference` composition reuse the uploaded garment photo instead of generating one. */
export const isReferenceReuse = (job: Job): boolean => job.photoTask?.composition === 'reference';

/** Product jobs use their product references (or the pose image as fallback). */
export const productReferencePaths = (job: Job): string[] => job.productReferencePaths || [job.poseImagePath];

/** Number of reference images sent to the provider: product references, or pose + garment. */
export const countProviderReferences = (job: Job): number =>
  job.imageEdit ? 1 : job.generationKind === 'product' ? productReferencePaths(job).length : 2;

/** A resumed review keeps the attempt number of the output it reviews; anything else is a new attempt. */
export const nextGenerationAttempt = (job: Job): number => {
  if (isReviewResume(job)) return job.generationAttemptCount || 1;
  return (job.generationAttemptCount || 0) + 1;
};

export const signInputImages = async (job: Job): Promise<InputImageUrls> => {
  const [poseImageUrl, garmentImageUrl] = await Promise.all([
    getSignedUrl(job.poseImagePath),
    getSignedUrl(job.garmentFilePath),
  ]);
  return { poseImageUrl, garmentImageUrl };
};

export const logProviderStepStart = async (jobId: string, job: Job, imageConfig: NormalizedImageConfig) => {
  const resumeReview = isReviewResume(job);
  await createLog(jobId, {
    type: resumeReview ? 'quality_review' : 'provider_request',
    level: 'info',
    message: resumeReview
      ? 'Se reanudó la revisión del output existente sin otra generación.'
      : 'Se enviaron los insumos al proveedor.',
    payload: {
      provider: job.provider,
      aspectRatio: imageConfig.aspectRatio,
      imageConfig: imageConfig.imageConfig,
      imageConfigSummary: summarizeProviderImageConfig(imageConfig.imageConfig),
      poseImagePath: job.poseImagePath,
      garmentFilePath: job.garmentFilePath,
      garmentPhotoId: job.garmentPhotoId || null,
      garmentPhotoFileName: job.garmentPhotoFileName || null,
      garmentView: job.garmentView || null,
      requestedPromptBase: job.requestedPromptBase || job.promptBase,
      ...(job.promptFormat ? { promptFormat: job.promptFormat } : {}),
      promptBase: job.promptBase,
    },
  });
};

type GenerationBudget = {
  automationJobId: string;
  operationId: string;
  hold: ReturnType<typeof estimateGenerationHold>;
};

/**
 * Reserves the automation budget for a paid generation. Returns null when nothing is paid (resumed review,
 * reused reference) or the job is not automation-managed. Throws AutomationBudgetError when exhausted.
 */
const reserveGenerationBudget = async (
  job: Job,
  jobId: string,
  imageConfig: NormalizedImageConfig,
): Promise<GenerationBudget | null> => {
  const hold = estimateGenerationHold(job.provider, imageConfig.imageConfig, countProviderReferences(job));
  const paidGeneration = !isReviewResume(job) && !isReferenceReuse(job);
  if (!paidGeneration || !job.automationManaged || !job.automationJobId) return null;

  const operationId = await reserveAutomationOperation(
    job.automationJobId,
    `generation:${jobId}:${job.claimToken}`,
    'generation',
    hold.holdUsd,
    { id: jobId, claimToken: job.claimToken },
  );
  return { automationJobId: job.automationJobId, operationId, hold };
};

const settleGenerationBudgetAfterSuccess = (budget: GenerationBudget) =>
  settleAutomationOperation(budget.automationJobId, budget.operationId, budget.hold.estimateUsd, budget.hold.fixed);

const releaseGenerationBudgetAfterFailure = (budget: GenerationBudget) =>
  settleAutomationOperation(budget.automationJobId, budget.operationId, null);

const loadOutputPendingReview = async (job: Job): Promise<ProviderResult> => {
  const output = job.currentOutput!;
  const { bytes } = await downloadStorageImage(output.resultImagePath);
  return {
    provider: output.provider,
    imageBytes: bytes,
    contentType: output.contentType,
    remoteUrl: output.remoteUrl,
    requestId: output.requestId,
    responseSummary: output.providerResponseSummary || {},
  };
};

const reuseReferencePhoto = async (job: Job): Promise<ProviderResult> => {
  const { bytes } = await downloadStorageImage(job.garmentFilePath);
  return {
    provider: job.provider,
    imageBytes: bytes,
    contentType: 'image/jpeg',
    remoteUrl: null,
    requestId: null,
    responseSummary: { reusedReference: true },
  };
};

const generateWithJobProvider = async ({ job, imageConfig, inputUrls, signal }: ProviderStepInput) => {
  const productReferences = job.imageEdit
    ? { referenceImageUrls: [inputUrls.poseImageUrl] }
    : job.generationKind === 'product'
    ? { referenceImageUrls: await Promise.all(productReferencePaths(job).map(getSignedUrl)) }
    : {};
  return generateWithProvider(
    job.provider as Provider,
    {
      poseImageUrl: inputUrls.poseImageUrl,
      garmentImageUrl: inputUrls.garmentImageUrl,
      ...productReferences,
      prompt: job.finalPrompt,
      imageConfig: imageConfig.imageConfig,
      signal,
    },
    { falKey: FAL_KEY.value() },
  );
};

const obtainImage = (input: ProviderStepInput): Promise<ProviderResult> => {
  if (isReviewResume(input.job)) return loadOutputPendingReview(input.job);
  if (isReferenceReuse(input.job)) return reuseReferencePhoto(input.job);
  return generateWithJobProvider(input);
};

/**
 * Gets the image to review. Paid generations reserve budget first, settle the estimate on success and
 * release the hold (settle with null) on failure before rethrowing.
 */
export const obtainProviderResultWithinBudget = async (input: ProviderStepInput): Promise<ProviderResult> => {
  const budget = await reserveGenerationBudget(input.job, input.jobId, input.imageConfig);
  let providerResult: ProviderResult;
  try {
    providerResult = await obtainImage(input);
  } catch (error) {
    if (budget) await releaseGenerationBudgetAfterFailure(budget);
    throw error;
  }
  if (budget) await settleGenerationBudgetAfterSuccess(budget);
  return providerResult;
};

const correctBackgroundIfRequested = (job: Job, bytes: Buffer) => {
  if (!job.photoTask?.backgroundCorrection) return Promise.resolve({ bytes, correctedPixels: 0 });
  return neutralWhiteBackground(bytes);
};

/**
 * Planned photos are corrected and compressed to their final file before review, so Gemini and the final
 * validation see exactly what will be stored. Mutates `providerResult` in place.
 */
export const preparePlannedPhoto = async (
  job: Job,
  providerResult: ProviderResult,
  imageConfig: NormalizedImageConfig,
): Promise<void> => {
  const corrected = await correctBackgroundIfRequested(job, providerResult.imageBytes);
  providerResult.responseSummary = {
    ...providerResult.responseSummary,
    backgroundCorrectedPixels: corrected.correctedPixels,
  };
  providerResult.preparedPhoto = await compressGeneratedImageIfNeeded({
    bytes: corrected.bytes,
    contentType: providerResult.contentType,
    photoProfile: job.photoProfile,
    imageConfig: imageConfig.imageConfig,
    plannedPhoto: true,
    syntheticPerformer: job.photoTask!.syntheticPerformer,
  });
  providerResult.imageBytes = providerResult.preparedPhoto.bytes;
  providerResult.contentType = providerResult.preparedPhoto.contentType;
};
