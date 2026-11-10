import test from 'node:test';
import assert from 'node:assert/strict';
import type { Batch, Job } from '../shared/src/types';
import {
  buildCatalogBatchOptions,
  buildCatalogLightboxIndex,
  getNextLightboxTarget,
  getPreviousLightboxTarget,
  mergeCatalogDisplayGroups,
  reconcilePendingRegenerations,
  resolveLightboxJob,
  resolveSelectedCatalogBatch,
} from '../src/features/catalog/catalogView';

const job = (id: string | undefined, garmentId: string, createdAt: number, extra: Partial<Job> = {}): Job =>
  ({ id, garmentId, garmentName: `Prenda ${garmentId}`, createdAt, status: 'completed', ...extra } as unknown as Job);
const batch = (id: string | undefined, clientId: string): Batch => ({ id, clientId } as unknown as Batch);

test('batch options prepend a requested batch missing from the list and keep only the selected client', () => {
  const batches = [batch('b1', 'c1'), batch('b2', 'c2'), batch(undefined, 'c1')];
  assert.deepEqual(buildCatalogBatchOptions(batches, null, 'c1').map((entry) => entry.id), ['b1']);
  assert.deepEqual(buildCatalogBatchOptions(batches, batch('b9', 'c1'), 'c1').map((entry) => entry.id), ['b9', 'b1']);
  assert.deepEqual(buildCatalogBatchOptions(batches, batch('b1', 'c1'), 'c1').map((entry) => entry.id), ['b1']);
  assert.deepEqual(buildCatalogBatchOptions(batches, batch('b9', 'c2'), 'c1').map((entry) => entry.id), ['b1']);
});

test('selected batch prefers the requested batch, then the options, else null', () => {
  const options = buildCatalogBatchOptions([batch('b1', 'c1')], null, 'c1');
  const requested = batch('b5', 'c1');
  assert.equal(resolveSelectedCatalogBatch(options, '', requested), null);
  assert.equal(resolveSelectedCatalogBatch(options, 'b5', requested), requested);
  assert.equal(resolveSelectedCatalogBatch(options, 'b1', requested)?.id, 'b1');
  assert.equal(resolveSelectedCatalogBatch(options, 'zz', null), null);
});

test('merge returns the original groups when nothing is generating or pending', () => {
  const groups = [{ garmentId: 'g1', garmentName: 'G1', jobs: [job('j1', 'g1', 1)] }];
  assert.equal(mergeCatalogDisplayGroups(groups, [], {}, 'desc'), groups);
});

test('merge folds pending regenerations and generating jobs into groups and sorts by date', () => {
  const groups = [
    { garmentId: 'g1', garmentName: 'G1', jobs: [job('j1', 'g1', 10), job('j2', 'g1', 30)] },
  ];
  const replacement = job('j1', 'g1', 10, { status: 'pending' });
  const result = mergeCatalogDisplayGroups(
    groups,
    [job('j1', 'g1', 10, { status: 'processing' }), job('j3', 'g1', 20), job('j4', 'g2', 40), job(undefined, 'g3', 50)],
    { j1: { job: replacement, leftCatalog: false }, j5: { job: job('j5', 'g5', 5), leftCatalog: true } },
    'desc',
  );

  assert.deepEqual(result.map((group) => group.garmentId), ['g2', 'g1', 'g5']);
  assert.deepEqual(result[1].jobs.map((entry) => entry.id), ['j2', 'j3', 'j1']);
  assert.equal(result[1].jobs[2], replacement);
  assert.equal(result[1].garmentName, 'G1');
  assert.equal(result[0].garmentName, 'Prenda g2');

  const ascending = mergeCatalogDisplayGroups(groups, [job('j3', 'g1', 20)], {}, 'asc');
  assert.deepEqual(ascending[0].jobs.map((entry) => entry.id), ['j1', 'j3', 'j2']);
  // the input groups are not mutated
  assert.deepEqual(groups[0].jobs.map((entry) => entry.id), ['j1', 'j2']);
});

test('reconcile marks entries that left the catalog and drops those that returned', () => {
  const groups = [{ garmentId: 'g1', garmentName: 'G1', jobs: [job('a', 'g1', 1), job('b', 'g1', 2)] }];
  const unchanged = { a: { job: job('a', 'g1', 1), leftCatalog: false } };
  assert.equal(reconcilePendingRegenerations(unchanged, groups, []), unchanged);

  const generating = reconcilePendingRegenerations(unchanged, groups, [job('a', 'g1', 1)]);
  assert.notEqual(generating, unchanged);
  assert.equal(generating.a.leftCatalog, true);

  const missing = reconcilePendingRegenerations({ z: { job: job('z', 'g1', 1), leftCatalog: false } }, groups, []);
  assert.equal(missing.z.leftCatalog, true);

  const returned = reconcilePendingRegenerations(
    { b: { job: job('b', 'g1', 2), leftCatalog: true }, c: { job: job('c', 'g1', 3), leftCatalog: true } },
    groups,
    [],
  );
  assert.deepEqual(Object.keys(returned), ['c']);
});

test('lightbox index, navigation across groups and job resolution', () => {
  const groups = [
    { garmentId: 'g1', garmentName: 'G1', jobs: [job('a', 'g1', 1), job('b', 'g1', 2)] },
    { garmentId: 'g2', garmentName: 'G2', jobs: [job('c', 'g2', 3), job(undefined, 'g2', 4)] },
  ];
  const index = buildCatalogLightboxIndex(groups);
  assert.deepEqual([...index.entries()], [
    ['a', { garmentIndex: 0, jobIndex: 0 }],
    ['b', { garmentIndex: 0, jobIndex: 1 }],
    ['c', { garmentIndex: 1, jobIndex: 0 }],
  ]);

  assert.equal(getPreviousLightboxTarget(groups, null), null);
  assert.equal(getNextLightboxTarget(groups, null), null);
  assert.equal(getPreviousLightboxTarget(groups, { garmentIndex: 0, jobIndex: 0, jobId: 'a' }), null);
  assert.deepEqual(getNextLightboxTarget(groups, { garmentIndex: 0, jobIndex: 0, jobId: 'a' }), { garmentIndex: 0, jobIndex: 1, jobId: 'b' });
  assert.deepEqual(getNextLightboxTarget(groups, { garmentIndex: 0, jobIndex: 1, jobId: 'b' }), { garmentIndex: 1, jobIndex: 0, jobId: 'c' });
  assert.deepEqual(getPreviousLightboxTarget(groups, { garmentIndex: 1, jobIndex: 0, jobId: 'c' }), { garmentIndex: 0, jobIndex: 1, jobId: 'b' });
  assert.equal(getNextLightboxTarget(groups, { garmentIndex: 1, jobIndex: 0, jobId: 'c' }), null);
  assert.equal(getNextLightboxTarget(groups, { garmentIndex: 5, jobIndex: 0, jobId: 'x' }), null);

  assert.equal(resolveLightboxJob(groups, null, index), null);
  assert.equal(resolveLightboxJob(groups, { garmentIndex: 0, jobIndex: 1, jobId: 'b' }, index)?.id, 'b');
  // stale indexes fall back to the job id lookup
  assert.equal(resolveLightboxJob(groups, { garmentIndex: 0, jobIndex: 0, jobId: 'c' }, index)?.id, 'c');
  assert.equal(resolveLightboxJob(groups, { garmentIndex: 0, jobIndex: 0, jobId: 'nope' }, index), null);
});
