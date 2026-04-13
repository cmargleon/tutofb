import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Batch,
  Job,
  RegenerateFailedBatchJobsRequest,
  RegenerateFailedBatchJobsResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { buildRegenerateJobPatch } from './regenerateJob.helpers';
import { buildRegenerationReviewSignalsPatch } from '../review/reviewSignals';
import { resolveNotificationRetryProvider } from './regenerateFailedBatchJobs.helpers';

export const regenerateFailedBatchJobs = onCall<
  RegenerateFailedBatchJobsRequest,
  Promise<RegenerateFailedBatchJobsResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
  const source = request.data?.source === 'notification' ? 'notification' : 'catalog';
  if (!batchId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un lote válido.');
  }

  const db = getAppFirestore();
  const batchSnapshot = await db.collection('batches').doc(batchId).get();
  if (!batchSnapshot.exists) {
    throw new HttpsError('not-found', 'Lote no encontrado.');
  }
  const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;

  const userSnapshot = await db.collection('users').doc(request.auth!.uid).get();
  const requestedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;

  const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();
  const failedJobs = jobsSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job))
    .filter((job) => job.status === 'failed');

  if (failedJobs.length === 0) {
    return {
      success: true,
      batchId,
      queuedJobs: 0,
      skippedJobs: 0,
      skippedJobIds: [],
      retryProvider: null,
    };
  }

  const writeBatch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const skippedJobIds: string[] = [];
  let queuedJobs = 0;
  const retryProvider = source === 'notification'
    ? resolveNotificationRetryProvider(batch.provider)
    : null;

  if (source === 'notification') {
    writeBatch.update(batchSnapshot.ref, {
      notification: {
        retryState: 'queued',
        retryRequestedAt: now,
        retryRequestedByUid: request.auth!.uid,
        retryRequestedByDisplayName: requestedByDisplayName,
        retryProvider,
      },
      updatedAt: now,
    });
  }

  failedJobs.forEach((job) => {
    const prompt = (job.promptBase || job.finalPrompt || '').trim();
    const targetProvider = retryProvider ?? job.provider;

    try {
      const patch = buildRegenerateJobPatch(job, targetProvider, prompt);
      const jobRef = db.collection('jobs').doc(job.id!);

      writeBatch.update(jobRef, {
        ...patch,
        manualRegenerationCount: admin.firestore.FieldValue.increment(1),
        ...buildRegenerationReviewSignalsPatch({
          job,
          uid: request.auth!.uid,
          displayName: requestedByDisplayName,
        }),
        'traceability.lastManualRegenerationAt': now,
        'traceability.lastManualRegeneratedByUid': request.auth!.uid,
        'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
        updatedAt: now,
      });

      writeBatch.set(jobRef.collection('logs').doc(), {
        type: 'system',
        level: 'info',
        message: 'Regeneración masiva de fallidos encolada desde la aplicación.',
        payload: {
          requestedByUid: request.auth!.uid,
          requestedByDisplayName,
          source: source === 'notification' ? 'batch_failed_retry_notification' : 'batch_failed_retry',
          batchId,
          provider: targetProvider,
          prompt,
          currentOutputId: job.currentOutput?.id || null,
          currentOutputGeminiVerdict: job.currentOutput?.autoReview?.verdict || job.latestAutoReview?.verdict || null,
        },
        createdAt: now,
      });

      queuedJobs += 1;
    } catch {
      skippedJobIds.push(job.id!);
    }
  });

  if (queuedJobs > 0) {
    await writeBatch.commit();
  }

  return {
    success: true,
    batchId,
    queuedJobs,
    skippedJobs: skippedJobIds.length,
    skippedJobIds,
    retryProvider,
  };
});
