import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { BatchStatus, Job } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

export const onJobStatusChange = onDocumentUpdated('jobs/{jobId}', async (event) => {
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
  // All concurrent triggers compute the same final state, so the last write wins correctly.
  const allJobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();

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

  await batchRef.update({
    pendingJobs,
    processingJobs,
    completedJobs,
    failedJobs,
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});
