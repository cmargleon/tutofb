import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  AcknowledgeBatchFailuresRequest,
  AcknowledgeBatchFailuresResponse,
  Batch,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

/**
 * Marks a batch's current failures as reviewed so Cola stops listing it under "Requieren atención".
 * Stores the failed count at review time: if a retry fails again and the count grows, the batch reappears.
 * Leaves jobs, counters and `updatedAt` untouched; the catalog keeps showing the batch as before.
 */
export const acknowledgeBatchFailures = onCall<
  AcknowledgeBatchFailuresRequest,
  Promise<AcknowledgeBatchFailuresResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador']);

  const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
  if (!batchId) {
    throw new HttpsError('invalid-argument', 'Debes indicar un lote válido.');
  }

  const db = getAppFirestore();
  const batchRef = db.collection('batches').doc(batchId);

  const acknowledgedFailedJobs = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(batchRef);
    if (!snapshot.exists) {
      throw new HttpsError('not-found', 'Lote no encontrado.');
    }

    const batch = snapshot.data() as Batch;
    const failedJobs = Number.isFinite(batch.failedJobs) ? Math.max(0, batch.failedJobs) : 0;
    transaction.update(batchRef, {
      failuresAcknowledged: {
        failedJobs,
        acknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
        acknowledgedByUid: request.auth!.uid,
      },
    });
    return failedJobs;
  });

  return { success: true, batchId, acknowledgedFailedJobs };
});
