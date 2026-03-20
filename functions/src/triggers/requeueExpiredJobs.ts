import { onSchedule } from 'firebase-functions/v2/scheduler';
import { requeueExpiredJobs } from '../workers/jobWorker';

export const requeueExpiredJobsOnSchedule = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    await requeueExpiredJobs();
  },
);
