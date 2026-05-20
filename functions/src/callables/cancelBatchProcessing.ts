import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  BatchStatus,
  CancelBatchProcessingRequest,
  CancelBatchProcessingResponse,
  Job,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { buildManualCancellationFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { getAppFirestore } from '../firebase/appFirestore';

export const cancelBatchProcessing = onCall<
  CancelBatchProcessingRequest,
  Promise<CancelBatchProcessingResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador']);

  const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
  if (!batchId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un lote valido.');
  }

  const db = getAppFirestore();
  const batchRef = db.collection('batches').doc(batchId);
  const userRef = db.collection('users').doc(request.auth!.uid);
  const [batchSnapshot, jobsSnapshot, userSnapshot] = await Promise.all([
    batchRef.get(),
    db.collection('jobs').where('batchId', '==', batchId).get(),
    userRef.get(),
  ]);

  if (!batchSnapshot.exists) {
    throw new HttpsError('not-found', 'Lote no encontrado.');
  }

  const allJobs = jobsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job));
  const activeJobs = allJobs.filter((job) => job.status === 'pending' || job.status === 'processing');

  const now = admin.firestore.FieldValue.serverTimestamp();

  if (activeJobs.length > 0) {
    const requestedByDisplayName =
      userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data()!.displayName
        : null;

    const bulkWriter = db.bulkWriter();

    activeJobs.forEach((job) => {
      const wasProcessing = job.status === 'processing';
      const jobRef = db.collection('jobs').doc(job.id!);
      const failureInfo = buildManualCancellationFailureInfo({
        userMessage: wasProcessing
          ? 'El job fue cancelado manualmente mientras el lote estaba en procesamiento.'
          : 'El job fue cancelado manualmente antes de iniciar la generación del lote.',
        technicalMessage: wasProcessing
          ? 'Se canceló el job mientras el worker estaba procesando el lote. Los resultados tardíos serán ignorados.'
          : 'Se canceló el job pendiente desde la cancelación masiva del lote.',
      });

      bulkWriter.update(jobRef, {
        status: 'failed',
        queuePriority: 0,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        lastAttemptStartedAt: null,
        updatedAt: now,
        lastError: toFailureSummary(failureInfo),
        failureInfo,
      });

      bulkWriter.set(jobRef.collection('logs').doc(), {
        type: 'system',
        level: 'warn',
        message: wasProcessing
          ? 'El job fue cancelado manualmente desde el lote durante la generacion. Los resultados tardios seran ignorados.'
          : 'El job pendiente fue cancelado manualmente desde el lote antes de ser reclamado por el worker.',
        payload: {
          requestedByUid: request.auth!.uid,
          requestedByDisplayName,
          source: 'evaluation_cancel_batch',
          batchId,
          previousStatus: job.status,
          failureInfo,
        },
        createdAt: now,
      });
    });

    await bulkWriter.close();
  }

  // Always recompute and set batch counters directly — even when no active jobs were found,
  // this corrects any stale status left by previous trigger race conditions.
  // When jobs were cancelled, re-read from Firestore to get updated states; otherwise use the
  // already-fetched snapshot (no jobs changed).
  const jobsToCount: Job[] = activeJobs.length > 0
    ? (await db.collection('jobs').where('batchId', '==', batchId).get()).docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Job),
      )
    : allJobs;

  let newPendingJobs = 0, newProcessingJobs = 0, newCompletedJobs = 0, newFailedJobs = 0;
  for (const job of jobsToCount) {
    if (job.status === 'pending') newPendingJobs++;
    else if (job.status === 'processing') newProcessingJobs++;
    else if (job.status === 'completed') newCompletedJobs++;
    else if (job.status === 'failed') newFailedJobs++;
  }
  const total = jobsToCount.length;
  let newStatus: BatchStatus;
  if (newCompletedJobs === total) newStatus = 'completed';
  else if (newFailedJobs === total) newStatus = 'failed';
  else if (newCompletedJobs + newFailedJobs === total) newStatus = 'partial_failed';
  else if (newProcessingJobs > 0) newStatus = 'processing';
  else newStatus = 'pending';

  await batchRef.update({
    pendingJobs: newPendingJobs,
    processingJobs: newProcessingJobs,
    completedJobs: newCompletedJobs,
    failedJobs: newFailedJobs,
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const cancelledPendingJobs = activeJobs.filter((job) => job.status === 'pending').length;
  const cancelledProcessingJobs = activeJobs.length - cancelledPendingJobs;

  return {
    success: true,
    batchId,
    cancelledJobs: activeJobs.length,
    cancelledPendingJobs,
    cancelledProcessingJobs,
  };
});
