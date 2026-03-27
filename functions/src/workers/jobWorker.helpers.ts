import { Job } from '../../../shared/src/types';

export const shouldBackstopPendingJob = (job: Pick<Job, 'status' | 'retryNotBefore' | 'claimToken'>): boolean => {
  if (job.status !== 'pending') {
    return false;
  }

  if (job.claimToken) {
    return false;
  }

  return !job.retryNotBefore;
};
