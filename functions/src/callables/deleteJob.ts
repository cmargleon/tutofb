import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Job } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { recomputeBatchCounters } from '../batches/batchCounters';
import { getAppFirestore } from '../firebase/appFirestore';

export const deleteJob = onCall<{ jobId: string }, Promise<{ success: boolean; jobId: string }>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);

    const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
    if (!jobId) {
      throw new HttpsError('invalid-argument', 'Debes indicar el trabajo a borrar.');
    }

    const db = getAppFirestore();
    const jobRef = db.collection('jobs').doc(jobId);
    const jobSnapshot = await jobRef.get();

    if (!jobSnapshot.exists) {
      throw new HttpsError('not-found', 'Trabajo no encontrado.');
    }

    const job = { id: jobSnapshot.id, ...jobSnapshot.data() } as Job;

    if (job.status === 'pending' || job.status === 'processing') {
      throw new HttpsError(
        'failed-precondition',
        'No se puede borrar un trabajo que está en procesamiento. Cancélalo primero.',
      );
    }

    const batchId = job.batchId;

    await jobRef.delete();

    if (batchId) {
      // Deleting a job fires no onJobStatusChange, so totalJobs is recomputed here too.
      await recomputeBatchCounters(db, batchId, { writeTotalJobs: true });
    }

    return { success: true, jobId };
  },
);
