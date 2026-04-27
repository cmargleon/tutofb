import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { buildFinalGenerationPrompt } from '../../../shared/src/domain';
import { getProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { Job, JobAutoReview, JobLog, JobOutput, Provider } from '../../../shared/src/types';
import { normalizeProviderImageConfig, summarizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { generateWithProvider } from '../providers';
import {
  FAL_KEY,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  getJobAutoReviewMaxAttempts,
  getJobStuckSweepLimit,
  getJobTimeoutMs,
} from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { getSystemConfigCached } from '../admin/systemConfig';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { buildAutoReviewSignalsPatch } from '../review/reviewSignals';
import { shouldBackstopPendingJob } from './jobWorker.helpers';

const db = getAppFirestore();
const bucket = admin.storage().bucket();
const MAX_STORED_OUTPUT_BYTES = 3 * 1024 * 1024;
const OUTPUT_JPEG_QUALITIES = [90, 82, 74, 66, 58, 50] as const;
const OUTPUT_LONGEST_SIDES = [2200, 2000, 1800, 1600, 1400, 1200, 1000] as const;

const getSignedUrl = async (storagePath: string): Promise<string> => {
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
    version: 'v4',
  });
  return url;
};

const extensionForContentType = (contentType: string): string => {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
};

const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const compressGeneratedImageIfNeeded = async ({
  bytes,
  contentType,
}: {
  bytes: Buffer;
  contentType: string;
}): Promise<{ bytes: Buffer; contentType: string }> => {
  if (bytes.length <= MAX_STORED_OUTPUT_BYTES) {
    return { bytes, contentType };
  }

  const source = sharp(bytes, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const sourceWidth = metadata.width || null;
  const sourceHeight = metadata.height || null;
  const longestSide = Math.max(sourceWidth || 0, sourceHeight || 0);
  let bestCandidate: Buffer | null = null;

  for (const targetLongestSide of OUTPUT_LONGEST_SIDES) {
    const shouldResize = longestSide > 0 && longestSide > targetLongestSide;

    for (const quality of OUTPUT_JPEG_QUALITIES) {
      let pipeline = sharp(bytes, { failOn: 'none' }).rotate();
      if (shouldResize) {
        pipeline = pipeline.resize({
          width: sourceWidth && sourceWidth >= (sourceHeight || 0) ? targetLongestSide : undefined,
          height: sourceHeight && sourceHeight > (sourceWidth || 0) ? targetLongestSide : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const candidate = await pipeline.jpeg({
        quality,
        mozjpeg: true,
      }).toBuffer();

      if (!bestCandidate || candidate.length < bestCandidate.length) {
        bestCandidate = candidate;
      }

      if (candidate.length <= MAX_STORED_OUTPUT_BYTES) {
        return {
          bytes: candidate,
          contentType: 'image/jpeg',
        };
      }
    }
  }

  if (bestCandidate && bestCandidate.length < bytes.length) {
    return {
      bytes: bestCandidate,
      contentType: 'image/jpeg',
    };
  }

  return { bytes, contentType };
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: 'Error desconocido',
    raw: error,
  };
};

const createLog = async (jobId: string, input: Omit<JobLog, 'createdAt'>): Promise<void> => {
  await db.collection('jobs').doc(jobId).collection('logs').add({
    ...input,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

const isClaimStillActive = async (jobId: string, claimToken: string | null): Promise<boolean> => {
  if (!claimToken) {
    return false;
  }

  const snapshot = await db.collection('jobs').doc(jobId).get();
  if (!snapshot.exists) {
    return false;
  }

  const job = { id: snapshot.id, ...snapshot.data() } as Job;
  return job.status === 'processing' && job.claimToken === claimToken;
};

const claimJob = async (jobId: string, workerId: string): Promise<Job | null> => {
  const jobRef = db.collection('jobs').doc(jobId);
  const claimExpiresAt = Timestamp.fromMillis(Date.now() + getJobTimeoutMs());
  const claimToken = randomUUID();
  const startedAt = Timestamp.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) {
      return null;
    }

    const job = { id: snapshot.id, ...snapshot.data() } as Job;
    if (job.status !== 'pending') {
      return null;
    }

    transaction.update(jobRef, {
      status: 'processing',
      claimToken,
      claimedBy: workerId,
      claimExpiresAt,
      timeoutAt: claimExpiresAt,
      retryNotBefore: null,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAttemptStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      'traceability.lastAttemptStartedAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: null,
    });

    return {
      ...job,
      status: 'processing',
      claimToken,
      claimedBy: workerId,
      claimExpiresAt,
      timeoutAt: claimExpiresAt,
      startedAt,
      lastAttemptStartedAt: startedAt,
      lastError: null,
    };
  });
};

const downloadStorageImage = async (
  storagePath: string,
): Promise<{ bytes: Buffer; mimeType: string }> => {
  const file = bucket.file(storagePath);
  const [bytes] = await file.download();
  return {
    bytes,
    mimeType: mimeTypeFromStoragePath(storagePath),
  };
};

const buildStoredReview = (
  review: Awaited<ReturnType<typeof reviewGeneratedImageWithGemini>>,
  attemptNumber: number,
): JobAutoReview => ({
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

const persistGeneratedAttempt = async ({
  claimedJob,
  providerResult,
  durationSeconds,
  generationAttempt,
  nextStatus,
  autoReview,
  lastError,
  nextPromptBase,
}: {
  claimedJob: Job;
  providerResult: Awaited<ReturnType<typeof generateWithProvider>>;
  durationSeconds: number | null;
  generationAttempt: number;
  nextStatus: Job['status'];
  autoReview: JobAutoReview | null;
  lastError: string | null;
  nextPromptBase?: string;
}): Promise<boolean> => {
  const jobId = claimedJob.id!;
  const jobRef = db.collection('jobs').doc(jobId);
  const outputRef = jobRef.collection('outputs').doc();
  const outputId = outputRef.id;
  const normalizedImageConfig = normalizeProviderImageConfig(
    claimedJob.provider as Provider,
    claimedJob.imageConfig,
    claimedJob.aspectRatio,
  );
  const storedImage = await compressGeneratedImageIfNeeded({
    bytes: providerResult.imageBytes,
    contentType: providerResult.contentType,
  });
  const extension = extensionForContentType(storedImage.contentType);
  const destinationPath = `generated/${claimedJob.clientId}/${claimedJob.batchId}/${jobId}/${outputId}.${extension}`;

  await bucket.file(destinationPath).save(storedImage.bytes, {
    resumable: false,
    metadata: {
      contentType: storedImage.contentType,
      cacheControl: 'private, max-age=31536000',
    },
  });

  const costUsd = getProviderCostUsd(claimedJob.provider as Provider, normalizedImageConfig.imageConfig);

  const currentOutput: JobOutput = {
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
    promptBase: claimedJob.promptBase,
    finalPrompt: claimedJob.finalPrompt,
    aspectRatio: normalizedImageConfig.aspectRatio,
    imageConfig: normalizedImageConfig.imageConfig,
    resultImagePath: destinationPath,
    contentType: storedImage.contentType,
    remoteUrl: providerResult.remoteUrl,
    requestId: providerResult.requestId,
    costUsd,
    durationSeconds,
    providerResponseSummary: providerResult.responseSummary,
    generationAttempt,
    autoReview,
    isCurrent: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const resolvedPromptBase = typeof nextPromptBase === 'string' ? nextPromptBase.trim() : claimedJob.promptBase;
  const shouldResetForNextAttempt = nextStatus === 'pending' || nextStatus === 'failed';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseJobUpdate: Record<string, any> = {
    provider: providerResult.provider,
    aspectRatio: normalizedImageConfig.aspectRatio,
    imageConfig: normalizedImageConfig.imageConfig,
    status: nextStatus,
    queuePriority: nextStatus === 'pending' ? 1 : 0,
    claimToken: null,
    claimedBy: null,
    claimExpiresAt: null,
    timeoutAt: null,
    completedAt: nextStatus === 'completed' ? admin.firestore.FieldValue.serverTimestamp() : null,
    latestOutputCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    currentOutputId: outputId,
    currentOutput,
    completedOutputCount: admin.firestore.FieldValue.increment(1),
    totalCostUsd: admin.firestore.FieldValue.increment(costUsd),
    totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds || 0),
    [`providerUsage.${providerResult.provider}.completedOutputs`]: admin.firestore.FieldValue.increment(1),
    [`providerUsage.${providerResult.provider}.totalCostUsd`]: admin.firestore.FieldValue.increment(costUsd),
    [`providerUsage.${providerResult.provider}.totalDurationSeconds`]: admin.firestore.FieldValue.increment(
      durationSeconds || 0,
    ),
    generationAttemptCount: generationAttempt,
    latestAutoReview: autoReview,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastError,
    ...(autoReview ? buildAutoReviewSignalsPatch(claimedJob, autoReview.verdict) : {}),
  };

  if (nextStatus === 'completed') {
    baseJobUpdate['traceability.lastCompletedAt'] = admin.firestore.FieldValue.serverTimestamp();
    baseJobUpdate.userSelectedOutputId = null;
    baseJobUpdate.userSelectedOutput = null;
  }

  if (shouldResetForNextAttempt) {
    baseJobUpdate.startedAt = null;
  }

  if (nextStatus === 'pending') {
    baseJobUpdate.promptBase = resolvedPromptBase;
    baseJobUpdate.finalPrompt = buildFinalGenerationPrompt(
      resolvedPromptBase,
      claimedJob.garmentReferenceImageType || (claimedJob.garmentIsMultiAngle ? 'multi_angle_composite' : 'single_view'),
      claimedJob.promptCaseText,
      claimedJob.modelIdentityTraitsSnapshot || null,
    );
  }

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

    if (latestJob.currentOutputId) {
      transaction.set(
        jobRef.collection('outputs').doc(latestJob.currentOutputId),
        {
          isCurrent: false,
        },
        { merge: true },
      );
    }

    transaction.update(jobRef, baseJobUpdate);

    transaction.set(jobRef.collection('logs').doc(), {
      type: 'provider_response',
      level: 'info',
      message: 'Proveedor completó la generación y el resultado fue guardado.',
      outputId,
      payload: {
        provider: providerResult.provider,
        requestId: providerResult.requestId,
        remoteUrl: providerResult.remoteUrl,
        summary: providerResult.responseSummary,
        generationAttempt,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (autoReview) {
      transaction.set(jobRef.collection('logs').doc(), {
        type: 'quality_review',
        level:
          autoReview.verdict === 'approved'
            ? 'info'
            : nextStatus === 'pending'
              ? 'warn'
              : 'error',
        message:
          autoReview.verdict === 'approved'
            ? 'Gemini aprobó la imagen generada.'
            : nextStatus === 'pending'
              ? 'Gemini rechazó la imagen y programó un nuevo intento.'
              : 'Gemini rechazó la imagen y se agotó el máximo de intentos.',
        outputId,
        payload: {
          model: autoReview.model,
          verdict: autoReview.verdict,
          summary: autoReview.summary,
          reviewPrompt: autoReview.reviewPrompt,
          revisedPrompt: autoReview.revisedPrompt,
          criteria: autoReview.criteria,
          marketplaceData: autoReview.marketplaceData,
          attemptNumber: generationAttempt,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    if (nextStatus === 'completed') {
      transaction.set(jobRef.collection('logs').doc(), {
        type: 'completed',
        level: 'info',
        message: 'Trabajo completado y aprobado por la autoevaluación.',
        outputId,
        payload: {
          destinationPath,
          durationSeconds,
          costUsd,
          generationAttempt,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return true;
  });

  if (!committed) {
    try {
      await bucket.file(destinationPath).delete();
    } catch (cleanupError) {
      console.warn('Could not delete discarded generated file:', cleanupError);
    }
  }

  return committed;
};

const failGeneratedAttemptAfterReviewError = async ({
  claimedJob,
  providerResult,
  durationSeconds,
  generationAttempt,
  error,
}: {
  claimedJob: Job;
  providerResult: Awaited<ReturnType<typeof generateWithProvider>>;
  durationSeconds: number | null;
  generationAttempt: number;
  error: unknown;
}): Promise<void> => {
  const persisted = await persistGeneratedAttempt({
    claimedJob,
    providerResult,
    durationSeconds,
    generationAttempt,
    nextStatus: 'failed',
    autoReview: null,
    lastError:
      error instanceof Error
        ? `No se pudo validar la imagen con Gemini: ${error.message}`
        : 'No se pudo validar la imagen con Gemini.',
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
      error: serializeError(error),
    },
  });
};

const retryOrFailJob = async (claimedJob: Job, error: unknown): Promise<void> => {
  const jobRef = db.collection('jobs').doc(claimedJob.id!);
  const nextRetryCount = (claimedJob.retryCount || 0) + 1;
  const shouldRetry = nextRetryCount <= (claimedJob.maxRetries || 0);
  const errorMessage =
    error instanceof Error ? error.message : 'Ocurrió un error desconocido durante la generación.';

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
        error: serializeError(error),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
};

export const requeueExpiredJobs = async (): Promise<number> => {
  const now = Timestamp.now();
  const sweepLimit = getJobStuckSweepLimit();

  // 1. Recover stuck jobs (processing but claim expired)
  const stuckSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'processing')
    .where('claimExpiresAt', '<=', now)
    .limit(sweepLimit)
    .get();

  if (!stuckSnapshot.empty) {
    const writeBatch = db.batch();
    stuckSnapshot.docs.forEach((docSnapshot) => {
      const job = { id: docSnapshot.id, ...docSnapshot.data() } as Job;
      const nextRetryCount = (job.retryCount || 0) + 1;
      const shouldRetry = nextRetryCount <= (job.maxRetries || 0);

      writeBatch.update(docSnapshot.ref, {
        status: shouldRetry ? 'pending' : 'failed',
        retryCount: nextRetryCount,
        retryNotBefore: null,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        'traceability.lastProviderErrorAt': admin.firestore.FieldValue.serverTimestamp(),
        'traceability.lastProviderErrorMessage': shouldRetry
          ? 'El trabajo excedió el tiempo máximo de ejecución y fue reencolado.'
          : 'El trabajo excedió el tiempo máximo de ejecución y agotó sus reintentos.',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: shouldRetry
          ? 'El trabajo excedió el tiempo máximo de ejecución y fue reencolado.'
          : 'El trabajo excedió el tiempo máximo de ejecución y agotó sus reintentos.',
      });

      writeBatch.set(docSnapshot.ref.collection('logs').doc(), {
        type: shouldRetry ? 'retry_scheduled' : 'failed',
        level: shouldRetry ? 'warn' : 'error',
        message: shouldRetry
          ? 'El trabajo quedó atascado y fue reencolado automáticamente.'
          : 'El trabajo quedó atascado y fue marcado como fallido al agotar reintentos.',
        payload: {
          retryCount: nextRetryCount,
          maxRetries: job.maxRetries,
          previousClaimToken: job.claimToken,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await writeBatch.commit();
  }

  // 2. Activate deferred retry jobs whose wait time has elapsed.
  // Only clear retryNotBefore — the processJobOnActivation trigger picks up the job
  // in its own isolated Cloud Function instance (no API calls here).
  const deferredSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'pending')
    .where('retryNotBefore', '<=', now)
    .limit(sweepLimit)
    .get();

  if (!deferredSnapshot.empty) {
    const deferredBatch = db.batch();
    deferredSnapshot.docs.forEach((docSnapshot) => {
      deferredBatch.update(docSnapshot.ref, {
        retryNotBefore: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await deferredBatch.commit();
  }

  // 3. Backstop orphan pending jobs that were never claimed.
  // Exclude jobs just activated in step 2 to avoid double-triggering.
  // Set schedulerPickupAt — the processJobOnActivation trigger fires per job in isolation.
  const deferredIds = new Set(deferredSnapshot.docs.map((d) => d.id));

  const pendingSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'pending')
    .limit(sweepLimit)
    .get();

  const orphanPendingDocs = pendingSnapshot.docs.filter(
    (docSnapshot) =>
      !deferredIds.has(docSnapshot.id) &&
      shouldBackstopPendingJob({ id: docSnapshot.id, ...docSnapshot.data() } as Job),
  );

  if (orphanPendingDocs.length > 0) {
    const orphanBatch = db.batch();
    orphanPendingDocs.forEach((docSnapshot) => {
      orphanBatch.update(docSnapshot.ref, {
        schedulerPickupAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await orphanBatch.commit();
  }

  return stuckSnapshot.size + deferredSnapshot.size + orphanPendingDocs.length;
};

export const processJob = async (
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

    await createLog(jobId, {
      type: 'provider_request',
      level: 'info',
      message: 'Se enviaron los insumos al proveedor.',
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
        promptBase: claimedJob.promptBase,
      },
    });

    const providerResult = await generateWithProvider(
      claimedJob.provider as Provider,
      {
        poseImageUrl,
        garmentImageUrl,
        prompt: claimedJob.finalPrompt,
        imageConfig: normalizedImageConfig.imageConfig,
        signal: controller.signal,
      },
      {
        falKey: FAL_KEY.value(),
        openaiApiKey: OPENAI_API_KEY.value(),
      },
    );

    if (!(await isClaimStillActive(jobId, claimedJob.claimToken))) {
      return;
    }

    const startedAtMs = toMillis(claimedJob.lastAttemptStartedAt) || Date.now();
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
    const generationAttempt = (claimedJob.generationAttemptCount || 0) + 1;
    const maxAutoReviewAttempts = claimedJob.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts();

    try {
      const [poseReference, garmentReference] = await Promise.all([
        downloadStorageImage(claimedJob.poseImagePath),
        downloadStorageImage(claimedJob.garmentFilePath),
      ]);

      const jobSystemConfig = await getSystemConfigCached();
      const review = await reviewGeneratedImageWithGemini({
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

      const storedReview = buildStoredReview(review, generationAttempt);

      if (review.verdict === 'approved') {
        await persistGeneratedAttempt({
          claimedJob,
          providerResult,
          durationSeconds,
          generationAttempt,
          nextStatus: 'completed',
          autoReview: storedReview,
          lastError: null,
        });
        return;
      }

      if (generationAttempt < maxAutoReviewAttempts) {
        const revisedPrompt = (review.revisedPrompt || claimedJob.promptBase).trim() || claimedJob.promptBase;
        await persistGeneratedAttempt({
          claimedJob,
          providerResult,
          durationSeconds,
          generationAttempt,
          nextStatus: 'pending',
          autoReview: storedReview,
          nextPromptBase: revisedPrompt,
          lastError: `Gemini rechazó el intento ${generationAttempt}/${maxAutoReviewAttempts}: ${review.summary}`,
        });
        return;
      }

      await persistGeneratedAttempt({
        claimedJob,
        providerResult,
        durationSeconds,
        generationAttempt,
        nextStatus: 'failed',
        autoReview: storedReview,
        lastError: `Gemini rechazó la imagen tras ${generationAttempt} intentos: ${review.summary}`,
      });
    } catch (reviewError) {
      await failGeneratedAttemptAfterReviewError({
        claimedJob,
        providerResult,
        durationSeconds,
        generationAttempt,
        error: reviewError,
      });
    }
  } catch (error) {
    await retryOrFailJob(claimedJob, error);
  } finally {
    clearTimeout(timeoutHandle);
  }
};
