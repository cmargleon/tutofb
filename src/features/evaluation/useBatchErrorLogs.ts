import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { Job, JobLog } from '../../../shared/src/types';

const ERROR_LOG_TYPES = new Set<JobLog['type']>(['retry_scheduled', 'failed']);

const hasErrorContext = (job: Job): boolean =>
  job.status === 'failed'
  || Boolean(job.lastError)
  || Boolean(job.traceability?.lastProviderErrorMessage);

const sortLogsDesc = (logs: JobLog[]): JobLog[] =>
  [...logs].sort((left, right) => {
    const leftMs = left.createdAt && typeof left.createdAt.toMillis === 'function'
      ? left.createdAt.toMillis()
      : new Date(left.createdAt as string).getTime();
    const rightMs = right.createdAt && typeof right.createdAt.toMillis === 'function'
      ? right.createdAt.toMillis()
      : new Date(right.createdAt as string).getTime();

    return (Number.isNaN(rightMs) ? 0 : rightMs) - (Number.isNaN(leftMs) ? 0 : leftMs);
  });

export interface BatchJobErrorLog {
  job: Job;
  recentLogs: JobLog[];
}

export const useBatchErrorLogs = (jobs: Job[]) => {
  const jobsWithErrors = useMemo(
    () => jobs.filter((job) => Boolean(job.id) && hasErrorContext(job)),
    [jobs],
  );
  const [logsByJobId, setLogsByJobId] = useState<Record<string, JobLog[] | undefined>>({});

  useEffect(() => {
    if (jobsWithErrors.length === 0) {
      setLogsByJobId({});
      return undefined;
    }

    setLogsByJobId((current) => {
      const next: Record<string, JobLog[] | undefined> = {};
      jobsWithErrors.forEach((job) => {
        if (job.id) {
          next[job.id] = current[job.id];
        }
      });
      return next;
    });

    const unsubscribes = jobsWithErrors.map((job) => {
      const jobId = job.id!;
      const logsQuery = query(collection(db, 'jobs', jobId, 'logs'), orderBy('createdAt', 'desc'), limit(10));

      return onSnapshot(
        logsQuery,
        (snapshot) => {
          const nextLogs = sortLogsDesc(
            snapshot.docs
              .map((entry) => ({ id: entry.id, ...entry.data() }) as JobLog)
              .filter((log) => log.level === 'error' || ERROR_LOG_TYPES.has(log.type)),
          );

          setLogsByJobId((current) => ({
            ...current,
            [jobId]: nextLogs,
          }));
        },
        (error) => {
          console.error(`Error fetching batch error logs for job ${jobId}:`, error);
          setLogsByJobId((current) => ({
            ...current,
            [jobId]: [],
          }));
        },
      );
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [jobsWithErrors]);

  const entries = useMemo<BatchJobErrorLog[]>(
    () =>
      jobsWithErrors.map((job) => ({
        job,
        recentLogs: (job.id ? logsByJobId[job.id] : undefined) || [],
      })),
    [jobsWithErrors, logsByJobId],
  );

  const loading = jobsWithErrors.some((job) => job.id && logsByJobId[job.id] === undefined);

  return {
    entries,
    jobsWithErrors,
    loading,
  };
};
