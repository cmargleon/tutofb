import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { processJob } from '../workers/jobWorker';
import { Job } from '../../../shared/src/types';

export const processJobOnRequeue = onDocumentUpdated({
  document: 'jobs/{jobId}',
  timeoutSeconds: 540,
  memory: '512MiB'
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const before = snapshot.before.data() as Job;
  const after = snapshot.after.data() as Job;

  if (before.status !== 'pending' && after.status === 'pending') {
    await processJob(event.params.jobId, after);
  }
});
