import { onSchedule } from 'firebase-functions/v2/scheduler';
import { cleanupOldOutputStorage } from '../workers/storageCleanup';

export const storageCleanupOnSchedule = onSchedule(
  {
    schedule: 'every 24 hours',
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async () => {
    await cleanupOldOutputStorage();
  },
);
