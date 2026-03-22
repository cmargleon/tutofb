import { useEffect, useState } from 'react';
import { Batch, JobStatus, Provider } from '../../../shared/src/types';
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

export const useArchiveSearch = (
  filters: ArchiveSearchFilters,
  enabled: boolean,
  windowSize: number = 400,
) => {
  const [results, setResults] = useState<ArchiveSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedBatches, setScannedBatches] = useState(0);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoading(false);
      setError(null);
      setResults([]);
      setScannedBatches(0);
      setTruncated(false);

      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await searchArchive({
          clientId: filters.clientId === 'all' ? null : filters.clientId,
          provider: filters.provider === 'all' ? null : filters.provider,
          batchStatus: filters.batchStatus === 'all' ? null : filters.batchStatus,
          jobStatus: filters.jobStatus === 'all' ? null : filters.jobStatus,
          modelQuery: filters.modelQuery,
          dateFrom: filters.dateFrom || null,
          dateTo: filters.dateTo || null,
          limit: Math.min(windowSize, 40),
          scanLimit: Math.max(windowSize * 4, 80),
        });

        if (cancelled) {
          return;
        }

        setResults(
          (response.results || []).map((result) => ({
            batch: result.batch,
            matchedJobCount: result.matchedJobCount,
            matchedJobIds: result.matchedJobIds,
            latestMatchedAt: result.latestMatchedAt,
            matchedGarments: result.matchedGarments,
          })),
        );
        setScannedBatches(response.scannedBatches || 0);
        setTruncated(response.truncated === true);
      } catch (loadError) {
        console.error('Error loading archive search:', loadError);
        if (!cancelled) {
          setError('No pudimos consultar el archivo en este momento.');
          setResults([]);
          setScannedBatches(0);
          setTruncated(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [enabled, filters.batchStatus, filters.clientId, filters.dateFrom, filters.dateTo, filters.jobStatus, filters.modelQuery, filters.provider, windowSize]);

  return {
    results,
    loading,
    error,
    scannedBatches,
    truncated,
  };
};
