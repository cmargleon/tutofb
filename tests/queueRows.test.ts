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
  getQueueClientOptions,
  getQueueProviderOptions,
  getQueueSection,
  getUnreviewedFailedJobs,
  groupQueueRowsBySection,
  QueueRow,
  summarizeQueue,
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

const NOW = 100 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test('getQueueSection: active batches first, then unreviewed failures within 7 days, then the last 24 h', () => {
  assert.equal(getQueueSection(row({ status: 'processing', updatedAt: 0 }), NOW), 'active');
  assert.equal(getQueueSection(row({ status: 'partial_failed', pendingJobs: 2, failedJobs: 1, updatedAt: 0 }), NOW), 'active');
  assert.equal(getQueueSection(row({ status: 'pending', updatedAt: 0 }), NOW), 'active');

  assert.equal(getQueueSection(row({ status: 'partial_failed', failedJobs: 2, updatedAt: NOW - 3 * DAY }), NOW), 'attention');
  assert.equal(getQueueSection(row({ status: 'failed', failedJobs: 2, updatedAt: NOW - 8 * DAY }), NOW), null);

  const reviewed = { status: 'partial_failed', failedJobs: 2, failuresAcknowledged: { failedJobs: 2 } } as Partial<Batch>;
  assert.equal(getQueueSection(row({ ...reviewed, updatedAt: NOW - 2 * HOUR }), NOW), 'recent');
  assert.equal(getQueueSection(row({ ...reviewed, updatedAt: NOW - 2 * DAY }), NOW), null);

  assert.equal(getQueueSection(row({ status: 'completed', completedJobs: 4, updatedAt: NOW - HOUR }), NOW), 'recent');
  assert.equal(getQueueSection(row({ status: 'completed', completedJobs: 4, updatedAt: NOW - 25 * HOUR }), NOW), null);
});

test('getUnreviewedFailedJobs resurfaces a batch when a retry fails again past the reviewed count', () => {
  assert.equal(getUnreviewedFailedJobs(batch({ failedJobs: 3 })), 3);
  assert.equal(getUnreviewedFailedJobs(batch({ failedJobs: 3, failuresAcknowledged: { failedJobs: 3 } } as Partial<Batch>)), 0);
  assert.equal(getUnreviewedFailedJobs(batch({ failedJobs: 1, failuresAcknowledged: { failedJobs: 3 } } as Partial<Batch>)), 0);
  assert.equal(getUnreviewedFailedJobs(batch({ failedJobs: 5, failuresAcknowledged: { failedJobs: 3 } } as Partial<Batch>)), 2);
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

test('filters, options, sections and summary', () => {
  const rows = [
    { ...row({ id: 'a', clientId: 'cz', clientNameSnapshot: 'Zeta', provider: 'fal-seedream', status: 'pending', pendingJobs: 2 }), ageStartedAt: 50, etaSeconds: 120 },
    { ...row({ id: 'b', clientId: 'ca', clientNameSnapshot: 'Alfa', provider: 'openai-gpt-image-1.5', status: 'processing', processingJobs: 1 }), ageStartedAt: 10, etaSeconds: 30 },
    row({ id: 'c', clientId: 'cz', clientNameSnapshot: 'Zeta', provider: 'fal-seedream', status: 'failed', failedJobs: 3, updatedAt: NOW - DAY }),
    row({ id: 'd', clientId: 'cz', clientNameSnapshot: 'Zeta', provider: 'fal-seedream', status: 'partial_failed', failedJobs: 1, updatedAt: NOW - HOUR }),
    row({ id: 'e', clientId: 'ca', clientNameSnapshot: 'Alfa', provider: 'fal-seedream', status: 'completed', completedJobs: 2, updatedAt: NOW - HOUR }),
  ];

  assert.deepEqual(getQueueClientOptions(rows), ['Alfa', 'Zeta']);
  assert.deepEqual(getQueueProviderOptions(rows), ['fal-seedream', 'openai-gpt-image-1.5']);

  const all = { clientFilter: 'all', providerFilter: 'all' } as const;
  assert.equal(filterQueueRows(rows, all).length, 5);
  assert.deepEqual(filterQueueRows(rows, { ...all, clientFilter: 'Alfa' }).map((entry) => entry.id), ['b', 'e']);
  assert.deepEqual(filterQueueRows(rows, { ...all, providerFilter: 'openai-gpt-image-1.5' }).map((entry) => entry.id), ['b']);

  const sections = groupQueueRowsBySection(rows, NOW);
  // Active: oldest waiting first. Finished: newest first.
  assert.deepEqual(sections.active.map((entry) => entry.id), ['b', 'a']);
  assert.deepEqual(sections.attention.map((entry) => entry.id), ['d', 'c']);
  assert.deepEqual(sections.recent.map((entry) => entry.id), ['e']);

  assert.deepEqual(summarizeQueue(sections), {
    activeJobs: 3,
    activeBatches: 2,
    etaSeconds: 120,
    attentionBatches: 2,
    attentionFailedJobs: 4,
  });
});
