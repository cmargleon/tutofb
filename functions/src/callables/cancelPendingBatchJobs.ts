import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  CancelPendingBatchJobsRequest,
  CancelPendingBatchJobsResponse,
  Job,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
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
    .filter((job) => job.status === 'pending');

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
      lastError: 'Cancelado manualmente desde la cola.',
    });

    writeBatch.set(jobRef.collection('logs').doc(), {
      type: 'system',
      level: 'warn',
      message: 'El job pendiente fue cancelado manualmente desde la cola.',
      payload: {
        requestedByUid: request.auth!.uid,
        source: 'queue_cancel_pending',
        batchId,
      },
      createdAt: now,
    });
  });

  await writeBatch.commit();

  return {
    success: true,
    batchId,
    cancelledJobs: pendingJobs.length,
  };
});
