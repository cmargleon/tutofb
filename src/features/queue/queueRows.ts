import { Batch, Job, Provider } from '../../../shared/src/types';
import * as dateUtilsNamespace from '../../../shared/src/utils/dateUtils';

// Same interop as tests/garmentViewMatching.test.ts: under `node --test` (tsx) shared/ loads as CommonJS,
// so its named exports only appear on `default`. Under Vite the namespace already holds them.
const { toMillis } =
  ((dateUtilsNamespace as { default?: unknown }).default as typeof import('../../../shared/src/utils/dateUtils'))
  ?? (dateUtilsNamespace as typeof import('../../../shared/src/utils/dateUtils'));

export interface QueueRow {
  id: string;
  batch: Batch;
  jobs: Job[];
  etaSeconds: number | null;
  ageStartedAt: number | null;
}

export type KanbanStage = 'pending' | 'processing' | 'ready';

export type QueueBusyAction = 'retry' | 'cancel' | null;

export interface QueueFilters {
  clientFilter: string;
  providerFilter: 'all' | Provider;
  statusFilter: 'all' | Batch['status'];
}

export const average = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const formatRelativeDuration = (seconds: number | null) => {
  if (seconds === null || Number.isNaN(seconds)) {
    return 'n/d';
  }

  // Round once to the displayed unit before choosing it, so 59.6 s reads "1 min" and
  // 59 min 40 s reads "1 h" instead of "60 s" / "60 min" / "1 h 60 min".
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) {
    return `${Math.max(1, roundedSeconds)} s`;
  }

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
};

export const formatElapsedSince = (millis: number | null) => {
  if (millis === null) {
    return 'n/d';
  }

  return formatRelativeDuration((Date.now() - millis) / 1000);
};

export const getCompletedJobDuration = (job: Job) => {
  if (job.status !== 'completed') {
    return null;
  }

  const duration = job.currentOutput?.durationSeconds ?? job.totalDurationSeconds ?? null;
  return duration && duration > 0 ? duration : null;
};

export const getKanbanStage = (row: QueueRow): KanbanStage => {
  if (row.batch.processingJobs > 0 || row.batch.status === 'processing') {
    return 'processing';
  }

  if (
    row.batch.completedJobs > 0 ||
    row.batch.failedJobs > 0 ||
    row.batch.status === 'partial_failed' ||
    row.batch.status === 'failed'
  ) {
    return 'ready';
  }

  return 'pending';
};

export const buildQueueRows = (batches: Batch[], jobsByBatch: Record<string, Job[]>): QueueRow[] => {
  const fallbackAverageSeconds = average(
    Object.values(jobsByBatch)
      .flat()
      .map(getCompletedJobDuration)
      .filter((value): value is number => value !== null),
  );

  return batches.map((batch) => {
    const jobs = batch.id ? jobsByBatch[batch.id] || [] : [];
    const batchAverageSeconds = average(
      jobs.map(getCompletedJobDuration).filter((value): value is number => value !== null),
    ) ?? fallbackAverageSeconds;
    const queuedJobs = batch.pendingJobs + batch.processingJobs;
    const parallelSlots = Math.max(batch.processingJobs, 1);
    const etaSeconds = queuedJobs > 0 && batchAverageSeconds
      ? Math.ceil((queuedJobs * batchAverageSeconds) / parallelSlots)
      : null;
    const oldestQueuedJob = jobs
      .filter((job) => job.status === 'pending' || job.status === 'processing')
      .reduce((oldest: number | null, job) => {
        const createdAt = toMillis(job.createdAt);
        if (createdAt === null) {
          return oldest;
        }

        if (oldest === null || createdAt < oldest) {
          return createdAt;
        }

        return oldest;
      }, null);

    return {
      id: batch.id!,
      batch,
      jobs,
      etaSeconds,
      ageStartedAt: oldestQueuedJob ?? toMillis(batch.createdAt),
    };
  });
};

export const getQueueClientOptions = (rows: QueueRow[]) =>
  Array.from(new Set(rows.map((row) => row.batch.clientNameSnapshot) as string[])).sort((left, right) => left.localeCompare(right));

export const getQueueProviderOptions = (rows: QueueRow[]) =>
  Array.from(new Set(rows.map((row) => row.batch.provider) as Provider[]));

export const filterQueueRows = (rows: QueueRow[], { clientFilter, providerFilter, statusFilter }: QueueFilters) =>
  rows.filter((row) => {
    if (clientFilter !== 'all' && row.batch.clientNameSnapshot !== clientFilter) {
      return false;
    }

    if (providerFilter !== 'all' && row.batch.provider !== providerFilter) {
      return false;
    }

    if (statusFilter !== 'all' && row.batch.status !== statusFilter) {
      return false;
    }

    return true;
  });

export const groupQueueRowsByStage = (rows: QueueRow[]) =>
  rows.reduce(
    (acc, row) => {
      acc[getKanbanStage(row)].push(row);
      return acc;
    },
    { pending: [], processing: [], ready: [] } as Record<KanbanStage, QueueRow[]>,
  );

export const sumQueueTotals = (rows: QueueRow[]) =>
  rows.reduce(
    (acc, row) => {
      acc.pending += row.batch.pendingJobs;
      acc.processing += row.batch.processingJobs;
      acc.failed += row.batch.failedJobs;
      return acc;
    },
    { pending: 0, processing: 0, failed: 0 },
  );
