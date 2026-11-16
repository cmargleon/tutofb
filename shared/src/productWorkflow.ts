import { resolveApprovedJobOutput } from './domain';
import type { Job } from './types';

/** Mirrors the effective selection used by the marketplace export. */
export const isApprovedProductPhoto = (job: Job, output = resolveApprovedJobOutput(job)): boolean => Boolean(
  job.status === 'completed' && !job.manuallyFlagged && output && typeof output.id === 'string' && output.id
  && typeof output.resultImagePath === 'string' && output.resultImagePath.startsWith(`generated/${job.clientId}/${job.batchId}/`)
  && (Boolean(job.userSelectedOutput?.id && job.userSelectedOutput.id === output.id) || output.autoReview?.verdict === 'approved'),
);

export function productPhotoStatus(job: Job) {
  if (job.status === 'pending' || job.status === 'processing') return 'inProgress';
  if (job.status === 'failed' && job.failureInfo?.reasonCode === 'manual_cancellation') return 'cancelled';
  return isApprovedProductPhoto(job) ? 'approved' : 'attention';
}
