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

/** Where a batch shows up in Cola. `null` means it is old or fully reviewed and stays only in the catalog. */
export type QueueSection = 'active' | 'attention' | 'recent';

export type QueueBusyAction = 'retry' | 'cancel' | 'acknowledge' | null;

export interface QueueFilters {
  clientFilter: string;
  providerFilter: 'all' | Provider;
}

/** Unreviewed failures stay in "Requieren atención" this long after the batch last changed. */
export const ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Finished batches stay in "Recientes" this long after they last changed. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export const isActiveBatch = (batch: Batch) =>
  batch.pendingJobs + batch.processingJobs > 0 || batch.status === 'pending' || batch.status === 'processing';

/** Failures not yet covered by an operator's "Descartar": a retry that fails again raises the count and resurfaces the batch. */
export const getUnreviewedFailedJobs = (batch: Batch) =>
  Math.max(0, batch.failedJobs - (batch.failuresAcknowledged?.failedJobs ?? 0));

export const getBatchUpdatedAt = (batch: Batch) => toMillis(batch.updatedAt) ?? toMillis(batch.createdAt);

export const getQueueSection = (row: QueueRow, now = Date.now()): QueueSection | null => {
  if (isActiveBatch(row.batch)) {
    return 'active';
  }

  const updatedAt = getBatchUpdatedAt(row.batch);
  const age = updatedAt === null ? Number.POSITIVE_INFINITY : now - updatedAt;
  if (getUnreviewedFailedJobs(row.batch) > 0 && age <= ATTENTION_WINDOW_MS) {
    return 'attention';
  }

  return age <= RECENT_WINDOW_MS ? 'recent' : null;
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

export const filterQueueRows = (rows: QueueRow[], { clientFilter, providerFilter }: QueueFilters) =>
  rows.filter((row) =>
    (clientFilter === 'all' || row.batch.clientNameSnapshot === clientFilter)
    && (providerFilter === 'all' || row.batch.provider === providerFilter));

const byUpdatedDesc = (left: QueueRow, right: QueueRow) =>
  (getBatchUpdatedAt(right.batch) ?? 0) - (getBatchUpdatedAt(left.batch) ?? 0);

/** Active batches oldest-first (the one waiting longest on top); finished ones newest-first. */
export const groupQueueRowsBySection = (rows: QueueRow[], now = Date.now()) => {
  const sections: Record<QueueSection, QueueRow[]> = { active: [], attention: [], recent: [] };
  rows.forEach((row) => {
    const section = getQueueSection(row, now);
    if (section) {
      sections[section].push(row);
    }
  });
  sections.active.sort((left, right) => (left.ageStartedAt ?? 0) - (right.ageStartedAt ?? 0));
  sections.attention.sort(byUpdatedDesc);
  sections.recent.sort(byUpdatedDesc);
  return sections;
};

export interface QueueSummary {
  activeJobs: number;
  activeBatches: number;
  /** Batches run in parallel, so the whole queue drains when its slowest batch does. */
  etaSeconds: number | null;
  attentionBatches: number;
  attentionFailedJobs: number;
}

export const summarizeQueue = (sections: Record<QueueSection, QueueRow[]>): QueueSummary => {
  const etas = sections.active.map((row) => row.etaSeconds).filter((value): value is number => value !== null);
  return {
    activeJobs: sections.active.reduce((sum, row) => sum + row.batch.pendingJobs + row.batch.processingJobs, 0),
    activeBatches: sections.active.length,
    etaSeconds: etas.length ? Math.max(...etas) : null,
    attentionBatches: sections.attention.length,
    attentionFailedJobs: sections.attention.reduce((sum, row) => sum + getUnreviewedFailedJobs(row.batch), 0),
  };
};
