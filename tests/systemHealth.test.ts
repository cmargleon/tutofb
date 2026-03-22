import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ProviderHealthCheck, QueueHealthSnapshot } from '../shared/src/types';

const require = createRequire(import.meta.url);
const { computeOverallHealth } = require('../functions/lib/functions/src/admin/systemHealth.helpers.js') as {
  computeOverallHealth: typeof import('../functions/src/admin/systemHealth.helpers').computeOverallHealth;
};

const provider = (
  overrides: Partial<ProviderHealthCheck> & Pick<ProviderHealthCheck, 'provider'>,
): ProviderHealthCheck => ({
  provider: overrides.provider,
  status: 'healthy',
  ok: true,
  httpStatus: 200,
  latencyMs: 120,
  detail: 'ok',
  checkedAt: new Date('2026-03-21T00:00:00Z'),
  ...overrides,
});

const queue = (overrides: Partial<QueueHealthSnapshot>): QueueHealthSnapshot => ({
  pendingJobs: 2,
  processingJobs: 1,
  staleProcessingJobs: 0,
  recentCompletedJobs: 20,
  recentFailedJobs: 0,
  recentTerminalJobs: 20,
  recentErrorRate: 0,
  windowHours: 24,
  ...overrides,
});

test('computeOverallHealth marca el sistema como healthy cuando no hay presión ni fallos', () => {
  const result = computeOverallHealth(
    [provider({ provider: 'fal.ai' }), provider({ provider: 'OpenAI' })],
    queue({}),
  );

  assert.equal(result.overallStatus, 'healthy');
});

test('computeOverallHealth marca el sistema como down cuando una API cae o la tasa de error es alta', () => {
  const result = computeOverallHealth(
    [provider({ provider: 'fal.ai', status: 'down', ok: false }), provider({ provider: 'OpenAI' })],
    queue({ recentFailedJobs: 8, recentCompletedJobs: 12, recentTerminalJobs: 20, recentErrorRate: 40 }),
  );

  assert.equal(result.overallStatus, 'down');
});
