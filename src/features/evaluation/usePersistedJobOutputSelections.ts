import { useEffect, useMemo, useState } from 'react';
import { Job, JobOutput } from '../../../shared/src/types';
import { selectJobOutput as persistSelectedJobOutput } from './firebase';

export const usePersistedJobOutputSelections = (
  batchId: string | null,
  jobs: Job[],
  onSelectionError?: (error: unknown) => void,
) => {
  const [pendingSelectionsByJobId, setPendingSelectionsByJobId] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!batchId) {
      setPendingSelectionsByJobId({});
      return;
    }

    setPendingSelectionsByJobId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([jobId, outputId]) => {
          const job = jobs.find((candidate) => candidate.id === jobId);
          if (!job) {
            return false;
          }

          return (job.userSelectedOutputId || null) !== outputId;
        }),
      ),
    );
  }, [batchId, jobs]);

  const selectedOutputIdsByJobId = useMemo(() => {
    const persistedSelections = Object.fromEntries(
      jobs
        .filter((job): job is Job & { id: string } => Boolean(job.id))
        .filter((job) => Boolean(job.userSelectedOutputId))
        .map((job) => [job.id, job.userSelectedOutputId || null]),
    ) as Record<string, string | null>;

    const mergedSelections: Record<string, string | null> = { ...persistedSelections };
    (Object.entries(pendingSelectionsByJobId) as Array<[string, string | null]>).forEach(([jobId, outputId]) => {
      if (!outputId) {
        delete mergedSelections[jobId];
        return;
      }

      mergedSelections[jobId] = outputId;
    });

    return mergedSelections;
  }, [jobs, pendingSelectionsByJobId]);

  const selectOutput = async (jobId: string, outputId: string | null, _output: JobOutput | null) => {
    const previousOverride = Object.prototype.hasOwnProperty.call(pendingSelectionsByJobId, jobId)
      ? pendingSelectionsByJobId[jobId]
      : undefined;

    setPendingSelectionsByJobId((current) => ({
      ...current,
      [jobId]: outputId,
    }));

    try {
      await persistSelectedJobOutput(jobId, outputId);
    } catch (error) {
      setPendingSelectionsByJobId((current) => {
        const next = { ...current };
        if (previousOverride === undefined) {
          delete next[jobId];
        } else {
          next[jobId] = previousOverride;
        }
        return next;
      });
      onSelectionError?.(error);
    }
  };

  return {
    selectedOutputIdsByJobId,
    selectOutput,
  };
};
