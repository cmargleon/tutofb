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

interface ClientCatalogPage {
  jobs: Job[];
  lastVisible: JobDocumentSnapshot | null;
  hasMore: boolean;
}

const isRenderableCatalogJob = (job: Job): boolean =>
  job.status === 'completed' && Boolean(resolveApprovedJobOutput(job)?.resultImagePath);

export const useCatalogJobs = ({ clientId, batchId, pageSize }: CatalogJobsParams) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchJobs, setBatchJobs] = useState<Job[]>([]);
  const [clientPages, setClientPages] = useState<ClientCatalogPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const currentPage = currentPageIndex + 1;
  const isBatchMode = Boolean(batchId);

  useEffect(() => {
    setCurrentPageIndex(0);
  }, [pageSize]);

  useEffect(() => {
    setBatchJobs([]);
    setClientPages([]);
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

  useEffect(() => {
    if (!clientId || !batchId) {
      setBatchJobs([]);
      return;
    }

    let cancelled = false;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    const batchJobsQuery = query(
      collection(db, 'jobs'),
      where('batchId', '==', batchId),
      orderBy('createdAt', 'desc'),
    );

    getDocs(batchJobsQuery)
      .then((snapshot) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        const fetched = snapshot.docs
          .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }) as Job)
          .filter(isRenderableCatalogJob);
        setBatchJobs(fetched);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [batchId, clientId]);

  const fetchClientPage = useCallback(
    async (cursor: JobDocumentSnapshot | null): Promise<ClientCatalogPage> => {
      if (!clientId) {
        return { jobs: [], lastVisible: null, hasMore: false };
      }

      const constraints = [
        where('clientId', '==', clientId),
        where('status', '==', 'completed'),
        orderBy('createdAt', 'desc'),
        limit(pageSize + 1),
      ];

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
    [clientId, pageSize],
  );

  useEffect(() => {
    if (!clientId || isBatchMode || clientPages.length > 0) {
      return undefined;
    }

    let cancelled = false;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetchClientPage(null)
      .then((snapshot) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setClientPages([snapshot]);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, clientPages.length, fetchClientPage, isBatchMode]);

  const goToPreviousPage = useCallback(() => {
    setCurrentPageIndex((current) => Math.max(0, current - 1));
  }, []);

  const goToNextPage = useCallback(async () => {
    if (!clientId) return;

    if (isBatchMode) {
      setCurrentPageIndex((current) => current + 1);
      return;
    }

    const existingNextPage = clientPages[currentPageIndex + 1];
    if (existingNextPage) {
      setCurrentPageIndex((current) => current + 1);
      return;
    }

    const current = clientPages[currentPageIndex];
    if (!current?.hasMore || !current.lastVisible) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const nextPage = await fetchClientPage(current.lastVisible);
      if (requestId !== requestIdRef.current) return;
      setClientPages((pages) => [...pages, nextPage]);
      setCurrentPageIndex((page) => page + 1);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError('Error cargando imágenes del catálogo');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [clientId, clientPages, currentPageIndex, fetchClientPage, isBatchMode]);

  const jobs = useMemo(() => {
    if (isBatchMode) {
      const start = currentPageIndex * pageSize;
      return batchJobs.slice(start, start + pageSize);
    }

    return clientPages[currentPageIndex]?.jobs ?? [];
  }, [batchJobs, clientPages, currentPageIndex, isBatchMode, pageSize]);

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
  const hasNextPage = isBatchMode
    ? (currentPageIndex + 1) * pageSize < batchJobs.length
    : Boolean(clientPages[currentPageIndex]?.hasMore || clientPages[currentPageIndex + 1]);

  const totalPages = isBatchMode
    ? Math.max(1, Math.ceil(batchJobs.length / pageSize))
    : hasNextPage
      ? null
      : Math.max(1, clientPages.length);

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
