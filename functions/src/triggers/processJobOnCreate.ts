import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { processJob } from '../workers/jobWorker';
import { Job } from '../../../shared/src/types';

export const processJobOnCreate = onDocumentCreated({
  document: 'jobs/{jobId}',
  timeoutSeconds: 540,
  memory: '512MiB'
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const job = snapshot.data() as Job;
  if (job.status !== 'pending') return;

  await processJob(event.params.jobId, job);
});
