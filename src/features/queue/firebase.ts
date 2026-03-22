import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Batch, BatchStatus, Job } from '../../../shared/src/types';
import { db } from '../../firebase';

export interface QueueSnapshot {
  batches: Batch[];
  jobsByBatch: Record<string, Job[]>;
}

const QUEUE_BATCH_STATUSES: BatchStatus[] = ['pending', 'processing', 'partial_failed', 'failed'];

export const subscribeToQueueData = (
  onData: (snapshot: QueueSnapshot) => void,
  onError: (error: Error) => void,
) => {
  let latestBatches: Batch[] = [];
  let latestJobsByBatch: Record<string, Job[]> = {};
  const jobUnsubscribers = new Map<string, () => void>();

  const emit = () => {
    onData({
      batches: latestBatches,
      jobsByBatch: latestJobsByBatch,
    });
  };

  const unsubscribeBatches = onSnapshot(
    query(
      collection(db, 'batches'),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
    (snapshot) => {
      const nextBatches = snapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch))
        .filter((batch) => QUEUE_BATCH_STATUSES.includes(batch.status));
      const nextBatchIds = new Set(nextBatches.map((batch) => batch.id).filter(Boolean) as string[]);

      for (const [batchId, unsubscribe] of jobUnsubscribers.entries()) {
        if (!nextBatchIds.has(batchId)) {
          unsubscribe();
          jobUnsubscribers.delete(batchId);
          delete latestJobsByBatch[batchId];
        }
      }

      nextBatches.forEach((batch) => {
        if (!batch.id || jobUnsubscribers.has(batch.id)) {
          return;
        }

        const unsubscribeJobs = onSnapshot(
          query(collection(db, 'jobs'), where('batchId', '==', batch.id), orderBy('createdAt', 'desc')),
          (jobsSnapshot) => {
            latestJobsByBatch = {
              ...latestJobsByBatch,
              [batch.id!]: jobsSnapshot.docs.map(
                (docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Job),
              ),
            };
            emit();
          },
          onError,
        );

        jobUnsubscribers.set(batch.id, unsubscribeJobs);
      });

      latestBatches = nextBatches;
      emit();
    },
    onError,
  );

  return () => {
    unsubscribeBatches();
    jobUnsubscribers.forEach((unsubscribe) => unsubscribe());
    jobUnsubscribers.clear();
  };
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
