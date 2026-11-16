import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { getApprovedReviewOutput } from '../../../shared/src/jobReview';
import type { Batch, Job } from '../../../shared/src/types';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { getJobFailureInfo, isFailureCancellation } from '../catalog/errorMessage';

export const catalogBatchUrl = (clientId: string, batchId: string) =>
  `/catalogo?${new URLSearchParams({ clientId, batchId })}`;

export interface BatchAttention {
  batch: Batch;
  pendingReview: number;
  incidents: number;
  generating: boolean;
}

export function summarizeBatchAttention(batch: Batch, jobs: Job[], now: number): BatchAttention {
  let pendingReview = 0;
  let incidents = 0;
  let generating = false;
  for (const job of jobs) {
    const output = resolveApprovedJobOutput(job);
    const lease = toMillis(job.claimExpiresAt);
    const hasImage = Boolean(output?.id && output.resultImagePath?.trim() && !output.storageDeletedAt);
    const completed = job.status === 'completed';

    generating ||= job.status === 'pending' || job.status === 'processing';
    if ((job.status === 'failed' && !isFailureCancellation(job.failureInfo ?? getJobFailureInfo(job)))
      || (job.status === 'processing' && lease !== null && lease < now)
      || job.manuallyFlagged
      || (completed && !hasImage)) {
      incidents++;
    } else if (completed && hasImage && !getApprovedReviewOutput(job)?.id) {
      pendingReview++;
    }
  }
  return { batch, pendingReview, incidents, generating };
}
