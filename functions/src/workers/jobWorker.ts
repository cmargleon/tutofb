import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Job, JobLog, JobOutput, Provider } from '../../../shared/src/types';
import { generateWithProvider } from '../providers';
import {
  FAL_KEY,
  OPENAI_API_KEY,
  getJobStuckSweepLimit,
  getJobTimeoutMs,
} from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';

const db = getAppFirestore();
const bucket = admin.storage().bucket();

const toMillis = (value: unknown): number | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

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
      startedAt: claimExpiresAt,
      lastAttemptStartedAt: claimExpiresAt,
      lastError: null,
    };
  });
};

const markCleanupResult = async (jobId: string, outputId: string, deleted: boolean, storagePath: string, error?: unknown) => {
  const outputRef = db.collection('jobs').doc(jobId).collection('outputs').doc(outputId);

  if (deleted) {
    await outputRef.set(
      {
        storageDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await createLog(jobId, {
      type: 'cleanup',
      level: 'info',
      message: 'Se eliminó el archivo previo del resultado regenerado.',
      outputId,
      payload: {
        storagePath,
      },
    });
    return;
  }

  await createLog(jobId, {
    type: 'cleanup',
    level: 'warn',
    message: 'No se pudo eliminar el archivo previo del resultado regenerado.',
    outputId,
    payload: {
      storagePath,
      error: serializeError(error),
    },
  });
};

const completeJob = async (
  claimedJob: Job,
  providerResult: Awaited<ReturnType<typeof generateWithProvider>>,
  durationSeconds: number | null,
): Promise<void> => {
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
    poseImageId: claimedJob.poseImageId,
    garmentId: claimedJob.garmentId,
    garmentName: claimedJob.garmentName,
    provider: providerResult.provider,
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
    isCurrent: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

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

  writeBatch.update(jobRef, {
    provider: providerResult.provider,
    status: 'completed',
    queuePriority: 0,
    claimToken: null,
    claimedBy: null,
    claimExpiresAt: null,
    timeoutAt: null,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastError: null,
  });

  writeBatch.set(jobRef.collection('logs').doc(), {
    type: 'provider_response',
    level: 'info',
    message: 'Proveedor completó la generación exitosamente.',
    outputId,
    payload: {
      provider: providerResult.provider,
      requestId: providerResult.requestId,
      remoteUrl: providerResult.remoteUrl,
      summary: providerResult.responseSummary,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  writeBatch.set(jobRef.collection('logs').doc(), {
    type: 'completed',
    level: 'info',
    message: 'Trabajo completado y resultado guardado en Storage.',
    outputId,
    payload: {
      destinationPath,
      durationSeconds,
      costUsd,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeBatch.commit();

  if (claimedJob.currentOutputId && claimedJob.currentOutput?.resultImagePath) {
    try {
      await bucket.file(claimedJob.currentOutput.resultImagePath).delete({ ignoreNotFound: true });
      await markCleanupResult(jobId, claimedJob.currentOutputId, true, claimedJob.currentOutput.resultImagePath);
    } catch (error) {
      await markCleanupResult(
        jobId,
        claimedJob.currentOutputId,
        false,
        claimedJob.currentOutput.resultImagePath,
        error,
      );
    }
  }
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
    await completeJob(claimedJob, providerResult, durationSeconds);
  } catch (error) {
    await retryOrFailJob(claimedJob, error);
  } finally {
    clearTimeout(timeoutHandle);
  }
};
