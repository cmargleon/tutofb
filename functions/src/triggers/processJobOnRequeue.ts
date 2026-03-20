import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Job } from '../../../shared/src/types';
import { FAL_KEY, OPENAI_API_KEY } from '../config/runtime';
import { processJob } from '../workers/jobWorker';

export const processJobOnRequeue = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [FAL_KEY, OPENAI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const before = snapshot.before.data() as Job;
    const after = snapshot.after.data() as Job;

    if (before.status !== 'pending' && after.status === 'pending') {
      await processJob(event.params.jobId, 'requeue');
    }
  },
);
