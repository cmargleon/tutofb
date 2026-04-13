import { Batch, BatchStatus } from '../../../shared/src/types';

export type BatchNotificationOutcome = 'completed' | 'failed';

export interface BatchNotificationItem {
  batch: Batch & { id: string };
  outcome: BatchNotificationOutcome;
  updatedAtMs: number;
  canRetry: boolean;
  showReviewIcon: boolean;
}

const FINAL_BATCH_STATUSES = new Set<BatchStatus>(['completed', 'partial_failed', 'failed']);

const toMillisOrZero = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as any).toMillis === 'function') {
    return (value as any).toMillis();
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate().getTime();
  }
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const isFinalBatchStatus = (status: BatchStatus): boolean => FINAL_BATCH_STATUSES.has(status);

export const resolveBatchNotificationOutcome = (batch: Pick<Batch, 'failedJobs'>): BatchNotificationOutcome =>
  batch.failedJobs > 0 ? 'failed' : 'completed';

export const buildBatchNotificationItem = (batch: Batch & { id: string }): BatchNotificationItem => {
  const outcome = resolveBatchNotificationOutcome(batch);
  const retryState = batch.notification?.retryState ?? null;

  return {
    batch,
    outcome,
    updatedAtMs: toMillisOrZero(batch.updatedAt),
    canRetry: outcome === 'failed' && retryState !== 'failed_after_retry' && retryState !== 'queued',
    showReviewIcon: outcome === 'failed' && retryState === 'failed_after_retry',
  };
};

export const buildBatchNotificationDescription = (batch: Pick<Batch, 'completedJobs' | 'failedJobs' | 'totalJobs'>): string => {
  if (batch.failedJobs > 0) {
    return `${batch.completedJobs}/${batch.totalJobs} ok · ${batch.failedJobs} fallidos`;
  }

  return `${batch.completedJobs}/${batch.totalJobs} completados`;
};
