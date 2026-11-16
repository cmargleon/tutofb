import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

// Runs the real requeueExpiredJobs against the Firestore emulator (no Functions emulator,
// so processJobOnActivation does not fire; we only check what the sweeper marks).
test('orphan sweep reaches the oldest orphan when pending jobs exceed the sweep limit', { skip: !enabled }, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
  assert.match(process.env.GCLOUD_PROJECT ?? '', /^demo-[\w-]+$/);

  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
  }
  const { Timestamp } = require('../functions/node_modules/firebase-admin/lib/firestore');
  const { requeueExpiredJobs } = require('../functions/lib/functions/src/workers/jobWorker.requeue.js');
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();

  const run = randomUUID();
  const minutesAgo = (m: number) => Timestamp.fromMillis(Date.now() - m * 60_000);
  const base = { batchId: `batch-${run}`, status: 'pending', claimToken: null, createdAt: minutesAgo(120) };
  const jobs: Record<string, Record<string, unknown>> = {};

  // 60 healthy pending jobs that would crowd the old unordered limit(50):
  // 30 deferred retries (retryNotBefore in the future) touched long ago,
  for (let i = 0; i < 30; i += 1) {
    jobs[`${run}-deferred-${i}`] = { ...base, retryNotBefore: Timestamp.fromMillis(Date.now() + 3_600_000), updatedAt: minutesAgo(90 + i) };
  }
  // 15 automation jobs held by the budget gate, older than everything else,
  for (let i = 0; i < 15; i += 1) {
    jobs[`${run}-gated-${i}`] = { ...base, automationManaged: true, automationGate: 'budget', updatedAt: minutesAgo(200 + i) };
  }
  // 15 freshly created jobs (no retryNotBefore field at all, like real new jobs).
  for (let i = 0; i < 15; i += 1) {
    jobs[`${run}-fresh-${i}`] = { ...base, updatedAt: minutesAgo(1) };
  }
  // Orphans: the oldest has retryNotBefore missing, the next ones explicit null.
  jobs[`${run}-orphan-oldest`] = { ...base, updatedAt: minutesAgo(80) };
  for (let i = 0; i < 4; i += 1) {
    jobs[`${run}-orphan-${i}`] = { ...base, retryNotBefore: null, updatedAt: minutesAgo(60 - i) };
  }

  const writer = db.batch();
  for (const [id, data] of Object.entries(jobs)) writer.set(db.collection('jobs').doc(id), data);
  await writer.commit();

  const marked = async () => {
    const snapshot = await db.collection('jobs').where('batchId', '==', base.batchId).get();
    return new Map<string, number | null>(snapshot.docs.map((doc: any) => [doc.id, doc.get('schedulerPickupAt')?.toMillis() ?? null]));
  };

  try {
    // Small limit and page size so the 45 stale-but-healthy jobs (15 gated + 30 deferred)
    // fill several pages ahead of the orphans, as they would crowd an unordered limit(50).
    const sweep = () => requeueExpiredJobs({ sweepLimit: 3, orphanScanPageSize: 10 });
    await sweep();
    let state = await marked();
    const markedIds = [...state].filter(([, at]) => at !== null).map(([id]) => id).sort();
    assert.deepEqual(markedIds, [`${run}-orphan-0`, `${run}-orphan-1`, `${run}-orphan-oldest`].sort(),
      'first round marks the 3 oldest orphans, skipping gated, deferred and fresh jobs');

    const firstMarks = new Map(state);
    await sweep();
    state = await marked();
    for (const id of markedIds) {
      assert.equal(state.get(id), firstMarks.get(id), `${id} must not be re-marked while it has not gone stale again`);
    }
    assert.notEqual(state.get(`${run}-orphan-2`), null, 'second round reaches the next orphan');
    assert.notEqual(state.get(`${run}-orphan-3`), null, 'second round reaches the last orphan');
    for (const [id, at] of state) {
      if (!id.includes('orphan')) assert.equal(at, null, `${id} is healthy and must never be marked`);
    }
  } finally {
    const cleaner = db.batch();
    for (const id of Object.keys(jobs)) cleaner.delete(db.collection('jobs').doc(id));
    await cleaner.commit();
  }
});
