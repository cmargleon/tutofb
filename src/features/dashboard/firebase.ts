import {
  collection, getCountFromServer, getDocsFromServer, limit, orderBy, query, where,
} from 'firebase/firestore';
import type { Query } from 'firebase/firestore';
import type { Batch, Job, JobStatus } from '../../../shared/src/types';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { db } from '../../firebase';

export const RECENT_BATCH_LIMIT = 20;
export const RECENT_JOB_LIMIT = 50;
export const ACTION_BATCH_LIMIT = 5;
export const ACTION_JOB_LIMIT = 1000;
export const GENERATION_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const satisfies readonly JobStatus[];

const scopeQueries = (reference: Query, clientIds: readonly string[] | null): Query[] => {
  if (clientIds === null) return [reference];
  const queries: Query[] = [];
  for (let offset = 0; offset < clientIds.length; offset += 5) {
    queries.push(query(reference, where('clientId', 'in', clientIds.slice(offset, offset + 5))));
  }
  return queries;
};

const readRecent = async <T extends Job | Batch>(
  collectionName: 'jobs' | 'batches', clientIds: readonly string[] | null, maxResults: number,
): Promise<T[]> => {
  const reference = query(collection(db, collectionName), orderBy('createdAt', 'desc'), limit(maxResults));
  const snapshots = await Promise.all(scopeQueries(reference, clientIds).map(part => getDocsFromServer(part)));
  return snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as T))
    .sort((a, b) => toMillisOrZero(b.createdAt) - toMillisOrZero(a.createdAt) || (a.id === b.id ? 0 : a.id! < b.id! ? 1 : -1))
    .slice(0, maxResults);
};

export const readRecentBatches = (clientIds: readonly string[] | null) =>
  readRecent<Batch>('batches', clientIds, RECENT_BATCH_LIMIT);

export const readRecentJobs = (clientIds: readonly string[] | null) =>
  readRecent<Job>('jobs', clientIds, RECENT_JOB_LIMIT);

export const countGenerationJobs = async (clientIds: readonly string[] | null, status: JobStatus) => {
  const reference = query(collection(db, 'jobs'), where('status', '==', status));
  const parts = await Promise.all(scopeQueries(reference, clientIds).map(part => getCountFromServer(part)));
  return parts.reduce((total, part) => total + part.data().count, 0);
};

export const readActionBatchJobs = async (batch: Batch) => {
  const snapshot = await getDocsFromServer(query(
    collection(db, 'jobs'),
    where('clientId', '==', batch.clientId),
    where('batchId', '==', batch.id),
    limit(ACTION_JOB_LIMIT + 1),
  ));
  if (snapshot.size > ACTION_JOB_LIMIT) return null;
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as Job);
};
