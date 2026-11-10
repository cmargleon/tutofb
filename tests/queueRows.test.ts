import test from 'node:test';
import assert from 'node:assert/strict';
import type { Batch, Job } from '../shared/src/types';
import {
  average,
  buildQueueRows,
  filterQueueRows,
  formatElapsedSince,
  formatRelativeDuration,
  getCompletedJobDuration,
  getKanbanStage,
  getQueueClientOptions,
  getQueueProviderOptions,
  groupQueueRowsByStage,
  QueueRow,
  sumQueueTotals,
} from '../src/features/queue/queueRows';

const batch = (overrides: Partial<Batch>): Batch => ({
  id: 'b1',
  status: 'pending',
  provider: 'fal-seedream',
  clientId: 'c1',
  clientNameSnapshot: 'Cliente',
  pendingJobs: 0,
  processingJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  totalJobs: 0,
  createdAt: 1_000,
  ...overrides,
} as unknown as Batch);

const job = (overrides: Partial<Job>): Job => ({ status: 'pending', ...overrides } as unknown as Job);

const row = (overrides: Partial<Batch>): QueueRow => ({
  id: overrides.id || 'b1',
  batch: batch(overrides),
  jobs: [],
  etaSeconds: null,
  ageStartedAt: null,
});

test('average returns null for empty input and the mean otherwise', () => {
  assert.equal(average([]), null);
  assert.equal(average([2, 4, 9]), 5);
});

test('formatRelativeDuration covers seconds, minutes, hours and invalid values', () => {
  assert.equal(formatRelativeDuration(null), 'n/d');
  assert.equal(formatRelativeDuration(Number.NaN), 'n/d');
  assert.equal(formatRelativeDuration(0.2), '1 s');
  assert.equal(formatRelativeDuration(42.4), '42 s');
  assert.equal(formatRelativeDuration(90), '2 min');
  assert.equal(formatRelativeDuration(3600), '1 h');
  assert.equal(formatRelativeDuration(3600 + 25 * 60), '1 h 25 min');
  assert.equal(formatRelativeDuration(7200 + 20), '2 h');
});

test('formatRelativeDuration never shows 60 of a unit at the unit boundaries', () => {
  assert.equal(formatRelativeDuration(59.6), '1 min');
  assert.equal(formatRelativeDuration(3570), '1 h');
  assert.equal(formatRelativeDuration(3600 + 59 * 60 + 40), '2 h');
  assert.equal(formatRelativeDuration(3599), '1 h');
  assert.equal(formatRelativeDuration(3500), '58 min');
});

test('formatElapsedSince handles null and recent timestamps', () => {
  assert.equal(formatElapsedSince(null), 'n/d');
  assert.equal(formatElapsedSince(Date.now() - 120_000), '2 min');
});

test('getCompletedJobDuration only counts positive durations of completed jobs', () => {
  assert.equal(getCompletedJobDuration(job({ status: 'pending', totalDurationSeconds: 10 })), null);
  assert.equal(getCompletedJobDuration(job({ status: 'completed', totalDurationSeconds: 10 })), 10);
  assert.equal(
    getCompletedJobDuration(job({ status: 'completed', totalDurationSeconds: 10, currentOutput: { durationSeconds: 7 } as Job['currentOutput'] })),
    7,
  );
  assert.equal(getCompletedJobDuration(job({ status: 'completed', totalDurationSeconds: 0 })), null);
});

test('getKanbanStage prioritises processing, then ready, then pending', () => {
  assert.equal(getKanbanStage(row({ processingJobs: 1, completedJobs: 3 })), 'processing');
  assert.equal(getKanbanStage(row({ status: 'processing' })), 'processing');
  assert.equal(getKanbanStage(row({ completedJobs: 1 })), 'ready');
  assert.equal(getKanbanStage(row({ failedJobs: 1 })), 'ready');
  assert.equal(getKanbanStage(row({ status: 'partial_failed' })), 'ready');
  assert.equal(getKanbanStage(row({ status: 'failed' })), 'ready');
  assert.equal(getKanbanStage(row({ pendingJobs: 4 })), 'pending');
});

test('buildQueueRows computes ETA from batch or global averages and age from the oldest queued job', () => {
  const rows = buildQueueRows(
    [
      batch({ id: 'a', pendingJobs: 3, processingJobs: 1, createdAt: 5_000 }),
      batch({ id: 'b', pendingJobs: 2, processingJobs: 0, createdAt: 9_000 }),
      batch({ id: 'c', pendingJobs: 0, processingJobs: 0, createdAt: 7_000 }),
    ],
    {
      a: [
        job({ status: 'completed', totalDurationSeconds: 10 }),
        job({ status: 'completed', totalDurationSeconds: 20 }),
        job({ status: 'pending', createdAt: 6_000 }),
        job({ status: 'processing', createdAt: 5_500 }),
      ],
      b: [job({ status: 'completed', totalDurationSeconds: 60 })],
    },
  );

  assert.deepEqual(rows.map((entry) => entry.id), ['a', 'b', 'c']);
  // a: 4 queued * 15 s / 1 slot
  assert.equal(rows[0].etaSeconds, 60);
  assert.equal(rows[0].ageStartedAt, 5_500);
  // b: 2 queued * 60 s / 1 slot
  assert.equal(rows[1].etaSeconds, 120);
  assert.equal(rows[1].ageStartedAt, 9_000);
  assert.equal(rows[2].etaSeconds, null);
  assert.deepEqual(rows[2].jobs, []);
});

test('buildQueueRows falls back to the global average when a batch has no completed jobs', () => {
  const rows = buildQueueRows(
    [batch({ id: 'a', pendingJobs: 4, processingJobs: 2 }), batch({ id: 'b', completedJobs: 1 })],
    { b: [job({ status: 'completed', totalDurationSeconds: 30 })] },
  );
  // 6 queued * 30 s / 2 slots
  assert.equal(rows[0].etaSeconds, 90);
});

test('filters, options, grouping and totals', () => {
  const rows = [
    row({ id: 'a', clientNameSnapshot: 'Zeta', provider: 'fal-seedream', status: 'pending', pendingJobs: 2 }),
    row({ id: 'b', clientNameSnapshot: 'Alfa', provider: 'openai-gpt-image-1.5', status: 'processing', processingJobs: 1 }),
    row({ id: 'c', clientNameSnapshot: 'Zeta', provider: 'fal-seedream', status: 'failed', failedJobs: 3 }),
  ];

  assert.deepEqual(getQueueClientOptions(rows), ['Alfa', 'Zeta']);
  assert.deepEqual(getQueueProviderOptions(rows), ['fal-seedream', 'openai-gpt-image-1.5']);

  const all = { clientFilter: 'all', providerFilter: 'all', statusFilter: 'all' } as const;
  assert.equal(filterQueueRows(rows, all).length, 3);
  assert.deepEqual(filterQueueRows(rows, { ...all, clientFilter: 'Zeta' }).map((entry) => entry.id), ['a', 'c']);
  assert.deepEqual(filterQueueRows(rows, { ...all, providerFilter: 'openai-gpt-image-1.5' }).map((entry) => entry.id), ['b']);
  assert.deepEqual(filterQueueRows(rows, { ...all, statusFilter: 'failed' }).map((entry) => entry.id), ['c']);

  const grouped = groupQueueRowsByStage(rows);
  assert.deepEqual(grouped.pending.map((entry) => entry.id), ['a']);
  assert.deepEqual(grouped.processing.map((entry) => entry.id), ['b']);
  assert.deepEqual(grouped.ready.map((entry) => entry.id), ['c']);

  assert.deepEqual(sumQueueTotals(rows), { pending: 2, processing: 1, failed: 3 });
});
