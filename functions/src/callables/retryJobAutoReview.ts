import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job, JobAutoReview, JobOutput, RetryJobAutoReviewRequest, RetryJobAutoReviewResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { GEMINI_API_KEY, getJobAutoReviewMaxAttempts } from '../config/runtime';
import { getSystemConfigCached } from '../admin/systemConfig';
import {
  buildGeminiRejectedFailureInfo,
  buildJobFailureInfo,
  serializeError,
  toFailureSummary,
  withFailureOutputId,
} from '../errors/jobFailure';
import { getAppFirestore } from '../firebase/appFirestore';
import { reviewGeneratedImageWithGemini } from '../review/geminiImageReview';
import { buildAutoReviewSignalsPatch } from '../review/reviewSignals';

const db = getAppFirestore();
const bucket = admin.storage().bucket();

const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};

const downloadStorageImage = async (
  storagePath: string,
): Promise<{ bytes: Buffer; mimeType: string }> => {
  const [bytes] = await bucket.file(storagePath).download();
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

export const retryJobAutoReview = onCall<RetryJobAutoReviewRequest, Promise<RetryJobAutoReviewResponse>>(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 540 },
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

    const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
    if (!jobId) {
      throw new HttpsError('invalid-argument', 'Debes indicar un trabajo para reintentar la revisión.');
    }

    const jobRef = db.collection('jobs').doc(jobId);
    const snapshot = await jobRef.get();

    if (!snapshot.exists) {
      throw new HttpsError('not-found', 'Trabajo no encontrado.');
    }

    const job = { id: snapshot.id, ...snapshot.data() } as Job;
    if (job.status === 'processing' || job.status === 'pending') {
      throw new HttpsError('failed-precondition', 'Espera a que termine la generación antes de reintentar la revisión.');
    }

    const currentOutput = job.currentOutput;
    if (!currentOutput?.id || !currentOutput.resultImagePath) {
      throw new HttpsError('failed-precondition', 'Este trabajo no tiene una imagen actual para volver a revisar.');
    }

    const outputRef = jobRef.collection('outputs').doc(currentOutput.id);
    const outputSnapshot = await outputRef.get();
    if (!outputSnapshot.exists) {
      throw new HttpsError('not-found', 'No encontramos la salida actual para volver a revisar.');
    }

    const output = { id: outputSnapshot.id, ...outputSnapshot.data() } as JobOutput;

    try {
      const [poseReference, garmentReference, generatedImage] = await Promise.all([
        downloadStorageImage(job.poseImagePath),
        downloadStorageImage(job.garmentFilePath),
        downloadStorageImage(output.resultImagePath),
      ]);

      const attemptNumber = output.generationAttempt || job.generationAttemptCount || 1;
      const maxAttempts = job.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts();

      const systemConfig = await getSystemConfigCached();
      const review = await reviewGeneratedImageWithGemini({
        generationKind: job.generationKind,
        ...(job.generationKind === 'product' ? { productReferences: await Promise.all((job.productReferencePaths || [job.poseImagePath]).map(downloadStorageImage)) } : {}),
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
        userUid: request.auth?.uid,
        requestedPromptBase: job.requestedPromptBase || job.promptBase,
        promptBase: job.promptBase,
        finalPrompt: job.finalPrompt,
        modelIdentityTraitsSnapshot: job.modelIdentityTraitsSnapshot || null,
        attemptNumber,
        maxAttempts,
        poseReference,
        garmentReference,
        generatedImage,
        signal: AbortSignal.timeout(120000),
      });

      const storedReview = buildStoredReview(review, attemptNumber);
      const failureInfo = review.verdict === 'approved'
        ? null
        : buildGeminiRejectedFailureInfo({
            summary: review.summary,
            attemptNumber,
            maxAttempts,
            provider: output.provider,
            requestId: output.requestId || null,
            retryable: false,
            raw: {
              criteria: review.criteria,
              revisedPrompt: review.revisedPrompt,
              retriedManuallyByUid: request.auth?.uid || null,
            },
          });
      const now = admin.firestore.FieldValue.serverTimestamp();
      const updatedOutput: JobOutput = {
        ...output,
        autoReview: storedReview,
        failureInfo: withFailureOutputId(failureInfo, output.id),
      };

      const jobPatch: Record<string, unknown> = {
        currentOutput: updatedOutput,
        latestAutoReview: storedReview,
        ...buildAutoReviewSignalsPatch(job, storedReview.verdict),
        updatedAt: now,
        lastError: review.verdict === 'approved' ? null : toFailureSummary(failureInfo),
        failureInfo,
      };

      if (review.verdict === 'approved') {
        jobPatch.status = 'completed';
        jobPatch.completedAt = now;
        jobPatch['traceability.lastCompletedAt'] = now;
      } else {
        jobPatch.status = 'failed';
      }

      await db.runTransaction(async (transaction) => {
        transaction.set(outputRef, { autoReview: storedReview }, { merge: true });
        transaction.update(jobRef, jobPatch);
        transaction.set(jobRef.collection('logs').doc(), {
          type: 'quality_review',
          level: review.verdict === 'approved' ? 'info' : 'warn',
          message:
            review.verdict === 'approved'
              ? 'Gemini aprobó la imagen al reintentar la revisión manual.'
              : 'Gemini volvió a rechazar la imagen al reintentar la revisión manual.',
          outputId: output.id,
          payload: {
            model: storedReview.model,
            verdict: storedReview.verdict,
            summary: storedReview.summary,
            failureInfo,
            reviewPrompt: storedReview.reviewPrompt,
            revisedPrompt: storedReview.revisedPrompt,
            criteria: storedReview.criteria,
            marketplaceData: storedReview.marketplaceData,
            attemptNumber,
            retriedManuallyByUid: request.auth?.uid || null,
          },
          createdAt: now,
        });
      });

      return {
        success: true,
        jobId,
        verdict: storedReview.verdict,
      };
    } catch (error) {
      const failureInfo = withFailureOutputId(
        buildJobFailureInfo(error, {
          provider: output.provider,
          requestId: output.requestId || null,
          outputId: output.id,
          attemptNumber: output.generationAttempt || job.generationAttemptCount || 1,
          maxAttempts: job.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts(),
        }),
        output.id,
      );
      const message = toFailureSummary(failureInfo) || 'No se pudo validar la imagen con Gemini.';
      const updatedCurrentOutput: JobOutput = {
        ...output,
        failureInfo,
      };

      await jobRef.update({
        lastError: message,
        failureInfo,
        currentOutput: updatedCurrentOutput,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await outputRef.set({ failureInfo }, { merge: true });

      await jobRef.collection('logs').add({
        type: 'quality_review',
        level: 'error',
        message: 'La revisión manual con Gemini falló.',
        outputId: output.id,
        payload: {
          failureInfo,
          error: serializeError(error),
          retriedManuallyByUid: request.auth?.uid || null,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      throw new HttpsError('internal', message);
    }
  },
);
