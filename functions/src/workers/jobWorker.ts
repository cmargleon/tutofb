import { neutralWhiteBackground } from '../media/neutralWhiteBackground';
import { validatePlannedPhotoReview } from '../media/photoPlanFile';
import { withManglarJobBudget } from '../manglar/budget';
import { AutomationBudgetError, reserveAutomationOperation, settleAutomationOperation, pauseAutomationGeneration } from '../automation/budget';
import { estimateGenerationHold } from '../costs/generationEstimates';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { compressGeneratedImageIfNeeded } from '../media/compressGeneratedImage';
import { createGeneratedThumbnail } from '../media/generatedThumbnail';
import { getProviderCostUsd } from '../../../shared/src/constants/providerCosts';
import { Job, JobAutoReview, JobLog, JobOutput, Provider } from '../../../shared/src/types';
import { normalizeProviderImageConfig, summarizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { generateWithProvider } from '../providers';
import {
  FAL_KEY,
  GEMINI_API_KEY,
  getJobAutoReviewMaxAttempts,
  getJobStuckSweepLimit,
  getJobTimeoutMs,
} from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { getSystemConfigCached } from '../admin/systemConfig';
import {
  buildGeminiRejectedFailureInfo,
  buildJobFailureInfo,
  buildJobTimeoutFailureInfo,
  serializeError,
  toFailureSummary,
  withFailureOutputId,
} from '../errors/jobFailure';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { buildAutoReviewSignalsPatch } from '../review/reviewSignals';
import { buildAutomaticRetryPromptPatch, shouldBackstopPendingJob } from './jobWorker.helpers';

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
    const managedAutomation = Boolean(job.automationJobId) && job.automationManaged !== false;
    if (job.status !== 'pending' || (managedAutomation && job.automationGate)) {
      return null;
    }

    transaction.update(jobRef, {
      ...(managedAutomation ? { automationManaged: true } : {}),
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
      failureInfo: null,
    });

    return {
      ...job,
      ...(managedAutomation ? { automationManaged: true } : {}),
      status: 'processing',
      claimToken,
      claimedBy: workerId,
      claimExpiresAt,
      timeoutAt: claimExpiresAt,
      startedAt,
      lastAttemptStartedAt: startedAt,
      lastError: null,
      failureInfo: null,
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

const persistGeneratedAttempt = async ({
  claimedJob,
  providerResult,
  durationSeconds,
  generationAttempt,
  nextStatus,
  autoReview,
  failureInfo,
  lastError,
  nextPromptBase, automationGate,
}: {
  claimedJob: Job;
  providerResult: Awaited<ReturnType<typeof generateWithProvider>>;
  durationSeconds: number | null;
  generationAttempt: number;
  nextStatus: Job['status'];
  autoReview: JobAutoReview | null;
  failureInfo: Job['failureInfo'] | null;
  lastError: string | null;
  nextPromptBase?: string;
  automationGate?: Job['automationGate'];
}): Promise<boolean> => {
  const jobId = claimedJob.id!;
  const jobRef = db.collection('jobs').doc(jobId);
  const reuseOutput = Boolean(claimedJob.automationManaged && claimedJob.automationReviewPending && claimedJob.currentOutputId);
  const outputRef = reuseOutput ? jobRef.collection('outputs').doc(claimedJob.currentOutputId!) : jobRef.collection('outputs').doc();
  const outputId = outputRef.id;
  const normalizedImageConfig = normalizeProviderImageConfig(
    claimedJob.provider as Provider,
    claimedJob.imageConfig,
    claimedJob.aspectRatio,
  );
  const storedImage = reuseOutput ? { bytes: providerResult.imageBytes, contentType: claimedJob.currentOutput!.contentType, storedImage: claimedJob.currentOutput!.storedImage } : providerResult.preparedPhoto || await compressGeneratedImageIfNeeded({
    bytes: providerResult.imageBytes,
    contentType: providerResult.contentType,
    photoProfile: claimedJob.photoProfile, imageConfig: normalizedImageConfig.imageConfig,
  });
  const extension = extensionForContentType(storedImage.contentType);
  const destinationPath = reuseOutput ? claimedJob.currentOutput!.resultImagePath : `generated/${claimedJob.clientId}/${claimedJob.batchId}/${jobId}/${outputId}.${extension}`;

  if (!reuseOutput) await bucket.file(destinationPath).save(storedImage.bytes, {
    resumable: false,
    metadata: {
      contentType: storedImage.contentType,
      cacheControl: 'private, max-age=31536000',
    },
  });
  const thumbnailPath = reuseOutput ? null : await createGeneratedThumbnail({ bucket, bytes: storedImage.bytes, resultImagePath: destinationPath });

  const costUsd = reuseOutput || claimedJob.photoTask?.composition === 'reference' ? 0 : getProviderCostUsd(claimedJob.provider as Provider, normalizedImageConfig.imageConfig, claimedJob.generationKind === 'product' ? (claimedJob.productReferencePaths || [claimedJob.poseImagePath]).length : 2);
  const persistedFailureInfo = withFailureOutputId(failureInfo, outputId);

  const currentOutput: JobOutput = {
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
    aspectRatio: normalizedImageConfig.aspectRatio,
    imageConfig: normalizedImageConfig.imageConfig,
    ...(claimedJob.photoProfile ? { photoProfile: claimedJob.photoProfile } : {}),
    ...(storedImage.storedImage ? { storedImage: storedImage.storedImage } : {}),
    resultImagePath: destinationPath,
    ...(thumbnailPath ? { thumbnailPath } : {}),
    contentType: storedImage.contentType,
    remoteUrl: providerResult.remoteUrl,
    requestId: providerResult.requestId,
    costUsd: reuseOutput ? claimedJob.currentOutput!.costUsd : costUsd,
    durationSeconds: reuseOutput ? claimedJob.currentOutput!.durationSeconds : durationSeconds,
    providerResponseSummary: providerResult.responseSummary,
    generationAttempt,
    autoReview,
    failureInfo: persistedFailureInfo,
    isCurrent: true,
    createdAt: reuseOutput ? claimedJob.currentOutput!.createdAt : admin.firestore.FieldValue.serverTimestamp(),
    ...(reuseOutput ? { ...claimedJob.currentOutput!, autoReview, failureInfo: persistedFailureInfo, isCurrent: true } : {}),
  };

  const shouldResetForNextAttempt = nextStatus === 'pending' || nextStatus === 'failed';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseJobUpdate: Record<string, any> = {
    ...(automationGate !== undefined ? { automationGate } : {}),
    ...(claimedJob.automationManaged ? { automationReviewPending: autoReview === null,
      ...(autoReview === null && automationGate !== 'budget' ? { retryCount: (claimedJob.retryCount || 0) + 1 } : {}) } : {}),
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
    ...(!reuseOutput ? { latestOutputCreatedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    currentOutputId: outputId,
    currentOutput,
    completedOutputCount: admin.firestore.FieldValue.increment(reuseOutput ? 0 : 1),
    totalCostUsd: admin.firestore.FieldValue.increment(costUsd),
    totalDurationSeconds: admin.firestore.FieldValue.increment(reuseOutput ? 0 : durationSeconds || 0),
    [`providerUsage.${providerResult.provider}.completedOutputs`]: admin.firestore.FieldValue.increment(reuseOutput ? 0 : 1),
    [`providerUsage.${providerResult.provider}.totalCostUsd`]: admin.firestore.FieldValue.increment(costUsd),
    [`providerUsage.${providerResult.provider}.totalDurationSeconds`]: admin.firestore.FieldValue.increment(
      reuseOutput ? 0 : durationSeconds || 0,
    ),
    generationAttemptCount: generationAttempt,
    latestAutoReview: autoReview,
    failureInfo: persistedFailureInfo,
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
    Object.assign(baseJobUpdate, buildAutomaticRetryPromptPatch(claimedJob, nextPromptBase));
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

    if (latestJob.currentOutputId && !reuseOutput) {
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
      type: reuseOutput ? 'quality_review' : 'provider_response',
      level: 'info',
      message: reuseOutput ? 'Se actualizó la revisión del output existente sin duplicar generación ni costos.' : 'Proveedor completó la generación y el resultado fue guardado.',
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
          failureInfo: persistedFailureInfo,
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

  if (!committed && !reuseOutput) {
    try {
      await bucket.file(destinationPath).delete();
      if (thumbnailPath) await bucket.file(thumbnailPath).delete({ ignoreNotFound: true });
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
    nextStatus: claimedJob.automationManaged && !(error instanceof AutomationBudgetError) && (claimedJob.retryCount || 0) < claimedJob.maxRetries ? 'pending' : 'failed',
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

const retryOrFailJob = async (claimedJob: Job, error: unknown): Promise<void> => {
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
      const failureInfo = buildJobTimeoutFailureInfo({
        retryable: shouldRetry,
        attemptNumber: job.generationAttemptCount || null,
        maxAttempts: job.maxRetries,
        provider: job.provider,
        requestId: job.currentOutput?.requestId || null,
      });
      const errorMessage = toFailureSummary(failureInfo);

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
        'traceability.lastProviderErrorMessage': errorMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: errorMessage,
        failureInfo,
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
          failureInfo,
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
