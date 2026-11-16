import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { AutomationBudgetError } from '../automation/budget';
import { compressGeneratedImageIfNeeded } from '../media/compressGeneratedImage';
import { createGeneratedThumbnail } from '../media/generatedThumbnail';
import { getProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { Job, JobAutoReview, JobOutput, Provider } from '../../../shared/src/types';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { generateWithProvider } from '../providers';
import { getSystemConfigCached } from '../admin/systemConfig';
import {
  buildJobFailureInfo,
  serializeError,
  toFailureSummary,
  withFailureOutputId,
} from '../errors/jobFailure';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { buildAutoReviewSignalsPatch } from '../review/reviewSignals';
import { createLog } from './jobWorker.claims';
import { countProviderReferences } from './jobWorker.generation';
import { buildAutomaticRetryPromptPatch, extensionForContentType } from './jobWorker.helpers';
import { bucket, db } from './jobWorker.resources';

export const buildStoredReview = (
  review: Awaited<ReturnType<typeof reviewGeneratedImageWithGemini>>,
  attemptNumber: number,
): JobAutoReview => ({
  ...(review.photoValidation ? { photoValidation: review.photoValidation } : {}),
  model: review.model,
  verdict: review.verdict,
  summary: review.summary,
  reviewPrompt: review.reviewPrompt,
  revisedPrompt: review.revisedPrompt,
  criteria: review.criteria,
  marketplaceData: review.marketplaceData,
  attemptNumber,
  reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
});

type ProviderResult = Awaited<ReturnType<typeof generateWithProvider>>;
type NormalizedImageConfig = ReturnType<typeof normalizeProviderImageConfig>;
type StoredImage = { bytes: Buffer; contentType: string; storedImage?: JobOutput['storedImage'] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobUpdate = Record<string, any>;

type PersistAttemptInput = {
  claimedJob: Job;
  providerResult: ProviderResult;
  durationSeconds: number | null;
  generationAttempt: number;
  nextStatus: Job['status'];
  autoReview: JobAutoReview | null;
  failureInfo: Job['failureInfo'] | null;
  lastError: string | null;
  nextPromptBase?: string;
  automationGate?: Job['automationGate'];
};

/** Where the attempt's image lives and what it costs. A reviewed existing output keeps its file and cost. */
type AttemptImage = {
  storedImage: StoredImage;
  destinationPath: string;
  thumbnailPath: string | null;
  /** Amount added to the job/provider cost counters for this attempt. */
  chargedCostUsd: number;
};

/**
 * An automation job whose review is pending updates its current output in place: no new file, output or
 * cost. Note: keyed on currentOutputId, while the worker's resume check uses currentOutput.
 */
const reusesExistingOutput = (job: Job): boolean =>
  Boolean(job.automationManaged && job.automationReviewPending && job.currentOutputId);

const generatedImagePath = (job: Job, jobId: string, outputId: string, contentType: string): string =>
  `generated/${job.clientId}/${job.batchId}/${jobId}/${outputId}.${extensionForContentType(contentType)}`;

/** Paid generations cost the provider price; reused outputs and reused reference photos cost nothing. */
const generationCostUsd = (job: Job, imageConfig: NormalizedImageConfig): number => {
  if (job.photoTask?.composition === 'reference') return 0;
  return getProviderCostUsd(job.provider as Provider, imageConfig.imageConfig, countProviderReferences(job));
};

const existingOutputImage = (job: Job, providerResult: ProviderResult): AttemptImage => ({
  storedImage: {
    bytes: providerResult.imageBytes,
    contentType: job.currentOutput!.contentType,
    storedImage: job.currentOutput!.storedImage,
  },
  destinationPath: job.currentOutput!.resultImagePath,
  thumbnailPath: null,
  chargedCostUsd: 0,
});

/** Compresses (unless already prepared as a planned photo), uploads the image and creates its thumbnail. */
const storeNewOutputImage = async (
  job: Job,
  jobId: string,
  outputId: string,
  providerResult: ProviderResult,
  imageConfig: NormalizedImageConfig,
): Promise<AttemptImage> => {
  const storedImage = providerResult.preparedPhoto || await compressGeneratedImageIfNeeded({
    bytes: providerResult.imageBytes,
    contentType: providerResult.contentType,
    photoProfile: job.photoProfile,
    imageConfig: imageConfig.imageConfig,
  });
  const destinationPath = generatedImagePath(job, jobId, outputId, storedImage.contentType);
  await bucket.file(destinationPath).save(storedImage.bytes, {
    resumable: false,
    metadata: {
      contentType: storedImage.contentType,
      cacheControl: 'private, max-age=31536000',
    },
  });
  const thumbnailPath = await createGeneratedThumbnail({
    bucket,
    bytes: storedImage.bytes,
    resultImagePath: destinationPath,
  });
  return { storedImage, destinationPath, thumbnailPath, chargedCostUsd: generationCostUsd(job, imageConfig) };
};

const buildOutputDocument = ({
  input,
  jobId,
  outputId,
  imageConfig,
  image,
  persistedFailureInfo,
  reuseOutput,
}: {
  input: PersistAttemptInput;
  jobId: string;
  outputId: string;
  imageConfig: NormalizedImageConfig;
  image: AttemptImage;
  persistedFailureInfo: Job['failureInfo'] | null;
  reuseOutput: boolean;
}): JobOutput => {
  const { claimedJob, providerResult, autoReview } = input;
  const existing = reuseOutput ? claimedJob.currentOutput! : null;
  const output: JobOutput = {
    ...(autoReview?.photoValidation ? { photoValidation: autoReview.photoValidation } : {}),
    id: outputId,
    jobId,
    batchId: claimedJob.batchId,
    clientId: claimedJob.clientId,
    clientNameSnapshot: claimedJob.clientNameSnapshot,
    modelId: claimedJob.modelId,
    modelNameSnapshot: claimedJob.modelNameSnapshot,
    poseImageId: claimedJob.poseImageId,
    garmentId: claimedJob.garmentId,
    garmentName: claimedJob.garmentName,
    provider: providerResult.provider,
    requestedPromptBase: claimedJob.requestedPromptBase || claimedJob.promptBase,
    ...(claimedJob.promptFormat ? { promptFormat: claimedJob.promptFormat } : {}),
    promptBase: claimedJob.promptBase,
    finalPrompt: claimedJob.finalPrompt,
    aspectRatio: imageConfig.aspectRatio,
    imageConfig: imageConfig.imageConfig,
    ...(claimedJob.photoProfile ? { photoProfile: claimedJob.photoProfile } : {}),
    ...(image.storedImage.storedImage ? { storedImage: image.storedImage.storedImage } : {}),
    resultImagePath: image.destinationPath,
    ...(image.thumbnailPath ? { thumbnailPath: image.thumbnailPath } : {}),
    contentType: image.storedImage.contentType,
    remoteUrl: providerResult.remoteUrl,
    requestId: providerResult.requestId,
    costUsd: existing ? existing.costUsd : image.chargedCostUsd,
    durationSeconds: existing ? existing.durationSeconds : input.durationSeconds,
    providerResponseSummary: providerResult.responseSummary,
    generationAttempt: input.generationAttempt,
    autoReview,
    failureInfo: persistedFailureInfo,
    isCurrent: true,
    createdAt: existing ? existing.createdAt : admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!existing) return output;

  // The existing output wins over every rebuilt field; only the review result and current flag change.
  return { ...output, ...existing, autoReview, failureInfo: persistedFailureInfo, isCurrent: true };
};

/** Automation jobs track whether the review is still pending; a failed review (not budget) uses a retry. */
const buildAutomationReviewState = (input: PersistAttemptInput): JobUpdate => {
  if (!input.claimedJob.automationManaged) return {};
  const reviewMissing = input.autoReview === null;
  const consumesRetry = reviewMissing && input.automationGate !== 'budget';
  return {
    automationReviewPending: reviewMissing,
    ...(consumesRetry ? { retryCount: (input.claimedJob.retryCount || 0) + 1 } : {}),
  };
};

const buildJobUpdate = ({
  input,
  outputId,
  currentOutput,
  imageConfig,
  image,
  persistedFailureInfo,
  reuseOutput,
}: {
  input: PersistAttemptInput;
  outputId: string;
  currentOutput: JobOutput;
  imageConfig: NormalizedImageConfig;
  image: AttemptImage;
  persistedFailureInfo: Job['failureInfo'] | null;
  reuseOutput: boolean;
}): JobUpdate => {
  const { claimedJob, providerResult, nextStatus, autoReview, automationGate } = input;
  const { increment, serverTimestamp } = admin.firestore.FieldValue;
  const newOutputs = reuseOutput ? 0 : 1;
  const addedDurationSeconds = reuseOutput ? 0 : input.durationSeconds || 0;
  const providerUsage = `providerUsage.${providerResult.provider}`;

  const update: JobUpdate = {
    ...(automationGate !== undefined ? { automationGate } : {}),
    ...buildAutomationReviewState(input),
    provider: providerResult.provider,
    aspectRatio: imageConfig.aspectRatio,
    imageConfig: imageConfig.imageConfig,
    status: nextStatus,
    queuePriority: nextStatus === 'pending' ? 1 : 0,
    claimToken: null,
    claimedBy: null,
    claimExpiresAt: null,
    timeoutAt: null,
    completedAt: nextStatus === 'completed' ? serverTimestamp() : null,
    ...(!reuseOutput ? { latestOutputCreatedAt: serverTimestamp() } : {}),
    currentOutputId: outputId,
    currentOutput,
    completedOutputCount: increment(newOutputs),
    totalCostUsd: increment(image.chargedCostUsd),
    totalDurationSeconds: increment(addedDurationSeconds),
    [`${providerUsage}.completedOutputs`]: increment(newOutputs),
    [`${providerUsage}.totalCostUsd`]: increment(image.chargedCostUsd),
    [`${providerUsage}.totalDurationSeconds`]: increment(addedDurationSeconds),
    generationAttemptCount: input.generationAttempt,
    latestAutoReview: autoReview,
    failureInfo: persistedFailureInfo,
    updatedAt: serverTimestamp(),
    lastError: input.lastError,
    ...(autoReview ? buildAutoReviewSignalsPatch(claimedJob, autoReview.verdict) : {}),
  };

  if (nextStatus === 'completed') {
    update['traceability.lastCompletedAt'] = serverTimestamp();
  }
  if (nextStatus === 'pending' || nextStatus === 'failed') {
    update.startedAt = null;
  }
  if (nextStatus === 'pending') {
    Object.assign(update, buildAutomaticRetryPromptPatch(claimedJob, input.nextPromptBase));
  }
  return update;
};

const describeReviewVerdict = (verdict: JobAutoReview['verdict'], nextStatus: Job['status']) => {
  if (verdict === 'approved') return { level: 'info' as const, message: 'Gemini aprobó la imagen generada.' };
  if (nextStatus === 'pending') {
    return { level: 'warn' as const, message: 'Gemini rechazó la imagen y programó un nuevo intento.' };
  }
  return { level: 'error' as const, message: 'Gemini rechazó la imagen y se agotó el máximo de intentos.' };
};

const writeAttemptLogs = (
  transaction: FirebaseFirestore.Transaction,
  jobRef: FirebaseFirestore.DocumentReference,
  { input, outputId, image, persistedFailureInfo, reuseOutput }: {
    input: PersistAttemptInput;
    outputId: string;
    image: AttemptImage;
    persistedFailureInfo: Job['failureInfo'] | null;
    reuseOutput: boolean;
  },
): void => {
  const { providerResult, autoReview, generationAttempt, nextStatus } = input;
  const createdAt = () => admin.firestore.FieldValue.serverTimestamp();

  transaction.set(jobRef.collection('logs').doc(), {
    type: reuseOutput ? 'quality_review' : 'provider_response',
    level: 'info',
    message: reuseOutput
      ? 'Se actualizó la revisión del output existente sin duplicar generación ni costos.'
      : 'Proveedor completó la generación y el resultado fue guardado.',
    outputId,
    payload: {
      provider: providerResult.provider,
      requestId: providerResult.requestId,
      remoteUrl: providerResult.remoteUrl,
      summary: providerResult.responseSummary,
      generationAttempt,
    },
    createdAt: createdAt(),
  });

  if (autoReview) {
    transaction.set(jobRef.collection('logs').doc(), {
      type: 'quality_review',
      ...describeReviewVerdict(autoReview.verdict, nextStatus),
      outputId,
      payload: {
        model: autoReview.model,
        verdict: autoReview.verdict,
        summary: autoReview.summary,
        failureInfo: persistedFailureInfo,
        reviewPrompt: autoReview.reviewPrompt,
        revisedPrompt: autoReview.revisedPrompt,
        criteria: autoReview.criteria,
        marketplaceData: autoReview.marketplaceData,
        attemptNumber: generationAttempt,
      },
      createdAt: createdAt(),
    });
  }

  if (nextStatus === 'completed') {
    transaction.set(jobRef.collection('logs').doc(), {
      type: 'completed',
      level: 'info',
      message: 'Trabajo completado y aprobado por la autoevaluación.',
      outputId,
      payload: {
        destinationPath: image.destinationPath,
        durationSeconds: input.durationSeconds,
        costUsd: image.chargedCostUsd,
        generationAttempt,
      },
      createdAt: createdAt(),
    });
  }
};

/** Removes the uploaded image and thumbnail of an attempt whose transaction did not commit. */
const discardUploadedImage = async (image: AttemptImage): Promise<void> => {
  try {
    await bucket.file(image.destinationPath).delete();
    if (image.thumbnailPath) await bucket.file(image.thumbnailPath).delete({ ignoreNotFound: true });
  } catch (cleanupError) {
    console.warn('Could not delete discarded generated file:', cleanupError);
  }
};

/**
 * Stores the attempt's image and output and moves the job to `nextStatus`, only while this worker still
 * holds the claim. Returns false (and discards a newly uploaded image) when the claim was lost.
 */
export const persistGeneratedAttempt = async (input: PersistAttemptInput): Promise<boolean> => {
  const { claimedJob } = input;
  const jobId = claimedJob.id!;
  const jobRef = db.collection('jobs').doc(jobId);
  const reuseOutput = reusesExistingOutput(claimedJob);
  const outputRef = reuseOutput
    ? jobRef.collection('outputs').doc(claimedJob.currentOutputId!)
    : jobRef.collection('outputs').doc();
  const outputId = outputRef.id;
  const imageConfig = normalizeProviderImageConfig(
    claimedJob.provider as Provider,
    claimedJob.imageConfig,
    claimedJob.aspectRatio,
  );

  const image = reuseOutput
    ? existingOutputImage(claimedJob, input.providerResult)
    : await storeNewOutputImage(claimedJob, jobId, outputId, input.providerResult, imageConfig);
  const persistedFailureInfo = withFailureOutputId(input.failureInfo, outputId);
  const attempt = { input, outputId, imageConfig, image, persistedFailureInfo, reuseOutput };
  const currentOutput = buildOutputDocument({ ...attempt, jobId });
  const jobUpdate = buildJobUpdate({ ...attempt, currentOutput });

  const committed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) {
      return false;
    }

    const latestJob = { id: snapshot.id, ...snapshot.data() } as Job;
    if (latestJob.status !== 'processing' || latestJob.claimToken !== claimedJob.claimToken) {
      return false;
    }

    transaction.set(outputRef, currentOutput);
    if (latestJob.currentOutputId && !reuseOutput) {
      const previousOutputRef = jobRef.collection('outputs').doc(latestJob.currentOutputId);
      transaction.set(previousOutputRef, { isCurrent: false }, { merge: true });
    }
    transaction.update(jobRef, jobUpdate);
    writeAttemptLogs(transaction, jobRef, attempt);
    return true;
  });

  if (!committed && !reuseOutput) {
    await discardUploadedImage(image);
  }

  return committed;
};

/** Automation jobs retry a failed review (unless the budget ran out); manual jobs fail and keep the image. */
const statusAfterReviewError = (job: Job, error: unknown): Job['status'] => {
  const canRetry = (job.retryCount || 0) < job.maxRetries;
  if (job.automationManaged && !(error instanceof AutomationBudgetError) && canRetry) return 'pending';
  return 'failed';
};

export const failGeneratedAttemptAfterReviewError = async ({
  claimedJob,
  providerResult,
  durationSeconds,
  generationAttempt,
  error,
}: {
  claimedJob: Job;
  providerResult: ProviderResult;
  durationSeconds: number | null;
  generationAttempt: number;
  error: unknown;
}): Promise<void> => {
  const failureInfo = buildJobFailureInfo(error, {
    provider: providerResult.provider,
    requestId: providerResult.requestId,
    attemptNumber: generationAttempt,
  });

  const persisted = await persistGeneratedAttempt({
    claimedJob,
    providerResult,
    durationSeconds,
    generationAttempt,
    nextStatus: statusAfterReviewError(claimedJob, error),
    ...(error instanceof AutomationBudgetError ? { automationGate: 'budget' as const } : {}),
    autoReview: null,
    failureInfo,
    lastError: toFailureSummary(failureInfo),
  });

  if (!persisted) {
    return;
  }

  await createLog(claimedJob.id!, {
    type: 'quality_review',
    level: 'error',
    message: 'La validación automática con Gemini falló después de generar la imagen.',
    outputId: null,
    payload: {
      attemptNumber: generationAttempt,
      failureInfo,
      error: serializeError(error),
    },
  });
};

export const retryOrFailJob = async (claimedJob: Job, error: unknown): Promise<void> => {
  const jobRef = db.collection('jobs').doc(claimedJob.id!);
  const nextRetryCount = (claimedJob.retryCount || 0) + 1;
  const shouldRetry = nextRetryCount <= (claimedJob.maxRetries || 0);
  const failureInfo = buildJobFailureInfo(error, {
    provider: claimedJob.provider,
    attemptNumber: claimedJob.generationAttemptCount || null,
    maxAttempts: claimedJob.maxRetries,
  });
  const errorMessage = toFailureSummary(failureInfo)
    || (error instanceof Error ? error.message : 'Ocurrió un error desconocido durante la generación.');

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) {
      return;
    }

    const latestJob = { id: snapshot.id, ...snapshot.data() } as Job;
    if (latestJob.status !== 'processing' || latestJob.claimToken !== claimedJob.claimToken) {
      return;
    }

    const systemConfig = await getSystemConfigCached();
    const retryNotBefore = shouldRetry
      ? Timestamp.fromMillis(Date.now() + systemConfig.jobRetryDelayMs)
      : null;

    transaction.update(jobRef, {
      status: shouldRetry ? 'pending' : 'failed',
      queuePriority: 0,
      retryCount: nextRetryCount,
      retryNotBefore,
      claimToken: null,
      claimedBy: null,
      claimExpiresAt: null,
      timeoutAt: null,
      startedAt: null,
      'traceability.lastProviderErrorAt': admin.firestore.FieldValue.serverTimestamp(),
      'traceability.lastProviderErrorMessage': errorMessage,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: errorMessage,
      failureInfo,
    });

    transaction.set(jobRef.collection('logs').doc(), {
      type: shouldRetry ? 'retry_scheduled' : 'failed',
      level: shouldRetry ? 'warn' : 'error',
      message: shouldRetry
        ? `La generación falló y quedó reencolada para el intento ${nextRetryCount}.`
        : 'La generación agotó sus reintentos y quedó fallida.',
      payload: {
        retryCount: nextRetryCount,
        maxRetries: claimedJob.maxRetries,
        failureInfo,
        error: serializeError(error),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
};
