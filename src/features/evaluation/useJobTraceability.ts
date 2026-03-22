import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import { JobLog } from '../../../shared/src/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const useJobTraceability = (jobId: string | null) => {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const logsQuery = query(collection(db, 'jobs', jobId, 'logs'), orderBy('createdAt', 'desc'));

    return onSnapshot(
      logsQuery,
      (snapshot) => {
        setLogs(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as JobLog));
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching job logs:', error);
        setLogs([]);
        setLoading(false);
      },
    );
  }, [jobId]);

  return {
    logs,
    loading,
  };
};

export const traceabilityPayload = (payload: unknown): Record<string, unknown> | null =>
  isRecord(payload) ? payload : null;

export const traceabilityRequestedByUid = (log: JobLog): string | null => {
  const payload = traceabilityPayload(log.payload);
  return payload && typeof payload.requestedByUid === 'string' ? payload.requestedByUid : null;
};

export const traceabilityRequestedByDisplayName = (log: JobLog): string | null => {
  const payload = traceabilityPayload(log.payload);
  return payload && typeof payload.requestedByDisplayName === 'string' ? payload.requestedByDisplayName : null;
};

export const traceabilityErrorMessage = (log: JobLog | undefined): string | null => {
  if (!log) {
    return null;
  }

  const payload = traceabilityPayload(log.payload);
  if (!payload) {
    return null;
  }

  const error = isRecord(payload.error) ? payload.error : null;
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  return null;
};
