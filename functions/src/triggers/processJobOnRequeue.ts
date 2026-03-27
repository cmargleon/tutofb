import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { Job } from '../../../shared/src/types';
import { FAL_KEY, GEMINI_API_KEY, OPENAI_API_KEY } from '../config/runtime';
import { processJob } from '../workers/jobWorker';

export const processJobOnRequeue = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 5,
    secrets: [FAL_KEY, OPENAI_API_KEY, GEMINI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const before = snapshot.before.data() as Job;
    const after = snapshot.after.data() as Job;

    if (before.status === 'pending' || after.status !== 'pending') {
      return;
    }

    // If this is a deferred retry, skip now — the scheduled sweeper will pick it up.
    if (after.retryNotBefore) {
      const notBefore = after.retryNotBefore as Timestamp;
      if (typeof notBefore.toMillis === 'function' && notBefore.toMillis() > Date.now()) {
        return;
      }
    }

    await processJob(event.params.jobId, 'requeue');
  },
);
