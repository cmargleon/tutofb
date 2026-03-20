import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { getAppFirestore } from '../firebase/appFirestore';

export const onJobStatusChange = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data();
  const after = snapshot.after.data();

  if (before.status === after.status) return;

  const db = getAppFirestore();
  const batchRef = db.collection('batches').doc(after.batchId);

  // Update batch counters
  await db.runTransaction(async (transaction) => {
    const batchSnap = await transaction.get(batchRef);
    if (!batchSnap.exists) return;

    const batchData = batchSnap.data()!;
    let pendingJobs = batchData.pendingJobs;
    let processingJobs = batchData.processingJobs;
    let completedJobs = batchData.completedJobs;
    let failedJobs = batchData.failedJobs;

    // Remove from old status
    if (before.status === 'pending') pendingJobs--;
    if (before.status === 'processing') processingJobs--;
    if (before.status === 'completed') completedJobs--;
    if (before.status === 'failed') failedJobs--;

    // Add to new status
    if (after.status === 'pending') pendingJobs++;
    if (after.status === 'processing') processingJobs++;
    if (after.status === 'completed') completedJobs++;
    if (after.status === 'failed') failedJobs++;

    let status = batchData.status;
    if (completedJobs === batchData.totalJobs) status = 'completed';
    else if (failedJobs === batchData.totalJobs) status = 'failed';
    else if (completedJobs + failedJobs === batchData.totalJobs) status = 'partial_failed';
    else if (processingJobs > 0) status = 'processing';
    else status = 'pending';

    transaction.update(batchRef, {
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
});
