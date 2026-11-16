import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { recomputeBatchCounters } from '../batches/batchCounters';
import { getAppFirestore } from '../firebase/appFirestore';

export const onJobStatusChange = onDocumentUpdated({ document: 'jobs/{jobId}', memory: '512MiB' }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data();
  const after = snapshot.after.data();

  if (before.status === after.status) return;

  // Recompute counters from actual job states (count() aggregations) instead of delta
  // updates, which race when many jobs change status simultaneously (e.g., bulk cancel).
  // See recomputeBatchCounters for how concurrent calls converge on the final values.
  await recomputeBatchCounters(getAppFirestore(), after.batchId as string);
});
