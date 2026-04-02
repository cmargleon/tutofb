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
} from 'firebase/firestore';
import { db } from '../../firebase';
import { Batch, Job } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';

const BATCH_OPTIONS_LIMIT = 200;

type JobDocumentSnapshot = QueryDocumentSnapshot<DocumentData>;

export interface CatalogGarmentGroup {
  garmentId: string;
  garmentName: string;
  jobs: Job[];
}

interface CatalogJobsParams {
  clientId: string | null;
  batchId: string | null;
  pageSize: number;
}

interface CatalogPage {
  jobs: Job[];
  lastVisible: JobDocumentSnapshot | null;
  hasMore: boolean;
}

const isRenderableCatalogJob = (job: Job): boolean =>
  job.status === 'completed' && Boolean(resolveApprovedJobOutput(job)?.resultImagePath);

export const useCatalogJobs = ({ clientId, batchId, pageSize }: CatalogJobsParams) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pages, setPages] = useState<CatalogPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const currentPage = currentPageIndex + 1;

  useEffect(() => {
    setCurrentPageIndex(0);
  }, [pageSize]);

  useEffect(() => {
    setPages([]);
    setCurrentPageIndex(0);
    setLoading(false);
    setError(null);
  }, [clientId, batchId]);

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

  const fetchPage = useCallback(
    async (cursor: JobDocumentSnapshot | null): Promise<CatalogPage> => {
      if (!clientId) return { jobs: [], lastVisible: null, hasMore: false };

      const baseConstraints = batchId
        ? [
            where('batchId', '==', batchId),
            where('status', '==', 'completed'),
            orderBy('createdAt', 'desc'),
          ]
        : [
            where('clientId', '==', clientId),
            where('status', '==', 'completed'),
            orderBy('createdAt', 'desc'),
          ];

      const constraints = [...baseConstraints, limit(pageSize + 1)];
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
    [clientId, batchId, pageSize],
  );

  useEffect(() => {
    if (!clientId || pages.length > 0) return undefined;

    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetchPage(null)
      .then((page) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPages([page]);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clientId, batchId, pages.length, fetchPage]);

  // Prefetch the next page silently whenever the current page has more data and the
  // following page is not yet cached. The user sees no loading indicator for this.
  useEffect(() => {
    if (!clientId) return undefined;

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
  }, [clientId, pages, currentPageIndex, fetchPage]);

  const goToPreviousPage = useCallback(() => {
    setCurrentPageIndex((current) => Math.max(0, current - 1));
  }, []);

  const goToNextPage = useCallback(async () => {
    if (!clientId) return;

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
  }, [clientId, pages, currentPageIndex, fetchPage]);

  const jobs = useMemo(() => pages[currentPageIndex]?.jobs ?? [], [pages, currentPageIndex]);

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
    return Array.from(map.values()).sort((a, b) =>
      a.garmentName.localeCompare(b.garmentName, 'es'),
    );
  }, [jobs]);

  const hasPreviousPage = currentPageIndex > 0;
  const hasNextPage = Boolean(pages[currentPageIndex]?.hasMore || pages[currentPageIndex + 1]);
  const totalPages = hasNextPage ? null : Math.max(1, pages.length);

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
