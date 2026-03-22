import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Batch, Job } from '../shared/src/types';

const require = createRequire(import.meta.url);
const { buildExperimentArms, computeBatchExperimentAnalytics } = require('../functions/lib/shared/src/experiments.js') as {
  buildExperimentArms: typeof import('../shared/src/experiments').buildExperimentArms;
  computeBatchExperimentAnalytics: typeof import('../shared/src/experiments').computeBatchExperimentAnalytics;
};

const batch: Batch = {
  id: 'batch-exp-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  provider: 'fal-seedream',
  experimentEnabled: true,
  experimentId: 'batch-exp-1',
  experimentMode: 'ab_paired',
  experimentArms: buildExperimentArms(['fal-seedream', 'openai-gpt-image-1.5']),
  aspectRatio: '3:4',
  promptBase: 'prompt',
  backgroundConfig: {
    mode: 'white',
    scene: 'none',
    lighting: 'clear_soft_daylight',
    bokehStrength: 0,
    dominantColor: 'white',
    prominence: 'minimal',
    contrast: 'soft',
    realism: 'catalogo_realista',
    separation: 'strong',
    avoidExtraPeople: true,
    avoidDistractingProps: true,
    avoidTextSignage: true,
    customDetail: '',
  },
  poseIds: ['pose-1'],
  garmentCount: 1,
  totalJobs: 2,
  pendingJobs: 0,
  processingJobs: 0,
  completedJobs: 2,
  failedJobs: 0,
  status: 'completed',
  latestJobCreatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUid: 'admin',
};

const makeJob = (overrides: Partial<Job>): Job => ({
  id: 'job-1',
  batchId: 'batch-exp-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  experimentEnabled: true,
  experimentId: 'batch-exp-1',
  experimentMode: 'ab_paired',
  experimentArmId: 'arm_1',
  experimentArmLabel: 'A',
  experimentComparisonKey: 'pose-1::gar-1',
  poseImageId: 'pose-1',
  poseImagePath: 'pose.jpg',
  garmentId: 'gar-1',
  garmentName: 'Vestido',
  garmentFilePath: 'garment.jpg',
  garmentIsMultiAngle: false,
  aspectRatio: '3:4',
  provider: 'fal-seedream',
  promptBase: 'prompt',
  finalPrompt: 'prompt',
  backgroundConfig: batch.backgroundConfig,
  status: 'completed',
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
  latestOutputCreatedAt: null,
  currentOutputId: null,
  currentOutput: null,
  completedOutputCount: 1,
  totalCostUsd: 0.03,
  totalDurationSeconds: 12,
  providerUsage: {},
  manualRegenerationCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUid: 'admin',
  lastError: null,
  ...overrides,
});

test('computeBatchExperimentAnalytics recomienda el brazo más eficiente', () => {
  const summary = computeBatchExperimentAnalytics(batch, [
    makeJob({
      id: 'job-a',
      experimentArmId: 'arm_1',
      experimentArmLabel: 'A',
      provider: 'fal-seedream',
      totalCostUsd: 0.03,
      totalDurationSeconds: 10,
      manualRegenerationCount: 0,
    }),
    makeJob({
      id: 'job-b',
      experimentArmId: 'arm_2',
      experimentArmLabel: 'B',
      provider: 'openai-gpt-image-1.5',
      totalCostUsd: 0.08,
      totalDurationSeconds: 20,
      manualRegenerationCount: 1,
    }),
  ]);

  assert.ok(summary);
  assert.equal(summary?.winningArmId, 'arm_1');
  assert.equal(summary?.arms[0].totalJobs, 1);
  assert.equal(summary?.arms[1].manualRegenerationCount, 1);
});
