import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatchNotificationDescription, buildBatchNotificationItem, resolveBatchNotificationOutcome } from '../src/features/notifications/batchNotifications';
import { Batch } from '../shared/src/types';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveNotificationRetryProvider } = require('../functions/lib/functions/src/callables/regenerateFailedBatchJobs.helpers.js') as {
  resolveNotificationRetryProvider: typeof import('../functions/src/callables/regenerateFailedBatchJobs.helpers').resolveNotificationRetryProvider;
};

const baseBatch: Batch & { id: string } = {
  id: 'batch-1',
  clientId: 'client-1',
  clientNameSnapshot: 'Cliente Uno',
  modelId: 'model-1',
  modelNameSnapshot: 'Modelo Uno',
  provider: 'fal-seedream',
  aspectRatio: '3:4',
  promptBase: 'Prompt',
  poseIds: ['pose-1'],
  garmentCount: 2,
  totalJobs: 4,
  pendingJobs: 0,
  processingJobs: 0,
  completedJobs: 4,
  failedJobs: 0,
  status: 'completed',
  latestJobCreatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUid: 'user-1',
};

test('las notificaciones de batch consideran fallido cualquier lote con al menos un job fallido', () => {
  assert.equal(resolveBatchNotificationOutcome(baseBatch), 'completed');
  assert.equal(resolveBatchNotificationOutcome({ ...baseBatch, failedJobs: 1 }), 'failed');
});

test('las notificaciones muestran reintento hasta que el retry desde navbar vuelve a fallar', () => {
  const failedItem = buildBatchNotificationItem({
    ...baseBatch,
    status: 'partial_failed',
    completedJobs: 3,
    failedJobs: 1,
  });
  assert.equal(failedItem.canRetry, true);
  assert.equal(failedItem.showReviewIcon, false);

  const failedAfterRetryItem = buildBatchNotificationItem({
    ...baseBatch,
    status: 'partial_failed',
    completedJobs: 3,
    failedJobs: 1,
    notification: {
      retryState: 'failed_after_retry',
      retryProvider: 'openai-gpt-image-1.5',
    },
  });
  assert.equal(failedAfterRetryItem.canRetry, false);
  assert.equal(failedAfterRetryItem.showReviewIcon, true);
});

test('la descripción del batch resume completados y fallidos', () => {
  assert.equal(buildBatchNotificationDescription(baseBatch), '4/4 completados');
  assert.equal(
    buildBatchNotificationDescription({ ...baseBatch, completedJobs: 3, failedJobs: 1 }),
    '3/4 ok · 1 fallidos',
  );
});

test('el retry desde notificación alterna seedream y openai y nunca usa nanobanana', () => {
  assert.equal(resolveNotificationRetryProvider('fal-seedream'), 'openai-gpt-image-1.5');
  assert.equal(resolveNotificationRetryProvider('openai-gpt-image-1.5'), 'fal-seedream');
  assert.equal(resolveNotificationRetryProvider('fal-nano-banana-2', 0.2), 'fal-seedream');
  assert.equal(resolveNotificationRetryProvider('fal-banana-pro', 0.8), 'openai-gpt-image-1.5');
  assert.equal(resolveNotificationRetryProvider('fal-seedream-5', 0.8), 'openai-gpt-image-1.5');
});
