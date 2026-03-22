import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveSearchCursor, Batch, JobStatus, Provider } from '../../../shared/src/types';
import { searchArchive } from './firebase';

interface ArchiveSearchFilters {
  clientId: string;
  provider: 'all' | Provider;
  batchStatus: 'all' | Batch['status'];
  jobStatus: 'all' | JobStatus;
  modelQuery: string;
  dateFrom: string;
  dateTo: string;
}

export interface ArchiveSearchResult {
  batch: Batch;
  matchedJobCount: number;
  matchedJobIds: string[];
  latestMatchedAt: unknown;
  matchedGarments: string[];
}

const MAX_RESULTS_PER_REQUEST = 40;
const MAX_REQUESTS_PER_LOAD = 3;

const mapResults = (results: Awaited<ReturnType<typeof searchArchive>>['results'] = []): ArchiveSearchResult[] =>
  results.map((result) => ({
    batch: result.batch,
    matchedJobCount: result.matchedJobCount,
    matchedJobIds: result.matchedJobIds,
    latestMatchedAt: result.latestMatchedAt,
    matchedGarments: result.matchedGarments,
  }));

const mergeUniqueResults = (
  current: ArchiveSearchResult[],
  incoming: ArchiveSearchResult[],
): ArchiveSearchResult[] => {
  if (incoming.length === 0) {
    return current;
  }

  const merged = new Map(current.map((result) => [result.batch.id, result] as const));
  for (const result of incoming) {
    merged.set(result.batch.id, result);
  }

  return Array.from(merged.values());
};

export const useArchiveSearch = (
  filters: ArchiveSearchFilters,
  enabled: boolean,
  pageSize: number = 40,
) => {
  const [results, setResults] = useState<ArchiveSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBatches, setScannedBatches] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<ArchiveSearchCursor | null>(null);
  const requestIdRef = useRef(0);
  const resultsRef = useRef<ArchiveSearchResult[]>([]);

  const normalizedFilters = useMemo(
    () => ({
      clientId: filters.clientId === 'all' ? null : filters.clientId,
      provider: filters.provider === 'all' ? null : filters.provider,
      batchStatus: filters.batchStatus === 'all' ? null : filters.batchStatus,
      jobStatus: filters.jobStatus === 'all' ? null : filters.jobStatus,
      modelQuery: filters.modelQuery,
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null,
    }),
    [filters.batchStatus, filters.clientId, filters.dateFrom, filters.dateTo, filters.jobStatus, filters.modelQuery, filters.provider],
  );

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const loadChunk = useCallback(
    async (cursor: ArchiveSearchCursor | null, targetCount: number, requestId: number) => {
      let accumulated: ArchiveSearchResult[] = [];
      let totalScanned = 0;
      let pendingCursor = cursor;
      let pendingHasMore = false;
      let attempts = 0;

      while (attempts < MAX_REQUESTS_PER_LOAD && accumulated.length < targetCount) {
        const response = await searchArchive({
          ...normalizedFilters,
          limit: Math.min(MAX_RESULTS_PER_REQUEST, Math.max(targetCount - accumulated.length, 1)),
          batchPageSize: Math.max(pageSize * 2, 80),
          cursor: pendingCursor,
        });

        if (requestId !== requestIdRef.current) {
          return null;
        }

        accumulated = mergeUniqueResults(accumulated, mapResults(response.results));
        totalScanned += response.scannedBatches || 0;
        pendingHasMore = response.hasMore === true;
        pendingCursor = response.nextCursor ?? null;
        attempts += 1;

        if (!pendingHasMore || !pendingCursor) {
          break;
        }
      }

      return {
        results: accumulated,
        scannedBatches: totalScanned,
        hasMore: pendingHasMore && pendingCursor !== null,
        nextCursor: pendingHasMore ? pendingCursor : null,
      };
    },
    [normalizedFilters, pageSize],
  );

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!enabled) {
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setResults([]);
      setScannedBatches(0);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setResults([]);
      setScannedBatches(0);
      setHasMore(false);
      setNextCursor(null);

      try {
        const initial = await loadChunk(null, pageSize, requestId);
        if (!initial || requestId !== requestIdRef.current) {
          return;
        }

        setResults(initial.results);
        setScannedBatches(initial.scannedBatches);
        setHasMore(initial.hasMore);
        setNextCursor(initial.nextCursor);
      } catch (loadError) {
        console.error('Error loading archive search:', loadError);
        if (requestId === requestIdRef.current) {
          setError('No pudimos consultar el archivo en este momento.');
          setResults([]);
          setScannedBatches(0);
          setHasMore(false);
          setNextCursor(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    void load();
  }, [enabled, loadChunk, pageSize]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || loadingMore || !hasMore || !nextCursor) {
      return;
    }

    const requestId = requestIdRef.current;
    setLoadingMore(true);

    try {
      const chunk = await loadChunk(nextCursor, pageSize, requestId);
      if (!chunk || requestId !== requestIdRef.current) {
        return;
      }

      setResults((current) => mergeUniqueResults(current, chunk.results));
      setScannedBatches((current) => current + chunk.scannedBatches);
      setHasMore(chunk.hasMore);
      setNextCursor(chunk.nextCursor);
    } catch (loadError) {
      console.error('Error loading more archive results:', loadError);
      if (requestId === requestIdRef.current && resultsRef.current.length === 0) {
        setError('No pudimos consultar el archivo en este momento.');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingMore(false);
      }
    }
  }, [enabled, hasMore, loadChunk, loading, loadingMore, nextCursor, pageSize]);

  return {
    results,
    loading,
    loadingMore,
    error,
    scannedBatches,
    hasMore,
    loadMore,
  };
};
