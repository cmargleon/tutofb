import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { BatchStatus, Job } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
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
      const batchRef = db.collection('batches').doc(batchId);
      const allJobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();

      let pendingJobs = 0;
      let processingJobs = 0;
      let completedJobs = 0;
      let failedJobs = 0;

      for (const jobDoc of allJobsSnapshot.docs) {
        const status = (jobDoc.data() as Job).status;
        if (status === 'pending') pendingJobs++;
        else if (status === 'processing') processingJobs++;
        else if (status === 'completed') completedJobs++;
        else if (status === 'failed') failedJobs++;
      }

      const totalJobs = allJobsSnapshot.size;
      let batchStatus: BatchStatus;
      if (totalJobs === 0 || completedJobs === totalJobs) batchStatus = 'completed';
      else if (failedJobs === totalJobs) batchStatus = 'failed';
      else if (completedJobs + failedJobs === totalJobs) batchStatus = 'partial_failed';
      else if (processingJobs > 0) batchStatus = 'processing';
      else batchStatus = 'pending';

      await batchRef.update({
        totalJobs,
        pendingJobs,
        processingJobs,
        completedJobs,
        failedJobs,
        status: batchStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { success: true, jobId };
  },
);
