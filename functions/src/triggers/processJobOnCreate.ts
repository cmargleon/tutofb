import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Job } from '../../../shared/src/types';
import { FAL_KEY, GEMINI_API_KEY } from '../config/runtime';
import { processJob } from '../workers/jobWorker';

export const processJobOnCreate = onDocumentCreated(
  {
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '2GiB',
    maxInstances: 20,
    secrets: [FAL_KEY, GEMINI_API_KEY],
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

    // skipBacklogSweep: true — same reason as processJobOnRequeue: when N jobs are created
    // simultaneously (e.g., new batch), N trigger instances fire in parallel and would each
    // sweep all other pending jobs, causing claim token stampedes. Scheduled sweeper handles orphans.
    await processJob(event.params.jobId, 'create', { skipBacklogSweep: true });
  },
);
