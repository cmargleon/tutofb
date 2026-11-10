import { useCallback, useEffect, useMemo, useState } from 'react';
import { Job } from '../../../shared/src/types';
import { mergeCatalogDisplayGroups, PendingCatalogRegeneration, reconcilePendingRegenerations } from './catalogView';
import { subscribeToCatalogBatchJobs } from './firebase';
import { CatalogGarmentGroup, CatalogSortOrder } from './useCatalogJobs';

export const useCatalogDisplayGroups = ({
  selectedBatchId,
  sortOrder,
  garmentGroups,
}: {
  selectedBatchId: string;
  sortOrder: CatalogSortOrder;
  garmentGroups: CatalogGarmentGroup[];
}) => {
  const [generatingJobs, setGeneratingJobs] = useState<Job[]>([]);
  const [pendingRegenerations, setPendingRegenerations] = useState<Record<string, PendingCatalogRegeneration>>({});

  useEffect(() => {
    if (!selectedBatchId) {
      setGeneratingJobs([]);
      return undefined;
    }

    const unsubscribe = subscribeToCatalogBatchJobs(
      selectedBatchId,
      sortOrder,
      (jobs) => {
        setGeneratingJobs(
          jobs.filter((job) => job.status === 'pending' || job.status === 'processing'),
        );
      },
      () => setGeneratingJobs([]),
    );

    return () => unsubscribe();
  }, [selectedBatchId, sortOrder]);

  const displayGarmentGroups = useMemo(
    () => mergeCatalogDisplayGroups(garmentGroups, generatingJobs, pendingRegenerations, sortOrder),
    [garmentGroups, generatingJobs, pendingRegenerations, sortOrder],
  );

  const pendingRegenerationJobIds = useMemo(
    () => Object.keys(pendingRegenerations).reduce<Record<string, true>>((acc, jobId) => {
      acc[jobId] = true;
      return acc;
    }, {}),
    [pendingRegenerations],
  );

  const visibleJobsCount = useMemo(
    () => displayGarmentGroups.reduce((total, group) => total + group.jobs.length, 0),
    [displayGarmentGroups],
  );

  useEffect(() => {
    setPendingRegenerations((prev) => reconcilePendingRegenerations(prev, garmentGroups, generatingJobs));
  }, [garmentGroups, generatingJobs]);

  const handleRegenerationQueued = useCallback((job: Job) => {
    if (!job.id) return;

    setPendingRegenerations((prev) => ({
      ...prev,
      [job.id!]: {
        job,
        leftCatalog: false,
      },
    }));
  }, []);

  const handleRegenerationCancelled = useCallback((jobId: string) => {
    setPendingRegenerations((prev) => {
      if (!prev[jobId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  const resetPendingRegenerations = () => setPendingRegenerations({});

  return {
    displayGarmentGroups,
    pendingRegenerationJobIds,
    visibleJobsCount,
    handleRegenerationQueued,
    handleRegenerationCancelled,
    resetPendingRegenerations,
  };
};
