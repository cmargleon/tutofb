import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Job } from '../../../shared/src/types';
import { getJobStuckSweepLimit } from '../config/runtime';
import { buildJobTimeoutFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { shouldBackstopPendingJob } from './jobWorker.helpers';
import { db } from './jobWorker.resources';

export const requeueExpiredJobs = async (): Promise<number> => {
  const now = Timestamp.now();
  const sweepLimit = getJobStuckSweepLimit();

  // 1. Recover stuck jobs (processing but claim expired)
  const stuckSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'processing')
    .where('claimExpiresAt', '<=', now)
    .limit(sweepLimit)
    .get();

  if (!stuckSnapshot.empty) {
    const writeBatch = db.batch();
    stuckSnapshot.docs.forEach((docSnapshot) => {
      const job = { id: docSnapshot.id, ...docSnapshot.data() } as Job;
      const nextRetryCount = (job.retryCount || 0) + 1;
      const shouldRetry = nextRetryCount <= (job.maxRetries || 0);
      const failureInfo = buildJobTimeoutFailureInfo({
        retryable: shouldRetry,
        attemptNumber: job.generationAttemptCount || null,
        maxAttempts: job.maxRetries,
        provider: job.provider,
        requestId: job.currentOutput?.requestId || null,
      });
      const errorMessage = toFailureSummary(failureInfo);

      writeBatch.update(docSnapshot.ref, {
        status: shouldRetry ? 'pending' : 'failed',
        retryCount: nextRetryCount,
        retryNotBefore: null,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        'traceability.lastProviderErrorAt': admin.firestore.FieldValue.serverTimestamp(),
        'traceability.lastProviderErrorMessage': errorMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: errorMessage,
        failureInfo,
      });

      writeBatch.set(docSnapshot.ref.collection('logs').doc(), {
        type: shouldRetry ? 'retry_scheduled' : 'failed',
        level: shouldRetry ? 'warn' : 'error',
        message: shouldRetry
          ? 'El trabajo quedó atascado y fue reencolado automáticamente.'
          : 'El trabajo quedó atascado y fue marcado como fallido al agotar reintentos.',
        payload: {
          retryCount: nextRetryCount,
          maxRetries: job.maxRetries,
          previousClaimToken: job.claimToken,
          failureInfo,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await writeBatch.commit();
  }

  // 2. Activate deferred retry jobs whose wait time has elapsed.
  // Only clear retryNotBefore — the processJobOnActivation trigger picks up the job
  // in its own isolated Cloud Function instance (no API calls here).
  const deferredSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'pending')
    .where('retryNotBefore', '<=', now)
    .limit(sweepLimit)
    .get();

  if (!deferredSnapshot.empty) {
    const deferredBatch = db.batch();
    deferredSnapshot.docs.forEach((docSnapshot) => {
      deferredBatch.update(docSnapshot.ref, {
        retryNotBefore: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await deferredBatch.commit();
  }

  // 3. Backstop orphan pending jobs that were never claimed.
  // Exclude jobs just activated in step 2 to avoid double-triggering.
  // Set schedulerPickupAt — the processJobOnActivation trigger fires per job in isolation.
  const deferredIds = new Set(deferredSnapshot.docs.map((d) => d.id));

  const pendingSnapshot = await db
    .collection('jobs')
    .where('status', '==', 'pending')
    .limit(sweepLimit)
    .get();

  const orphanPendingDocs = pendingSnapshot.docs.filter(
    (docSnapshot) =>
      !deferredIds.has(docSnapshot.id) &&
      shouldBackstopPendingJob({ id: docSnapshot.id, ...docSnapshot.data() } as Job),
  );

  if (orphanPendingDocs.length > 0) {
    const orphanBatch = db.batch();
    orphanPendingDocs.forEach((docSnapshot) => {
      orphanBatch.update(docSnapshot.ref, {
        schedulerPickupAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await orphanBatch.commit();
  }

  return stuckSnapshot.size + deferredSnapshot.size + orphanPendingDocs.length;
};
