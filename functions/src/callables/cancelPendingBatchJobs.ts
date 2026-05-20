import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  BatchStatus,
  CancelPendingBatchJobsRequest,
  CancelPendingBatchJobsResponse,
  Job,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { buildManualCancellationFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { getAppFirestore } from '../firebase/appFirestore';

export const cancelPendingBatchJobs = onCall<
  CancelPendingBatchJobsRequest,
  Promise<CancelPendingBatchJobsResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador']);

  const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
  if (!batchId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un lote válido.');
  }

  const db = getAppFirestore();
  const batchSnapshot = await db.collection('batches').doc(batchId).get();
  if (!batchSnapshot.exists) {
    throw new HttpsError('not-found', 'Lote no encontrado.');
  }

  const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();
  const pendingJobs = jobsSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job))
    .filter((job) => job.status === 'pending' || job.status === 'processing');

  if (pendingJobs.length === 0) {
    return {
      success: true,
      batchId,
      cancelledJobs: 0,
    };
  }

  const writeBatch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  pendingJobs.forEach((job) => {
    const jobRef = db.collection('jobs').doc(job.id!);
    const failureInfo = buildManualCancellationFailureInfo({
      userMessage: 'El job fue cancelado manualmente desde la cola.',
      technicalMessage: 'Se canceló el job antes de completar la generación desde la vista de cola.',
    });

    writeBatch.update(jobRef, {
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

    writeBatch.set(jobRef.collection('logs').doc(), {
      type: 'system',
      level: 'warn',
      message: 'El job pendiente fue cancelado manualmente desde la cola.',
      payload: {
        requestedByUid: request.auth!.uid,
        source: 'queue_cancel_pending',
        batchId,
        failureInfo,
      },
      createdAt: now,
    });
  });

  await writeBatch.commit();

  // Recompute batch counters directly from Firestore to avoid race conditions
  // with concurrent onJobStatusChange triggers that may exhaust retry limits.
  const batchRef = db.collection('batches').doc(batchId);
  const allJobsAfter = await db.collection('jobs').where('batchId', '==', batchId).get();
  let newPendingJobs = 0, newProcessingJobs = 0, newCompletedJobs = 0, newFailedJobs = 0;
  for (const doc of allJobsAfter.docs) {
    const s = (doc.data() as Job).status;
    if (s === 'pending') newPendingJobs++;
    else if (s === 'processing') newProcessingJobs++;
    else if (s === 'completed') newCompletedJobs++;
    else if (s === 'failed') newFailedJobs++;
  }
  const total = allJobsAfter.size;
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

  return {
    success: true,
    batchId,
    cancelledJobs: pendingJobs.length,
  };
});
