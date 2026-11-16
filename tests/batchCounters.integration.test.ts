import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

type Status = 'pending' | 'processing' | 'completed' | 'failed';
const JOBS = 100;

const setup = () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
  assert.match(process.env.GCLOUD_PROJECT ?? '', /^demo-[\w-]+$/);
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
  }
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const counters = require('../functions/lib/functions/src/batches/batchCounters.js');
  return { db, ...counters };
};

const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 25));

const createBatch = async (db: any, batchId: string, extra: Record<string, unknown> = {}) => {
  const writer = db.batch();
  writer.set(db.collection('batches').doc(batchId), {
    totalJobs: JOBS, pendingJobs: JOBS, processingJobs: 0, completedJobs: 0, failedJobs: 0, status: 'pending', ...extra,
  });
  for (let i = 0; i < JOBS; i += 1) {
    writer.set(db.collection('jobs').doc(`${batchId}-job-${i}`), { batchId, status: 'pending' });
  }
  await writer.commit();
};

const cleanup = async (db: any, batchId: string) => {
  const writer = db.batch();
  for (let i = 0; i < JOBS; i += 1) writer.delete(db.collection('jobs').doc(`${batchId}-job-${i}`));
  writer.delete(db.collection('batches').doc(batchId));
  await writer.commit();
};

// Records every batch state the listener sees, to check none of them was inconsistent.
const watchBatch = (db: any, batchId: string) => {
  const seen: Array<Record<string, any>> = [];
  const unsubscribe = db.collection('batches').doc(batchId).onSnapshot((snapshot: any) => {
    if (snapshot.exists) seen.push(snapshot.data());
  });
  return { seen, unsubscribe };
};

test('batch counters converge under many concurrent status changes on one batch', { skip: !enabled }, async () => {
  const { db, recomputeBatchCounters } = setup();
  const batchId = `counters-${randomUUID()}`;
  await createBatch(db, batchId, { notification: { retryState: 'queued' } });
  const { seen, unsubscribe } = watchBatch(db, batchId);
  const triggers: Promise<unknown>[] = [];
  // Every job write is followed by a recompute that is NOT awaited before the next write,
  // like onJobStatusChange instances running in parallel, finishing in random order.
  const transition = async (jobId: string, status: Status) => {
    await jitter();
    await db.collection('jobs').doc(jobId).update({ status });
    triggers.push(jitter().then(() => recomputeBatchCounters(db, batchId)));
  };
  const ids = Array.from({ length: JOBS }, (_, i) => `${batchId}-job-${i}`);

  try {
    // Fresh batch: every job is claimed at once; some get rejected by review and retried.
    await Promise.all(ids.map((id) => transition(id, 'processing')));
    await Promise.all(ids.slice(0, 40).map(async (id) => { await transition(id, 'pending'); await transition(id, 'processing'); }));
    // Workers finish: 70 completed, 30 failed, all concurrently.
    await Promise.all(ids.map((id, i) => transition(id, i < 70 ? 'completed' : 'failed')));
    // Regenerate failed jobs and bulk-cancel 10 of them while the others complete.
    await Promise.all(ids.slice(70).map((id) => transition(id, 'pending')));
    await Promise.all(ids.slice(70).map((id, i) => (i < 10 ? transition(id, 'failed') : transition(id, 'processing'))));
    await Promise.all(ids.slice(80).map((id) => transition(id, 'completed')));

    await Promise.all(triggers);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const batch = (await db.collection('batches').doc(batchId).get()).data();
    assert.deepEqual(
      { pending: batch.pendingJobs, processing: batch.processingJobs, completed: batch.completedJobs, failed: batch.failedJobs, status: batch.status },
      { pending: 0, processing: 0, completed: 90, failed: 10, status: 'partial_failed' },
    );
    assert.equal(batch.notification.retryState, 'failed_after_retry', 'retryState logic is preserved');
    assert.ok(batch.countersAsOf, 'countersAsOf is written');

    // Every intermediate state written was a real, consistent snapshot of the batch.
    const written = seen.filter((state) => state.countersAsOf);
    assert.ok(written.length > 0);
    for (const state of written) {
      assert.equal(state.pendingJobs + state.processingJobs + state.completedJobs + state.failedJobs, JOBS, JSON.stringify(state));
    }
    // countersAsOf never moved backwards, so no older snapshot overwrote a newer one.
    for (let i = 1; i < written.length; i += 1) {
      assert.ok(written[i].countersAsOf.valueOf() >= written[i - 1].countersAsOf.valueOf(), 'countersAsOf is monotonic');
    }
  } finally {
    unsubscribe();
    await cleanup(db, batchId);
  }
});

test('a slow recompute that read before newer changes cannot overwrite the newer counters', { skip: !enabled }, async () => {
  const { db, readBatchJobCounts, applyBatchJobCounts, recomputeBatchCounters } = setup();
  const batchId = `counters-stale-${randomUUID()}`;
  await createBatch(db, batchId);
  try {
    // A trigger reads while every job is still pending, then stalls before writing...
    const stale = await readBatchJobCounts(db, batchId);
    // ...meanwhile the whole batch completes and a newer trigger writes the final values.
    const writer = db.batch();
    for (let i = 0; i < JOBS; i += 1) writer.update(db.collection('jobs').doc(`${batchId}-job-${i}`), { status: 'completed' });
    await writer.commit();
    assert.equal(await recomputeBatchCounters(db, batchId), 'written');
    // The stalled trigger finally writes: it must be rejected.
    assert.equal(await applyBatchJobCounts(db, batchId, stale), 'superseded');

    const batch = (await db.collection('batches').doc(batchId).get()).data();
    assert.equal(batch.completedJobs, JOBS);
    assert.equal(batch.pendingJobs, 0);
    assert.equal(batch.status, 'completed');
  } finally {
    await cleanup(db, batchId);
  }
});

test('deleting jobs recomputes totalJobs and keeps an empty batch completed', { skip: !enabled }, async () => {
  const { db, recomputeBatchCounters } = setup();
  const batchId = `counters-delete-${randomUUID()}`;
  await createBatch(db, batchId);
  try {
    const writer = db.batch();
    for (let i = 0; i < JOBS; i += 1) writer.delete(db.collection('jobs').doc(`${batchId}-job-${i}`));
    await writer.commit();
    assert.equal(await recomputeBatchCounters(db, batchId, { writeTotalJobs: true }), 'written');
    const batch = (await db.collection('batches').doc(batchId).get()).data();
    assert.equal(batch.totalJobs, 0);
    assert.equal(batch.status, 'completed');
  } finally {
    await cleanup(db, batchId);
  }
});
