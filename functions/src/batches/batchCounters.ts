import * as admin from 'firebase-admin';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { Batch, BatchStatus } from '../../../shared/src/types';

export interface BatchJobCounts {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export type BatchCountersResult = 'written' | 'superseded' | 'missing';

export const deriveBatchStatus = (counts: BatchJobCounts): BatchStatus => {
  const { totalJobs, processingJobs, completedJobs, failedJobs } = counts;
  if (completedJobs === totalJobs) return 'completed';
  if (failedJobs === totalJobs) return 'failed';
  if (completedJobs + failedJobs === totalJobs) return 'partial_failed';
  if (processingJobs > 0) return 'processing';
  return 'pending';
};

const compareTimestamps = (a: Timestamp, b: Timestamp): number =>
  a.seconds !== b.seconds ? a.seconds - b.seconds : a.nanoseconds - b.nanoseconds;

const isTimestamp = (value: unknown): value is Timestamp =>
  value instanceof Timestamp
  || (typeof value === 'object' && value !== null
    && typeof (value as Timestamp).seconds === 'number' && typeof (value as Timestamp).nanoseconds === 'number');

/**
 * Recomputes a batch's job counters and status with count() aggregations instead of
 * reading every job, so the cost per call is constant (7 reads) and no job document is
 * locked while workers write to it.
 *
 * Correctness under concurrency (many jobs changing at once, bulk cancel, regenerate):
 *  1. The five counts are read in one read-only transaction pinned to a single read time
 *     R, so they always describe one consistent moment. Counts from different moments
 *     could add up to a terminal status that never existed, and onBatchFinanceClose
 *     records revenue once, on the first terminal status it sees.
 *  2. The batch is only updated if R is newer than the stored countersAsOf, so a slow
 *     call that read earlier can never overwrite a newer result ("latest read wins").
 *  3. R is taken after the triggering job write has committed, so the call that follows
 *     the last job change in a batch (or any later one) always writes the final values.
 * Delta updates are deliberately avoided: they race with the callables that set absolute
 * counters and drift forever on a duplicated trigger delivery.
 */
export const recomputeBatchCounters = async (
  db: Firestore,
  batchId: string,
  options: { writeTotalJobs?: boolean } = {},
): Promise<BatchCountersResult> => {
  const snapshot = await readBatchJobCounts(db, batchId);
  if (!snapshot) return 'missing';
  return applyBatchJobCounts(db, batchId, snapshot, options);
};

/** Step 1: consistent counts at one read time R, taken after any already-committed job write. */
export const readBatchJobCounts = async (
  db: Firestore,
  batchId: string,
): Promise<{ counts: BatchJobCounts; readTime: Timestamp } | null> => {
  const anchor = await db.collection('batches').doc(batchId).get();
  if (!anchor.exists) return null;
  const readTime = anchor.readTime;

  const jobs = db.collection('jobs').where('batchId', '==', batchId);
  const counts = await db.runTransaction(
    async (tx): Promise<BatchJobCounts> => {
      const countOf = async (query: admin.firestore.Query) => (await tx.get(query.count())).data().count;
      const [totalJobs, pendingJobs, processingJobs, completedJobs, failedJobs] = await Promise.all([
        countOf(jobs),
        countOf(jobs.where('status', '==', 'pending')),
        countOf(jobs.where('status', '==', 'processing')),
        countOf(jobs.where('status', '==', 'completed')),
        countOf(jobs.where('status', '==', 'failed')),
      ]);
      return { totalJobs, pendingJobs, processingJobs, completedJobs, failedJobs };
    },
    { readOnly: true, readTime },
  );
  return { counts, readTime };
};

/** Steps 2–3: write the counts unless the batch already holds counts read at R or later. */
export const applyBatchJobCounts = async (
  db: Firestore,
  batchId: string,
  { counts, readTime }: { counts: BatchJobCounts; readTime: Timestamp },
  options: { writeTotalJobs?: boolean } = {},
): Promise<BatchCountersResult> => {
  const batchRef = db.collection('batches').doc(batchId);
  const status = deriveBatchStatus(counts);

  // Optimistic compare-and-set instead of a transaction: hundreds of concurrent
  // recomputes on one batch exhaust transaction lock retries ("Transaction lock timeout"),
  // and a lost final write would leave wrong counters. A write guarded by the batch's
  // updateTime takes no locks; if anyone wrote the batch in between, re-read and re-check.
  // Each round either writes, or ends as superseded once a newer read has been stored.
  for (let attempt = 1; ; attempt += 1) {
    const batchSnapshot = await batchRef.get();
    if (!batchSnapshot.exists) return 'missing';

    const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;
    if (isTimestamp(batch.countersAsOf) && compareTimestamps(batch.countersAsOf, readTime) >= 0) {
      return 'superseded';
    }

    const notificationUpdate =
      batch?.notification?.retryState === 'queued' && (status === 'completed' || status === 'partial_failed' || status === 'failed')
        ? {
            notification: {
              ...batch.notification,
              retryState: counts.failedJobs > 0 ? 'failed_after_retry' : 'succeeded_after_retry',
            },
          }
        : {};

    try {
      await batchRef.update(
        {
          ...(options.writeTotalJobs ? { totalJobs: counts.totalJobs } : {}),
          pendingJobs: counts.pendingJobs,
          processingJobs: counts.processingJobs,
          completedJobs: counts.completedJobs,
          failedJobs: counts.failedJobs,
          status,
          countersAsOf: readTime,
          ...notificationUpdate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { lastUpdateTime: batchSnapshot.updateTime! },
      );
      return 'written';
    } catch (error) {
      if (!isPreconditionFailure(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(25 * attempt, 500)));
    }
  }
};

const MAX_WRITE_ATTEMPTS = 50;
// gRPC FAILED_PRECONDITION: the batch changed since we read it.
const isPreconditionFailure = (error: unknown): boolean => (error as { code?: unknown })?.code === 9;
