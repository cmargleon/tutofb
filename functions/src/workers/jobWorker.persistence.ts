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

export const persistGeneratedAttempt = async ({
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

export const failGeneratedAttemptAfterReviewError = async ({
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
