import { Batch, Job } from '../../../shared/src/types';
import * as dateUtilsNamespace from '../../../shared/src/utils/dateUtils';
import type { CatalogGarmentGroup, CatalogSortOrder } from './useCatalogJobs';

// Same interop as tests/garmentViewMatching.test.ts: under `node --test` (tsx) shared/ loads as CommonJS,
// so its named exports only appear on `default`. Under Vite the namespace already holds them.
const { toMillisOrZero } =
  ((dateUtilsNamespace as { default?: unknown }).default as typeof import('../../../shared/src/utils/dateUtils'))
  ?? (dateUtilsNamespace as typeof import('../../../shared/src/utils/dateUtils'));

export interface PendingCatalogRegeneration {
  job: Job;
  leftCatalog: boolean;
}

export interface CatalogLightboxPosition {
  garmentIndex: number;
  jobIndex: number;
  jobId: string;
}

export type CatalogLightboxIndex = Map<string, { garmentIndex: number; jobIndex: number }>;

export const buildCatalogBatchOptions = (batches: Batch[], requestedBatch: Batch | null, selectedClientId: string) =>
  [...(requestedBatch && !batches.some((batch) => batch.id === requestedBatch.id) ? [requestedBatch] : []), ...batches].filter((batch): batch is Batch & { id: string } => Boolean(batch.id) && batch.clientId === selectedClientId);

export const resolveSelectedCatalogBatch = (
  batchOptions: Array<Batch & { id: string }>,
  selectedBatchId: string,
  requestedBatch: Batch | null,
) => (selectedBatchId ? (requestedBatch?.id === selectedBatchId ? requestedBatch : batchOptions.find((batch) => batch.id === selectedBatchId) || null) : null);

export const mergeCatalogDisplayGroups = (
  garmentGroups: CatalogGarmentGroup[],
  generatingJobs: Job[],
  pendingRegenerations: Record<string, PendingCatalogRegeneration>,
  sortOrder: CatalogSortOrder,
): CatalogGarmentGroup[] => {
  if (generatingJobs.length === 0 && Object.keys(pendingRegenerations).length === 0) {
    return garmentGroups;
  }

  const compareJobs = (left: Job, right: Job) => (
    sortOrder === 'asc'
      ? toMillisOrZero(left.createdAt) - toMillisOrZero(right.createdAt)
      : toMillisOrZero(right.createdAt) - toMillisOrZero(left.createdAt)
  );

  const grouped = new Map(
    garmentGroups.map((group) => [
      group.garmentId,
      {
        garmentId: group.garmentId,
        garmentName: group.garmentName,
        jobs: [...group.jobs],
      },
    ]),
  );

  Object.values(pendingRegenerations).forEach(({ job }) => {
    if (!job.id) {
      return;
    }

    const existingGroup = grouped.get(job.garmentId);
    if (existingGroup) {
      const existingJobIndex = existingGroup.jobs.findIndex((existingJob) => existingJob.id === job.id);
      if (existingJobIndex >= 0) {
        existingGroup.jobs[existingJobIndex] = job;
      } else {
        existingGroup.jobs.push(job);
      }
      return;
    }

    grouped.set(job.garmentId, {
      garmentId: job.garmentId,
      garmentName: job.garmentName,
      jobs: [job],
    });
  });

  const pendingRegenerationJobIds = new Set(Object.keys(pendingRegenerations));

  generatingJobs.forEach((job) => {
    if (!job.id || pendingRegenerationJobIds.has(job.id)) {
      return;
    }

    const existingGroup = grouped.get(job.garmentId);
    if (existingGroup) {
      if (!existingGroup.jobs.some((existingJob) => existingJob.id === job.id)) {
        existingGroup.jobs.push(job);
      }
      return;
    }

    grouped.set(job.garmentId, {
      garmentId: job.garmentId,
      garmentName: job.garmentName,
      jobs: [job],
    });
  });

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      jobs: [...group.jobs].sort(compareJobs),
    }))
    .sort((left, right) => compareJobs(left.jobs[0], right.jobs[0]));
};

export const reconcilePendingRegenerations = (
  prev: Record<string, PendingCatalogRegeneration>,
  garmentGroups: CatalogGarmentGroup[],
  generatingJobs: Job[],
) => {
  const visibleCatalogJobIds = new Set(
    garmentGroups.flatMap((group) => group.jobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId))),
  );
  const remotelyGeneratingJobIds = new Set(
    generatingJobs.map((job) => job.id).filter((jobId): jobId is string => Boolean(jobId)),
  );

  let changed = false;
  const next: Record<string, PendingCatalogRegeneration> = {};

  (Object.entries(prev) as Array<[string, PendingCatalogRegeneration]>).forEach(([jobId, entry]) => {
    const returnedToCatalog = entry.leftCatalog && visibleCatalogJobIds.has(jobId);
    if (returnedToCatalog) {
      changed = true;
      return;
    }

    const leftCatalog = entry.leftCatalog || remotelyGeneratingJobIds.has(jobId) || !visibleCatalogJobIds.has(jobId);
    if (leftCatalog !== entry.leftCatalog) {
      changed = true;
    }

    next[jobId] = {
      ...entry,
      leftCatalog,
    };
  });

  return changed ? next : prev;
};

export const buildCatalogLightboxIndex = (displayGarmentGroups: CatalogGarmentGroup[]): CatalogLightboxIndex => {
  const map = new Map<string, { garmentIndex: number; jobIndex: number }>();
  displayGarmentGroups.forEach((group, garmentIndex) => {
    group.jobs.forEach((job, jobIndex) => {
      if (job.id) map.set(job.id, { garmentIndex, jobIndex });
    });
  });
  return map;
};

export const getPreviousLightboxTarget = (
  displayGarmentGroups: CatalogGarmentGroup[],
  lightbox: CatalogLightboxPosition | null,
): CatalogLightboxPosition | null => {
  if (!lightbox) return null;
  const group = displayGarmentGroups[lightbox.garmentIndex];
  if (!group) return null;
  const prev = group.jobs[lightbox.jobIndex - 1];
  if (prev?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex - 1, jobId: prev.id };
  const prevGroup = displayGarmentGroups[lightbox.garmentIndex - 1];
  const prevGroupLast = prevGroup?.jobs[prevGroup.jobs.length - 1];
  if (prevGroupLast?.id) return { garmentIndex: lightbox.garmentIndex - 1, jobIndex: prevGroup.jobs.length - 1, jobId: prevGroupLast.id };
  return null;
};

export const getNextLightboxTarget = (
  displayGarmentGroups: CatalogGarmentGroup[],
  lightbox: CatalogLightboxPosition | null,
): CatalogLightboxPosition | null => {
  if (!lightbox) return null;
  const group = displayGarmentGroups[lightbox.garmentIndex];
  if (!group) return null;
  const next = group.jobs[lightbox.jobIndex + 1];
  if (next?.id) return { garmentIndex: lightbox.garmentIndex, jobIndex: lightbox.jobIndex + 1, jobId: next.id };
  const nextGroup = displayGarmentGroups[lightbox.garmentIndex + 1];
  const nextGroupFirst = nextGroup?.jobs[0];
  if (nextGroupFirst?.id) return { garmentIndex: lightbox.garmentIndex + 1, jobIndex: 0, jobId: nextGroupFirst.id };
  return null;
};

export const resolveLightboxJob = (
  displayGarmentGroups: CatalogGarmentGroup[],
  lightbox: CatalogLightboxPosition | null,
  lightboxIndexByJobId: CatalogLightboxIndex,
) => {
  if (!lightbox) return null;
  const indexed = displayGarmentGroups[lightbox.garmentIndex]?.jobs[lightbox.jobIndex];
  if (indexed?.id === lightbox.jobId) return indexed;
  const fallback = lightboxIndexByJobId.get(lightbox.jobId);
  if (!fallback) return null;
  return displayGarmentGroups[fallback.garmentIndex]?.jobs[fallback.jobIndex] || null;
};
