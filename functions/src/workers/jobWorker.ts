import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { buildFinalGenerationPrompt } from '../../../shared/src/domain';
import { Job, JobAutoReview, JobLog, JobOutput, Provider } from '../../../shared/src/types';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { generateWithProvider } from '../providers';
import {
  FAL_KEY,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
  getGeminiImageReviewModel,
  getJobAutoReviewMaxAttempts,
  getJobStuckSweepLimit,
  getJobTimeoutMs,
} from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';

const db = getAppFirestore();
const bucket = admin.storage().bucket();

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
}): Promise<void> => {
  const jobId = claimedJob.id!;
  const jobRef = db.collection('jobs').doc(jobId);
  const outputRef = jobRef.collection('outputs').doc();
  const outputId = outputRef.id;
  const extension = extensionForContentType(providerResult.contentType);
  const destinationPath = `generated/${claimedJob.clientId}/${claimedJob.batchId}/${jobId}/${outputId}.${extension}`;

  await bucket.file(destinationPath).save(providerResult.imageBytes, {
    resumable: false,
    metadata: {
      contentType: providerResult.contentType,
      cacheControl: 'private, max-age=31536000',
    },
  });

  const costUsd =
    claimedJob.provider === 'fal-seedream'
      ? 0.03
      : claimedJob.provider === 'fal-banana-pro'
        ? 0.15
        : 0.04;

  const currentOutput: JobOutput = {
    id: outputId,
    jobId,
    batchId: claimedJob.batchId,
    clientId: claimedJob.clientId,
    clientNameSnapshot: claimedJob.clientNameSnapshot,
    modelId: claimedJob.modelId,
    modelNameSnapshot: claimedJob.modelNameSnapshot,
    experimentEnabled: claimedJob.experimentEnabled || false,
    experimentId: claimedJob.experimentId || null,
    experimentMode: claimedJob.experimentMode || null,
    experimentArmId: claimedJob.experimentArmId || null,
    experimentArmLabel: claimedJob.experimentArmLabel || null,
    experimentComparisonKey: claimedJob.experimentComparisonKey || null,
    poseImageId: claimedJob.poseImageId,
    garmentId: claimedJob.garmentId,
    garmentName: claimedJob.garmentName,
    provider: providerResult.provider,
    requestedPromptBase: claimedJob.requestedPromptBase || claimedJob.promptBase,
    promptBase: claimedJob.promptBase,
    finalPrompt: claimedJob.finalPrompt,
    aspectRatio: claimedJob.aspectRatio,
    resultImagePath: destinationPath,
    contentType: providerResult.contentType,
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
  const baseJobUpdate: Record<string, unknown> = {
    provider: providerResult.provider,
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
    baseJobUpdate.finalPrompt = buildFinalGenerationPrompt(resolvedPromptBase, claimedJob.garmentIsMultiAngle);
  }

  const writeBatch = db.batch();
  writeBatch.set(outputRef, currentOutput);

  if (claimedJob.currentOutputId) {
    writeBatch.set(
      jobRef.collection('outputs').doc(claimedJob.currentOutputId),
      {
        isCurrent: false,
      },
      { merge: true },
    );
  }

  writeBatch.update(jobRef, baseJobUpdate);

  writeBatch.set(jobRef.collection('logs').doc(), {
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
    writeBatch.set(jobRef.collection('logs').doc(), {
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
    writeBatch.set(jobRef.collection('logs').doc(), {
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

  await writeBatch.commit();
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
  await persistGeneratedAttempt({
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

  const writeBatch = db.batch();
  writeBatch.update(jobRef, {
    status: shouldRetry ? 'pending' : 'failed',
    queuePriority: shouldRetry ? 0 : 0,
    retryCount: nextRetryCount,
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

  writeBatch.set(jobRef.collection('logs').doc(), {
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

  await writeBatch.commit();
};

export const requeueExpiredJobs = async (): Promise<number> => {
  const snapshot = await db
    .collection('jobs')
    .where('status', '==', 'processing')
    .where('claimExpiresAt', '<=', Timestamp.now())
    .limit(getJobStuckSweepLimit())
    .get();

  if (snapshot.empty) {
    return 0;
  }

  const writeBatch = db.batch();
  snapshot.docs.forEach((docSnapshot) => {
    const job = { id: docSnapshot.id, ...docSnapshot.data() } as Job;
    const nextRetryCount = (job.retryCount || 0) + 1;
    const shouldRetry = nextRetryCount <= (job.maxRetries || 0);

    writeBatch.update(docSnapshot.ref, {
      status: shouldRetry ? 'pending' : 'failed',
      retryCount: nextRetryCount,
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
  return snapshot.size;
};

export const processJob = async (jobId: string, source: 'create' | 'requeue'): Promise<void> => {
  await requeueExpiredJobs();

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
        aspectRatio: claimedJob.aspectRatio,
        poseImagePath: claimedJob.poseImagePath,
        garmentFilePath: claimedJob.garmentFilePath,
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
        aspectRatio: claimedJob.aspectRatio,
        signal: controller.signal,
      },
      {
        falKey: FAL_KEY.value(),
        openaiApiKey: OPENAI_API_KEY.value(),
      },
    );

    const startedAtMs = toMillis(claimedJob.lastAttemptStartedAt) || Date.now();
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
    const generationAttempt = (claimedJob.generationAttemptCount || 0) + 1;
    const maxAutoReviewAttempts = claimedJob.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts();

    try {
      const [poseReference, garmentReference] = await Promise.all([
        downloadStorageImage(claimedJob.poseImagePath),
        downloadStorageImage(claimedJob.garmentFilePath),
      ]);

      const review = await reviewGeneratedImageWithGemini({
        apiKey: GEMINI_API_KEY.value(),
        model: getGeminiImageReviewModel(),
        requestedPromptBase: claimedJob.requestedPromptBase || claimedJob.promptBase,
        promptBase: claimedJob.promptBase,
        finalPrompt: claimedJob.finalPrompt,
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
