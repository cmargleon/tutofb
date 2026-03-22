import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Job } from '../../../shared/src/types';
import { FAL_KEY, GEMINI_API_KEY, OPENAI_API_KEY } from '../config/runtime';
import { processJob } from '../workers/jobWorker';

export const processJobOnCreate = onDocumentCreated(
  {
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [FAL_KEY, OPENAI_API_KEY, GEMINI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const job = snapshot.data() as Job;
    if (job.status !== 'pending') {
      return;
    }

    await processJob(event.params.jobId, 'create');
  },
);
