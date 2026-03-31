import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  CancelBatchProcessingRequest,
  CancelBatchProcessingResponse,
  Job,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
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

  const activeJobs = jobsSnapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job))
    .filter((job) => job.status === 'pending' || job.status === 'processing');

  if (activeJobs.length === 0) {
    return {
      success: true,
      batchId,
      cancelledJobs: 0,
      cancelledPendingJobs: 0,
      cancelledProcessingJobs: 0,
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const requestedByDisplayName =
    userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
      ? userSnapshot.data()!.displayName
      : null;

  const bulkWriter = db.bulkWriter();

  activeJobs.forEach((job) => {
    const wasProcessing = job.status === 'processing';
    const jobRef = db.collection('jobs').doc(job.id!);

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
      lastError: wasProcessing
        ? 'Cancelado manualmente mientras el lote estaba en procesamiento.'
        : 'Cancelado manualmente antes de comenzar la generacion del lote.',
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
      },
      createdAt: now,
    });
  });

  await bulkWriter.close();

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
