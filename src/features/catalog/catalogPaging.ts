import type { Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';

/**
 * Client-wide catalog paging that never splits an article across pages.
 *
 * Every job of a batch is written in one transaction with the same
 * serverTimestamp, so an article's jobs share one `createdAt`. Firestore orders
 * ties by document id, which scatters an article inside its batch. Reading
 * until `createdAt` changes therefore closes every article seen so far, and the
 * buffered jobs after the cut feed the next page without being read again.
 */

export const isRenderableCatalogJob = (job: Job): boolean =>
  job.status === 'failed'
  || (job.status === 'completed' && Boolean(resolveApprovedJobOutput(job)?.resultImagePath));

/** Exact key of a Firestore timestamp; millisecond precision could merge two batches. */
export const catalogCreatedAtKey = (value: unknown): string => {
  if (value && typeof value === 'object' && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds?: number };
    return `${seconds}.${String(nanoseconds ?? 0).padStart(9, '0')}`;
  }
  return `ms:${toMillisOrZero(value)}`;
};

export interface CatalogPagingState<TCursor> {
  /** Jobs already read from Firestore and not shown on an earlier page, in query order. */
  buffer: Job[];
  /** Last document read, for `startAfter`. */
  cursor: TCursor | null;
  /** The query has no documents after `cursor`. */
  exhausted: boolean;
}

export interface CatalogPageSlice {
  /** Renderable jobs of the page, in query order. */
  jobs: Job[];
  /** Buffered jobs left for the following pages. */
  rest: Job[];
}

/**
 * Takes whole articles from the front of the buffer until the page holds at
 * least `pageSize` renderable jobs. Returns null when more documents are needed
 * to fill the page or to know that its last article is complete.
 */
export const carveCatalogPage = (buffer: Job[], exhausted: boolean, pageSize: number): CatalogPageSlice | null => {
  const openKey = exhausted || buffer.length === 0 ? null : catalogCreatedAtKey(buffer[buffer.length - 1].createdAt);
  const openGarments = new Set(openKey === null
    ? []
    : buffer.filter((job) => catalogCreatedAtKey(job.createdAt) === openKey).map((job) => job.garmentId));

  const order: string[] = [];
  const jobsByGarment = new Map<string, Job[]>();
  for (const job of buffer) {
    const jobs = jobsByGarment.get(job.garmentId);
    if (jobs) jobs.push(job);
    else {
      jobsByGarment.set(job.garmentId, [job]);
      order.push(job.garmentId);
    }
  }

  const taken = new Set<string>();
  let renderable = 0;
  for (const garmentId of order) {
    // Later documents could still belong to this article: stop to keep the page order.
    if (openGarments.has(garmentId)) break;
    taken.add(garmentId);
    renderable += jobsByGarment.get(garmentId)!.filter(isRenderableCatalogJob).length;
    if (renderable >= pageSize) break;
  }

  if (renderable < pageSize && !exhausted) return null;
  return {
    jobs: buffer.filter((job) => taken.has(job.garmentId) && isRenderableCatalogJob(job)),
    rest: buffer.filter((job) => !taken.has(job.garmentId)),
  };
};

export interface CatalogChunk<TCursor> {
  jobs: Job[];
  cursor: TCursor | null;
  exhausted: boolean;
}

export interface BuiltCatalogPage<TCursor> {
  jobs: Job[];
  next: CatalogPagingState<TCursor>;
  hasMore: boolean;
}

/** Reads chunks of `chunkSize` documents until `carveCatalogPage` can close a page. */
export const buildCatalogPage = async <TCursor>(
  start: CatalogPagingState<TCursor>,
  pageSize: number,
  fetchChunk: (cursor: TCursor | null, limit: number) => Promise<CatalogChunk<TCursor>>,
  chunkSize: number = pageSize,
): Promise<BuiltCatalogPage<TCursor>> => {
  let { buffer, cursor, exhausted } = start;
  for (;;) {
    const slice = carveCatalogPage(buffer, exhausted, pageSize);
    if (slice) {
      return {
        jobs: slice.jobs,
        next: { buffer: slice.rest, cursor, exhausted },
        hasMore: !exhausted || slice.rest.some(isRenderableCatalogJob),
      };
    }
    const chunk = await fetchChunk(cursor, chunkSize);
    buffer = [...buffer, ...chunk.jobs];
    cursor = chunk.cursor ?? cursor;
    exhausted = chunk.exhausted;
  }
};
