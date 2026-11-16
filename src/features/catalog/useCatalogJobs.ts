import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Batch, Job } from '../../../shared/src/types';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { subscribeToCatalogBatchJobs } from './firebase';
import { buildCatalogPage, CatalogChunk, CatalogPagingState, isRenderableCatalogJob } from './catalogPaging';

const BATCH_OPTIONS_LIMIT = 200;
const EMPTY_JOBS: Job[] = [];

type JobDocumentSnapshot = QueryDocumentSnapshot<DocumentData>;
export type CatalogSortOrder = 'asc' | 'desc';

export interface CatalogGarmentGroup {
  garmentId: string;
  garmentName: string;
  jobs: Job[];
}

interface CatalogJobsParams {
  clientId: string | null;
  batchId: string | null;
  pageSize: number;
  sortOrder: CatalogSortOrder;
  includeAllBatchJobs?: boolean;
}

interface CatalogPage {
  jobs: Job[];
  /** Read-ahead state the following page starts from. */
  next: CatalogPagingState<JobDocumentSnapshot>;
  hasMore: boolean;
}

interface CatalogBatchResult {
  scope: string;
  jobs: Job[];
  error: string | null;
}

const toJob = (docSnapshot: JobDocumentSnapshot): Job => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job;

const compareJobsByCreatedAt = (left: Job, right: Job, sortOrder: CatalogSortOrder): number => (
  sortOrder === 'asc'
    ? toMillisOrZero(left.createdAt) - toMillisOrZero(right.createdAt)
    : toMillisOrZero(right.createdAt) - toMillisOrZero(left.createdAt)
);

const buildCatalogQueryConstraints = ({
  clientId,
  sortOrder,
}: Pick<CatalogJobsParams, 'clientId' | 'sortOrder'>): QueryConstraint[] => [
  where('clientId', '==', clientId),
  where('status', 'in', ['completed', 'failed']),
  orderBy('createdAt', sortOrder),
];

export const useCatalogJobs = ({ clientId, batchId, pageSize, sortOrder, includeAllBatchJobs = false }: CatalogJobsParams) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pages, setPages] = useState<CatalogPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [batchResult, setBatchResult] = useState<CatalogBatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const liveFirstPageSignatureRef = useRef('');
  // Chunks already read for this scope, keyed by cursor: prefetch, navigation and
  // live first-page rebuilds share them instead of reading the same documents again.
  const chunkCacheRef = useRef(new Map<string, Promise<CatalogChunk<JobDocumentSnapshot>>>());

  const currentPage = currentPageIndex + 1;
  const batchScope = JSON.stringify([clientId, batchId, sortOrder]);
  const activeBatchResult = batchResult?.scope === batchScope ? batchResult : null;

  useEffect(() => {
    setPages([]);
    setCurrentPageIndex(0);
    setLoading(false);
    setError(null);
    liveFirstPageSignatureRef.current = '';
    chunkCacheRef.current = new Map();
  }, [batchId, clientId, pageSize, sortOrder]);

  useEffect(() => {
    if (!clientId) {
      setBatches([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setError(null);

    const batchesQuery = query(
      collection(db, 'batches'),
      where('clientId', '==', clientId),
      orderBy('createdAt', 'desc'),
      limit(BATCH_OPTIONS_LIMIT),
    );

    const unsubscribe = onSnapshot(
      batchesQuery,
      (snapshot) => {
        setBatches(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch)));
      },
      () => {
        setBatches([]);
        setError('Error cargando lotes del catálogo');
      },
    );

    return () => unsubscribe();
  }, [clientId]);

  // Keep every job needed for grouping, review and article downloads. One
  // snapshot also keeps transitions between generating and finished atomic.
  useEffect(() => {
    setBatchResult(null);
    if (!clientId || !batchId) return undefined;

    return subscribeToCatalogBatchJobs(
      clientId,
      batchId,
      sortOrder,
      (jobs) => setBatchResult({ scope: batchScope, jobs, error: null }),
      () => setBatchResult((current) => ({
        scope: batchScope,
        jobs: current?.jobs ?? EMPTY_JOBS,
        error: 'Error cargando imágenes del catálogo',
      })),
    );
  }, [clientId, batchId, sortOrder, batchScope]);

  const fetchChunk = useCallback(
    (cursor: JobDocumentSnapshot | null, chunkLimit: number): Promise<CatalogChunk<JobDocumentSnapshot>> => {
      if (!clientId) return Promise.resolve({ jobs: [], cursor: null, exhausted: true });
      const cacheKey = `${cursor?.id ?? ''}:${chunkLimit}`;
      const cached = chunkCacheRef.current.get(cacheKey);
      if (cached) return cached;
      const constraints = [...buildCatalogQueryConstraints({ clientId, sortOrder }), limit(chunkLimit)];
      const catalogQuery = cursor
        ? query(collection(db, 'jobs'), ...constraints, startAfter(cursor))
        : query(collection(db, 'jobs'), ...constraints);
      const cache = chunkCacheRef.current;
      const promise = getDocs(catalogQuery).then((snapshot) => ({
        jobs: snapshot.docs.map(toJob),
        cursor: snapshot.docs[snapshot.docs.length - 1] ?? cursor,
        exhausted: snapshot.docs.length < chunkLimit,
      }));
      cache.set(cacheKey, promise);
      promise.catch(() => cache.delete(cacheKey));
      return promise;
    },
    [clientId, sortOrder],
  );

  const fetchPage = useCallback(
    (start: CatalogPagingState<JobDocumentSnapshot>): Promise<CatalogPage> =>
      buildCatalogPage(start, pageSize, fetchChunk),
    [fetchChunk, pageSize],
  );

  // ── Client-wide paginated mode (only when no batchId selected) ──
  useEffect(() => {
    if (!clientId || batchId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const liveQuery = query(
      collection(db, 'jobs'),
      ...buildCatalogQueryConstraints({ clientId, sortOrder }),
      limit(pageSize + 1),
    );

    let snapshotSequence = 0;
    const unsubscribe = onSnapshot(
      liveQuery,
      (snapshot) => {
        // The live head may end inside an article: complete it (and fill the page) from cached reads.
        const sequence = ++snapshotSequence;
        const head = snapshot.docs;
        fetchPage({
          buffer: head.map(toJob),
          cursor: head[head.length - 1] ?? null,
          exhausted: head.length <= pageSize,
        }).then((livePage) => {
          if (sequence !== snapshotSequence) return;
          const nextSignature = [
            ...livePage.jobs.map((job) => job.id),
            '>',
            ...livePage.next.buffer.map((job) => job.id),
            livePage.next.cursor?.id ?? '',
          ].join('|');
          const shouldResetCachedPages =
            liveFirstPageSignatureRef.current !== '' && liveFirstPageSignatureRef.current !== nextSignature;

          liveFirstPageSignatureRef.current = nextSignature;
          setPages((prev) => (shouldResetCachedPages ? [livePage] : [livePage, ...prev.slice(1)]));
          if (shouldResetCachedPages) {
            // Later pages are rebuilt from fresh reads, as before this paging existed.
            chunkCacheRef.current = new Map();
            requestIdRef.current += 1;
            setCurrentPageIndex(0);
          }
          setLoading(false);
        }).catch(() => {
          if (sequence !== snapshotSequence) return;
          setError('Error cargando imágenes del catálogo');
          setLoading(false);
        });
      },
      () => {
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      },
    );

    return () => {
      snapshotSequence += 1;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [clientId, batchId, pageSize, sortOrder, fetchPage]);

  // Prefetch the next page silently whenever the current page has more data and the
  // following page is not yet cached. The user sees no loading indicator for this.
  useEffect(() => {
    if (!clientId || batchId) return undefined;

    const currentPage = pages[currentPageIndex];
    const nextPageAlreadyCached = Boolean(pages[currentPageIndex + 1]);

    if (!currentPage?.hasMore || nextPageAlreadyCached) return undefined;

    let cancelled = false;

    fetchPage(currentPage.next).then((nextPage) => {
      if (cancelled) return;
      setPages((prev) => {
        if (prev[currentPageIndex] !== currentPage || prev[currentPageIndex + 1]) return prev;
        const updated = [...prev];
        updated[currentPageIndex + 1] = nextPage;
        return updated;
      });
    }).catch(() => {
      // Silent — user will retry naturally via goToNextPage
    });

    return () => { cancelled = true; };
  }, [clientId, batchId, pages, currentPageIndex, fetchPage]);

  const goToPreviousPage = useCallback(() => {
    setCurrentPageIndex((current) => Math.max(0, current - 1));
  }, []);

  const goToNextPage = useCallback(async () => {
    if (!clientId || batchId) return;

    const existingNextPage = pages[currentPageIndex + 1];
    if (existingNextPage) {
      setCurrentPageIndex((current) => current + 1);
      return;
    }

    const current = pages[currentPageIndex];
    if (!current?.hasMore) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const nextPage = await fetchPage(current.next);
      if (requestId !== requestIdRef.current) return;
      setPages((prev) => prev[currentPageIndex + 1] ? prev : [...prev, nextPage]);
      setCurrentPageIndex((page) => page + 1);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError('Error cargando imágenes del catálogo');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [clientId, batchId, pages, currentPageIndex, fetchPage]);

  const batchJobs = activeBatchResult?.jobs ?? EMPTY_JOBS;
  const jobs = useMemo(
    () => (batchId ? (includeAllBatchJobs ? batchJobs : batchJobs.filter(isRenderableCatalogJob)) : (pages[currentPageIndex]?.jobs ?? EMPTY_JOBS)),
    [batchId, batchJobs, includeAllBatchJobs, pages, currentPageIndex],
  );
  const generatingJobs = useMemo(
    () => batchJobs.filter((job) => job.status === 'pending' || job.status === 'processing'),
    [batchJobs],
  );

  const garmentGroups: CatalogGarmentGroup[] = useMemo(() => {
    const map = new Map<string, CatalogGarmentGroup>();
    for (const job of jobs) {
      const key = job.garmentId;
      const existing = map.get(key);
      if (existing) {
        existing.jobs.push(job);
      } else {
        map.set(key, { garmentId: job.garmentId, garmentName: job.garmentName, jobs: [job] });
      }
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        jobs: [...group.jobs].sort((left, right) => compareJobsByCreatedAt(left, right, sortOrder)),
      }))
      .sort((left, right) => compareJobsByCreatedAt(left.jobs[0], right.jobs[0], sortOrder));
  }, [jobs, sortOrder]);

  const hasPreviousPage = !batchId && currentPageIndex > 0;
  const hasNextPage = !batchId && Boolean(pages[currentPageIndex]?.hasMore || pages[currentPageIndex + 1]);
  const totalPages = hasNextPage ? null : Math.max(1, batchId ? 1 : pages.length);

  return {
    batches,
    garmentGroups,
    generatingJobs,
    loading: batchId ? Boolean(clientId && !activeBatchResult) : loading,
    error: activeBatchResult?.error ?? error,
    currentPage,
    totalPages,
    hasPreviousPage,
    hasNextPage,
    goToPreviousPage,
    goToNextPage,
  };
};
