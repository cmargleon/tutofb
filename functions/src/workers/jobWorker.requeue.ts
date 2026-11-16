import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Job } from '../../../shared/src/types';
import { getJobStuckSweepLimit } from '../config/runtime';
import { buildJobTimeoutFailureInfo, toFailureSummary } from '../errors/jobFailure';
import { shouldBackstopPendingJob } from './jobWorker.helpers';
import { db } from './jobWorker.resources';

// A pending job counts as orphaned only after this long without any write. Every
// worker/requeue/sweeper write bumps updatedAt, so this also acts as the cooldown that
// keeps the sweeper from re-marking a job it already marked and nobody has claimed yet.
// It is longer than the default retry delay (5 min), so deferred retries are activated
// by step 2 before they ever look stale here.
export const ORPHAN_PENDING_STALE_MS = 10 * 60 * 1000;
// Step 3 pages through stale pending jobs in pages of ORPHAN_SCAN_PAGE_SIZE, at most
// ORPHAN_SCAN_MAX_PAGES pages (1000 docs) per round. Healthy jobs that are stale anyway
// (budget-gated automation, retries deferred past the stale window) are skipped in memory,
// so an orphan is reached as long as fewer than 1000 of those are older than it.
const ORPHAN_SCAN_PAGE_SIZE = 100;
const ORPHAN_SCAN_MAX_PAGES = 10;

export interface RequeueExpiredJobsOptions {
  now?: Timestamp;
  sweepLimit?: number;
  orphanStaleMs?: number;
  orphanScanPageSize?: number;
}

export const requeueExpiredJobs = async (options: RequeueExpiredJobsOptions = {}): Promise<number> => {
  const now = options.now ?? Timestamp.now();
  const sweepLimit = options.sweepLimit ?? getJobStuckSweepLimit();
  const orphanStaleMs = options.orphanStaleMs ?? ORPHAN_PENDING_STALE_MS;
  const orphanScanPageSize = options.orphanScanPageSize ?? ORPHAN_SCAN_PAGE_SIZE;

  // 1. Recover stuck jobs (processing but claim expired).
  // The range filter on claimExpiresAt makes Firestore return them oldest-expired first,
  // and every job handled here leaves the result set (status changes), so they drain
  // in order at sweepLimit per round. Index: jobs(status, claimExpiresAt).
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
  // Same ordering guarantee as step 1: oldest retryNotBefore first, and each activated
  // job leaves the result set. Index: jobs(status, retryNotBefore).
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
  // Set schedulerPickupAt — the processJobOnActivation trigger fires per job in isolation.
  //
  // Only pending jobs with no write for orphanStaleMs are candidates, oldest updatedAt
  // first (index: jobs(status, updatedAt)). Marking a job bumps its updatedAt, so it
  // drops out of the candidates for orphanStaleMs instead of being re-marked every round,
  // and the next round reaches the following ones. Pending jobs never carry a claimToken
  // (every transition to pending clears it), and retryNotBefore/automationGate are
  // missing on never-claimed jobs but null on the rest, so Firestore cannot filter them:
  // shouldBackstopPendingJob still does that in memory while we page through the
  // candidates (see ORPHAN_SCAN_PAGE_SIZE for the bound).
  // Jobs just activated in step 2 are excluded to avoid double-triggering.
  const deferredIds = new Set(deferredSnapshot.docs.map((d) => d.id));
  const staleBefore = Timestamp.fromMillis(now.toMillis() - orphanStaleMs);
  const orphanPendingDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  let cursor: admin.firestore.QueryDocumentSnapshot | null = null;

  for (let page = 0; page < ORPHAN_SCAN_MAX_PAGES && orphanPendingDocs.length < sweepLimit; page += 1) {
    let query = db
      .collection('jobs')
      .where('status', '==', 'pending')
      .where('updatedAt', '<=', staleBefore)
      .orderBy('updatedAt', 'asc')
      .limit(orphanScanPageSize);
    if (cursor) query = query.startAfter(cursor);

    const pageSnapshot = await query.get();
    for (const docSnapshot of pageSnapshot.docs) {
      if (orphanPendingDocs.length >= sweepLimit) break;
      if (deferredIds.has(docSnapshot.id)) continue;
      if (shouldBackstopPendingJob({ id: docSnapshot.id, ...docSnapshot.data() } as Job)) {
        orphanPendingDocs.push(docSnapshot);
      }
    }

    if (pageSnapshot.size < orphanScanPageSize) break;
    cursor = pageSnapshot.docs[pageSnapshot.docs.length - 1];
  }

  if (orphanPendingDocs.length > 0) {
    const orphanBatch = db.batch();
    // A job claimed between the read and this write only gets a harmless timestamp:
    // processJobOnActivation ignores jobs that are no longer pending, and claimJob is
    // transactional, so a redundant activation never processes a job twice.
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
