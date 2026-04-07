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
    maxInstances: 20,
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

    // skipBacklogSweep: true — when N jobs are retried simultaneously, N trigger instances
    // fire in parallel. Without this flag, each instance would also sweep and try to process
    // all other pending jobs, causing a stampede that corrupts claim tokens and discards results
    // (while still spending API credits). The scheduled sweeper handles orphans every 5 min.
    await processJob(event.params.jobId, 'requeue', { skipBacklogSweep: true });
  },
);
