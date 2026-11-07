import { subscribeHumanQuery } from '../auth/scopedQuery';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { OrderByDirection, Unsubscribe } from 'firebase/firestore';
import type { Batch, Job } from '../../../shared/src/types';
import { db } from '../../firebase';

// Ignore callbacks already queued when a selection's listener is disposed.
const subscribeWhileActive = <T>(
  subscribe: (onData: (data: T) => void, onError: (error: Error) => void) => Unsubscribe,
  onData: (data: T) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  let active = true;
  const unsubscribe = subscribe(
    (data) => { if (active) onData(data); },
    (error) => { if (active) onError(error); },
  );
  return () => {
    active = false;
    unsubscribe();
  };
};

export const subscribeToCatalogBatch = (
  batchId: string,
  onData: (batch: Batch | null) => void,
  onError: (error: Error) => void,
): Unsubscribe => subscribeWhileActive(
  (next, error) => onSnapshot(doc(db, 'batches', batchId), (snapshot) => {
    next(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Batch : null);
  }, error),
  onData,
  onError,
);

export const subscribeToCatalogBatchJobs = (
  batchId: string,
  sortOrder: OrderByDirection,
  onData: (jobs: Job[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => subscribeWhileActive(
  (next, error) => subscribeHumanQuery(
    query(collection(db, 'jobs'), where('batchId', '==', batchId), orderBy('createdAt', sortOrder)),
    'clientId',
    (snapshot) => next(snapshot.docs.map((job) => ({ id: job.id, ...job.data() } as Job))),
    error,
  ),
  onData,
  onError,
);

export const subscribeToCatalogJob = (
  jobId: string,
  onData: (job: Job | null) => void,
  onError: (error: Error) => void,
): Unsubscribe => subscribeWhileActive(
  (next, error) => onSnapshot(doc(db, 'jobs', jobId), (snapshot) => {
    next(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Job : null);
  }, error),
  onData,
  onError,
);
