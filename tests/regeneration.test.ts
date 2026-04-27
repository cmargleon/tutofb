import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Job } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js') as {
  buildRegenerateJobPatch: typeof import('../functions/src/callables/regenerateJob.helpers').buildRegenerateJobPatch;
};

const job: Job = {
  id: 'job-1',
  batchId: 'batch-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  poseImageId: 'pose-1',
  poseImagePath: 'models/client-1/model-1/poses/a.jpg',
  garmentId: 'gar-1',
  garmentName: 'Vestido',
  garmentFilePath: 'garments/drafts/user-1/draft/gar-1.jpg',
  garmentIsMultiAngle: true,
  aspectRatio: '3:4',
  provider: 'fal-seedream',
  promptBase: 'prompt anterior',
  finalPrompt: 'prompt anterior',
  status: 'completed',
  queuePriority: 0,
  retryCount: 2,
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
  completedOutputCount: 1,
  totalCostUsd: 0.03,
  totalDurationSeconds: 12,
  manualRegenerationCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUid: 'user-1',
  lastError: null,
};

test('buildRegenerateJobPatch reinicia el job y recompone el prompt final', () => {
  const patch = buildRegenerateJobPatch(job, 'fal-banana-pro', 'nuevo prompt');

  assert.equal(patch.provider, 'fal-banana-pro');
  assert.equal(patch.imageConfig.provider, 'fal-banana-pro');
  assert.equal(patch.promptBase, 'nuevo prompt');
  assert.equal(patch.status, 'pending');
  assert.equal(patch.retryCount, 0);
  assert.match(patch.finalPrompt, /nuevo prompt/i);
  assert.match(patch.finalPrompt, /INTERNAL GARMENT DETAILS \(CRITICAL\)/);
  assert.match(patch.finalPrompt, /inner collar|inside of the garment|internal label/i);
  assert.match(patch.finalPrompt, /multiples angulos/i);
  assert.doesNotMatch(patch.finalPrompt, /Instrucciones de fondo/i);
  assert.doesNotMatch(patch.finalPrompt, /Evitar en el fondo/i);
});

test('buildRegenerateJobPatch rechaza provider invalido y prompt vacio', () => {
  assert.throws(() => buildRegenerateJobPatch(job, 'otro-provider', 'x'), /Proveedor inválido/);
  assert.throws(() => buildRegenerateJobPatch(job, 'fal-seedream', '   '), /prompt no puede quedar vacío/i);
});
