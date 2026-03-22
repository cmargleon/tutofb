import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Job, JobOutput } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { buildAnalyticsSnapshot, getJobStateDelta } = require('../functions/lib/functions/src/analytics/aggregation.js') as {
  buildAnalyticsSnapshot: typeof import('../functions/src/analytics/aggregation').buildAnalyticsSnapshot;
  getJobStateDelta: typeof import('../functions/src/analytics/aggregation').getJobStateDelta;
};

const baseJob = (overrides: Partial<Job>): Job => ({
  id: 'job-1',
  batchId: 'batch-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  experimentEnabled: false,
  experimentId: null,
  experimentMode: null,
  experimentArmId: null,
  experimentArmLabel: null,
  experimentComparisonKey: null,
  poseImageId: 'pose-1',
  poseImagePath: 'pose.jpg',
  garmentId: 'gar-1',
  garmentName: 'Vestido',
  garmentFilePath: 'garment.jpg',
  garmentIsMultiAngle: false,
  aspectRatio: '3:4',
  provider: 'fal-seedream',
  promptBase: 'prompt',
  finalPrompt: 'final prompt',
  status: 'pending',
  queuePriority: 0,
  retryCount: 0,
  maxRetries: 3,
  claimToken: null,
  claimedBy: null,
  claimExpiresAt: null,
  timeoutAt: null,
  lastAttemptStartedAt: null,
  startedAt: null,
  completedAt: null,
  currentOutputId: null,
  currentOutput: null,
  completedOutputCount: 0,
  totalCostUsd: 0,
  totalDurationSeconds: 0,
  manualRegenerationCount: 0,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  updatedAt: new Date('2026-03-02T00:00:00Z'),
  createdByUid: 'user-1',
  lastError: null,
  ...overrides,
});

const output = (overrides: Partial<JobOutput>): JobOutput => ({
  id: 'out-1',
  jobId: 'job-1',
  batchId: 'batch-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  poseImageId: 'pose-1',
  garmentId: 'gar-1',
  garmentName: 'Vestido',
  provider: 'fal-seedream',
  promptBase: 'prompt',
  finalPrompt: 'final',
  aspectRatio: '3:4',
  resultImagePath: 'generated/a.png',
  contentType: 'image/png',
  remoteUrl: null,
  requestId: 'req-1',
  costUsd: 0.03,
  durationSeconds: 12,
  isCurrent: true,
  createdAt: new Date('2026-03-03T00:00:00Z'),
  ...overrides,
});

test('getJobStateDelta separa conteo operativo y fallidos por proveedor', () => {
  const delta = getJobStateDelta(
    baseJob({ status: 'processing', provider: 'fal-seedream' }),
    baseJob({ status: 'failed', provider: 'fal-banana-pro', updatedAt: new Date('2026-03-04T12:00:00Z') }),
  );

  assert.equal(delta.summary.processingJobs, -1);
  assert.equal(delta.summary.failedJobs, 1);
  assert.equal(delta.providerFailed['fal-banana-pro'], 1);
  assert.equal(delta.dailyFailed.length, 1);
});

test('buildAnalyticsSnapshot calcula estado actual de jobs y costo acumulado por outputs reales', () => {
  const snapshot = buildAnalyticsSnapshot(
    [
      baseJob({ id: 'job-1', status: 'completed', provider: 'fal-seedream' }),
      baseJob({ id: 'job-2', status: 'failed', provider: 'fal-banana-pro', updatedAt: new Date('2026-03-04T12:00:00Z') }),
      baseJob({ id: 'job-3', status: 'processing', provider: 'openai-gpt-image-1.5' }),
    ],
    [
      output({ id: 'out-1', provider: 'fal-seedream', costUsd: 0.03, durationSeconds: 12 }),
      output({
        id: 'out-2',
        jobId: 'job-1',
        provider: 'openai-gpt-image-1.5',
        costUsd: 0.04,
        durationSeconds: 20,
        createdAt: new Date('2026-03-05T00:00:00Z'),
      }),
    ],
  );

  assert.equal(snapshot.summary.totalJobs, 3);
  assert.equal(snapshot.summary.completedJobs, 1);
  assert.equal(snapshot.summary.failedJobs, 1);
  assert.equal(snapshot.summary.processingJobs, 1);
  assert.equal(snapshot.summary.totalCompletedOutputs, 2);
  assert.equal(snapshot.summary.totalCostUsd, 0.07);
  assert.equal(snapshot.providers.find((provider) => provider.provider === 'fal-banana-pro')?.failed, 1);
  assert.equal(snapshot.providers.find((provider) => provider.provider === 'openai-gpt-image-1.5')?.completed, 1);
  assert.equal(snapshot.clientProviders.find((entry) => entry.id === 'client-1__fal-seedream')?.totalCostUsd, 0.03);
  assert.equal(
    snapshot.clientProviders.find((entry) => entry.id === 'client-1__openai-gpt-image-1.5')?.completed,
    1,
  );
});
