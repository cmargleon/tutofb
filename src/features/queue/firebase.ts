import { subscribeHumanQuery } from '../auth/scopedQuery';
import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, QuerySnapshot, Timestamp, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AcknowledgeBatchFailuresRequest, AcknowledgeBatchFailuresResponse, Batch, BatchStatus, Job } from '../../../shared/src/types';
import { db, functions } from '../../firebase';
import { ATTENTION_WINDOW_MS, isActiveBatch, RECENT_WINDOW_MS } from './queueRows';

export interface QueueSnapshot {
  batches: Batch[];
  jobsByBatch: Record<string, Job[]>;
}

const ACTIVE_BATCH_STATUSES: BatchStatus[] = ['pending', 'processing'];
const FAILED_BATCH_STATUSES: BatchStatus[] = ['partial_failed', 'failed'];
const BATCH_QUERY_LIMIT = 100;

const toBatches = (snapshot: QuerySnapshot) =>
  snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch));

const batchJobsQuery = (batch: Pick<Batch, 'id' | 'clientId'>) =>
  query(collection(db, 'jobs'), where('batchId', '==', batch.id), where('clientId', '==', batch.clientId), orderBy('createdAt', 'desc'));

/**
 * Cola only needs what can still change or still needs a look: active batches (any age), batches with failures
 * from the attention window and completed batches from the recent window. Jobs are streamed only for active
 * batches (ETA); a finished batch's jobs load on demand when its row is expanded (`useBatchJobs`).
 */
export const subscribeToQueueData = (
  onData: (snapshot: QueueSnapshot) => void,
  onError: (error: Error) => void,
) => {
  const now = Date.now();
  const sources = [
    query(collection(db, 'batches'), where('status', 'in', ACTIVE_BATCH_STATUSES), orderBy('updatedAt', 'desc'), limit(BATCH_QUERY_LIMIT)),
    query(
      collection(db, 'batches'),
      where('status', 'in', FAILED_BATCH_STATUSES),
      where('updatedAt', '>=', Timestamp.fromMillis(now - ATTENTION_WINDOW_MS)),
      orderBy('updatedAt', 'desc'),
      limit(BATCH_QUERY_LIMIT),
    ),
    query(
      collection(db, 'batches'),
      where('status', '==', 'completed'),
      where('updatedAt', '>=', Timestamp.fromMillis(now - RECENT_WINDOW_MS)),
      orderBy('updatedAt', 'desc'),
      limit(BATCH_QUERY_LIMIT),
    ),
  ];
  const batchesBySource: Array<Batch[] | null> = sources.map(() => null);
  let latestBatches: Batch[] = [];
  let latestJobsByBatch: Record<string, Job[]> = {};
  const publish = () => onData({ batches: latestBatches, jobsByBatch: latestJobsByBatch });
  const jobUnsubscribers = new Map<string, () => void>();

  const emit = () => {
    if (batchesBySource.some((entry) => entry === null)) {
      return;
    }
    // A batch can move between sources while snapshots settle; keep one copy, preferring the active source.
    const byId = new Map<string, Batch>();
    batchesBySource.forEach((entry) => entry!.forEach((batch) => {
      if (batch.id && !byId.has(batch.id)) byId.set(batch.id, batch);
    }));
    const batches = [...byId.values()];
    const activeIds = new Set(batches.filter(isActiveBatch).map((batch) => batch.id!));

    for (const [batchId, unsubscribe] of jobUnsubscribers.entries()) {
      if (!activeIds.has(batchId)) {
        unsubscribe();
        jobUnsubscribers.delete(batchId);
        const { [batchId]: _removed, ...rest } = latestJobsByBatch;
        latestJobsByBatch = rest;
      }
    }

    batches.forEach((batch) => {
      if (!activeIds.has(batch.id!) || jobUnsubscribers.has(batch.id!)) {
        return;
      }
      jobUnsubscribers.set(batch.id!, onSnapshot(batchJobsQuery(batch), (jobsSnapshot) => {
        latestJobsByBatch = {
          ...latestJobsByBatch,
          [batch.id!]: jobsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job)),
        };
        publish();
      }, onError));
    });

    latestBatches = batches;
    publish();
  };

  const unsubscribers = sources.map((source, index) => subscribeHumanQuery(source, 'clientId', (snapshot) => {
    batchesBySource[index] = toBatches(snapshot);
    emit();
  }, onError));

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    jobUnsubscribers.forEach((unsubscribe) => unsubscribe());
    jobUnsubscribers.clear();
  };
};

/** Streams one batch's jobs while `enabled` (an expanded row in Cola). */
export const useBatchJobs = (batch: Pick<Batch, 'id' | 'clientId'>, enabled: boolean) => {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !batch.id) {
      return undefined;
    }
    setError(null);
    return onSnapshot(
      batchJobsQuery(batch),
      (snapshot) => setJobs(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job))),
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los trabajos del lote.');
      },
    );
  }, [batch.id, batch.clientId, enabled]);

  return { jobs, loading: enabled && jobs === null && !error, error };
};

export const useQueueData = () => {
  const [data, setData] = useState<QueueSnapshot>({ batches: [], jobsByBatch: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToQueueData(
      (snapshot) => {
        setData(snapshot);
        setLoading(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudo cargar la cola operativa.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  return { ...data, loading, error };
};

export const acknowledgeBatchFailures = async (batchId: string): Promise<AcknowledgeBatchFailuresResponse> => {
  const callable = httpsCallable<AcknowledgeBatchFailuresRequest, AcknowledgeBatchFailuresResponse>(functions, 'acknowledgeBatchFailures');
  const result = await callable({ batchId });
  return result.data;
};
