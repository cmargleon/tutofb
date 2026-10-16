import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { Job } from '../../../shared/src/types';
import { FAL_KEY, GEMINI_API_KEY } from '../config/runtime';
import { processJob } from '../workers/jobWorker';

/**
 * Fires when the scheduler activates a pending job without changing its status.
 * Two cases:
 *  1. Deferred retry ready: retryNotBefore cleared (was set, now null)
 *  2. Orphan backstop: schedulerPickupAt set/changed by the sweeper
 *
 * Runs in its own isolated Cloud Function instance (separate process, separate memory).
 * The sweeper never calls processJob directly — it only writes Firestore state.
 */
export const processJobOnActivation = onDocumentUpdated(
  {
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '2GiB',
    maxInstances: 20,
    secrets: [FAL_KEY, GEMINI_API_KEY],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const before = snapshot.before.data() as Job;
    const after = snapshot.after.data() as Job;

    // Only handle jobs that were already pending and stay pending.
    // Transitions TO pending (e.g., processing → pending) are handled by processJobOnRequeue.
    if (before.status !== 'pending' || after.status !== 'pending') return;

    // Case 1: deferred retry activated — scheduler cleared retryNotBefore
    const retryActivated = before.retryNotBefore != null && after.retryNotBefore == null;

    // Case 2: orphan backstop — scheduler set schedulerPickupAt
    const beforePickup = (before as unknown as Record<string, unknown>).schedulerPickupAt as Timestamp | null | undefined;
    const afterPickup = (after as unknown as Record<string, unknown>).schedulerPickupAt as Timestamp | null | undefined;
    const sweepActivated =
      afterPickup != null &&
      (beforePickup == null ||
        (typeof (beforePickup as Timestamp).toMillis === 'function' &&
          typeof (afterPickup as Timestamp).toMillis === 'function' &&
          (beforePickup as Timestamp).toMillis() !== (afterPickup as Timestamp).toMillis()));

    if (!retryActivated && !sweepActivated) return;

    await processJob(event.params.jobId, 'requeue', { skipBacklogSweep: true });
  },
);
