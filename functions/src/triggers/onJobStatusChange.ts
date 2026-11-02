import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Batch, BatchStatus, Job } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

export const onJobStatusChange = onDocumentUpdated({ document: 'jobs/{jobId}', memory: '512MiB' }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data();
  const after = snapshot.after.data();

  if (before.status === after.status) return;

  const db = getAppFirestore();
  const batchId = after.batchId as string;
  const batchRef = db.collection('batches').doc(batchId);

  // Recompute counters from actual job states instead of delta updates.
  // Delta updates race when many jobs change status simultaneously (e.g., bulk cancel).
  // Read jobs and batch in one transaction so an older snapshot cannot overwrite newer counters.
  await db.runTransaction(async (tx) => {
    const allJobsSnapshot = await tx.get(db.collection('jobs').where('batchId', '==', batchId));
    const batchSnapshot = await tx.get(batchRef);
    if (!batchSnapshot.exists) return;

    let pendingJobs = 0;
    let processingJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;

    for (const doc of allJobsSnapshot.docs) {
      const status = (doc.data() as Job).status;
      if (status === 'pending') pendingJobs++;
      else if (status === 'processing') processingJobs++;
      else if (status === 'completed') completedJobs++;
      else if (status === 'failed') failedJobs++;
    }

    const totalJobs = allJobsSnapshot.size;
    let status: BatchStatus;
    if (completedJobs === totalJobs) status = 'completed';
    else if (failedJobs === totalJobs) status = 'failed';
    else if (completedJobs + failedJobs === totalJobs) status = 'partial_failed';
    else if (processingJobs > 0) status = 'processing';
    else status = 'pending';

    const batch = batchSnapshot.exists ? ({ id: batchSnapshot.id, ...batchSnapshot.data() } as Batch) : null;
    const notificationUpdate =
      batch?.notification?.retryState === 'queued' && (status === 'completed' || status === 'partial_failed' || status === 'failed')
        ? {
            notification: {
              ...batch.notification,
              retryState: failedJobs > 0 ? 'failed_after_retry' : 'succeeded_after_retry',
            },
          }
        : {};

    tx.update(batchRef, {
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
      status,
      ...notificationUpdate,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
});
