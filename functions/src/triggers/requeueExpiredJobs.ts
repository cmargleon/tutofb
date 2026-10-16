import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FAL_KEY, GEMINI_API_KEY } from '../config/runtime';
import { requeueExpiredJobs } from '../workers/jobWorker';

export const requeueExpiredJobsOnSchedule = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 300,
    memory: '2GiB',
    secrets: [FAL_KEY, GEMINI_API_KEY],
  },
  async () => {
    await requeueExpiredJobs();
  },
);
