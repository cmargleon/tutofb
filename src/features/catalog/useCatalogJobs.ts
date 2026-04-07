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
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';

const BATCH_OPTIONS_LIMIT = 200;

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
}

interface CatalogPage {
  jobs: Job[];
  lastVisible: JobDocumentSnapshot | null;
  hasMore: boolean;
}

const isRenderableCatalogJob = (job: Job): boolean =>
  job.status === 'failed'
  || (job.status === 'completed' && Boolean(resolveApprovedJobOutput(job)?.resultImagePath));

const compareJobsByCreatedAt = (left: Job, right: Job, sortOrder: CatalogSortOrder): number => (
  sortOrder === 'asc'
    ? toMillisOrZero(left.createdAt) - toMillisOrZero(right.createdAt)
    : toMillisOrZero(right.createdAt) - toMillisOrZero(left.createdAt)
);

const buildCatalogQueryConstraints = ({
  clientId,
  batchId,
  sortOrder,
}: Pick<CatalogJobsParams, 'clientId' | 'batchId' | 'sortOrder'>): QueryConstraint[] => (
      batchId
    ? [
        where('batchId', '==', batchId),
        where('status', 'in', ['completed', 'failed']),
        orderBy('createdAt', sortOrder),
      ]
    : [
        where('clientId', '==', clientId),
        where('status', 'in', ['completed', 'failed']),
        orderBy('createdAt', sortOrder),
      ]
);

export const useCatalogJobs = ({ clientId, batchId, pageSize, sortOrder }: CatalogJobsParams) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pages, setPages] = useState<CatalogPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [batchJobs, setBatchJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const liveFirstPageSignatureRef = useRef('');

  const currentPage = currentPageIndex + 1;

  useEffect(() => {
    setPages([]);
    setCurrentPageIndex(0);
    setBatchJobs([]);
    setLoading(false);
    setError(null);
    liveFirstPageSignatureRef.current = '';
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

  // ── Batch-specific mode: real-time subscription with no pagination ──
  useEffect(() => {
    if (!clientId || !batchId) {
      setBatchJobs([]);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const batchJobsQuery = query(
      collection(db, 'jobs'),
      ...buildCatalogQueryConstraints({ clientId, batchId, sortOrder }),
    );

    const unsubscribe = onSnapshot(
      batchJobsQuery,
      (snapshot) => {
        setBatchJobs(
          snapshot.docs
            .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
            .filter(isRenderableCatalogJob),
        );
        setLoading(false);
      },
      () => {
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [clientId, batchId, sortOrder]);

  const fetchPage = useCallback(
    async (cursor: JobDocumentSnapshot | null): Promise<CatalogPage> => {
      if (!clientId) return { jobs: [], lastVisible: null, hasMore: false };
      const constraints = [...buildCatalogQueryConstraints({ clientId, batchId, sortOrder }), limit(pageSize + 1)];
      const catalogQuery = cursor
        ? query(collection(db, 'jobs'), ...constraints, startAfter(cursor))
        : query(collection(db, 'jobs'), ...constraints);

      const snapshot = await getDocs(catalogQuery);
      const hasMore = snapshot.docs.length > pageSize;
      const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      const jobs = pageDocs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
        .filter(isRenderableCatalogJob);

      return {
        jobs,
        lastVisible: pageDocs[pageDocs.length - 1] ?? null,
        hasMore,
      };
    },
    [clientId, batchId, pageSize, sortOrder],
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
      ...buildCatalogQueryConstraints({ clientId, batchId, sortOrder }),
      limit(pageSize + 1),
    );

    const unsubscribe = onSnapshot(
      liveQuery,
      (snapshot) => {
        const hasMore = snapshot.docs.length > pageSize;
        const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
        const jobs = pageDocs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
          .filter(isRenderableCatalogJob);
        const livePage: CatalogPage = {
          jobs,
          lastVisible: pageDocs[pageDocs.length - 1] ?? null,
          hasMore,
        };
        const nextSignature = pageDocs.map((docSnapshot) => docSnapshot.id).join('|');
        const shouldResetCachedPages =
          liveFirstPageSignatureRef.current !== '' && liveFirstPageSignatureRef.current !== nextSignature;

        liveFirstPageSignatureRef.current = nextSignature;
        setPages((prev) => (shouldResetCachedPages ? [livePage] : [livePage, ...prev.slice(1)]));
        if (shouldResetCachedPages) {
          setCurrentPageIndex(0);
        }
        setLoading(false);
      },
      () => {
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [clientId, batchId, pageSize, sortOrder]);

  // Prefetch the next page silently whenever the current page has more data and the
  // following page is not yet cached. The user sees no loading indicator for this.
  useEffect(() => {
    if (!clientId || batchId) return undefined;

    const currentPage = pages[currentPageIndex];
    const nextPageAlreadyCached = Boolean(pages[currentPageIndex + 1]);

    if (!currentPage?.hasMore || !currentPage.lastVisible || nextPageAlreadyCached) return undefined;

    let cancelled = false;

    fetchPage(currentPage.lastVisible).then((nextPage) => {
      if (cancelled) return;
      setPages((prev) => {
        // Only append if the slot is still empty (avoid race with goToNextPage)
        if (prev[currentPageIndex + 1]) return prev;
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
    if (!current?.hasMore || !current.lastVisible) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const nextPage = await fetchPage(current.lastVisible);
      if (requestId !== requestIdRef.current) return;
      setPages((prev) => [...prev, nextPage]);
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

  // When a specific batch is selected, use batchJobs directly (no pagination).
  // When browsing all client jobs, use the paginated pages.
  const jobs = useMemo(
    () => (batchId ? batchJobs : (pages[currentPageIndex]?.jobs ?? [])),
    [batchId, batchJobs, pages, currentPageIndex],
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
    jobs,
    garmentGroups,
    loading,
    error,
    currentPage,
    totalPages,
    hasPreviousPage,
    hasNextPage,
    goToPreviousPage,
    goToNextPage,
  };
};
