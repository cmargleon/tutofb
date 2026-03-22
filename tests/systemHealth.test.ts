import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ProviderHealthCheck, QueueHealthSnapshot } from '../shared/src/types';
import { normalizeSystemHealthSnapshot } from '../src/features/system/normalize';

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
    [provider({ provider: 'fal.ai' }), provider({ provider: 'OpenAI' }), provider({ provider: 'Gemini' })],
    queue({}),
  );

  assert.equal(result.overallStatus, 'healthy');
});

test('computeOverallHealth marca el sistema como down cuando una API cae o la tasa de error es alta', () => {
  const result = computeOverallHealth(
    [provider({ provider: 'fal.ai', status: 'down', ok: false }), provider({ provider: 'OpenAI' }), provider({ provider: 'Gemini' })],
    queue({ recentFailedJobs: 8, recentCompletedJobs: 12, recentTerminalJobs: 20, recentErrorRate: 40 }),
  );

  assert.equal(result.overallStatus, 'down');
});

test('normalizeSystemHealthSnapshot rellena bloques faltantes en payloads parciales', () => {
  const snapshot = normalizeSystemHealthSnapshot({
    overallStatus: 'healthy',
    summary: 'Todo en orden.',
    queue: {
      pendingJobs: 4,
    },
  });

  assert.equal(snapshot.overallStatus, 'healthy');
  assert.equal(snapshot.summary, 'Todo en orden.');
  assert.deepEqual(snapshot.providers, []);
  assert.deepEqual(snapshot.alerts, []);
  assert.equal(snapshot.queue.pendingJobs, 4);
  assert.equal(snapshot.queue.processingJobs, 0);
  assert.equal(snapshot.queue.windowHours, 24);
  assert.equal(snapshot.settings.recentErrorRateThreshold, 10);
  assert.equal(snapshot.settings.pendingJobsThreshold, 25);
  assert.equal(snapshot.todayCostUsd, 0);
});

test('normalizeSystemHealthSnapshot acepta Gemini como proveedor válido', () => {
  const snapshot = normalizeSystemHealthSnapshot({
    overallStatus: 'healthy',
    summary: 'Todo en orden.',
    providers: [
      {
        provider: 'Gemini',
        status: 'healthy',
        ok: true,
        httpStatus: 200,
        latencyMs: 180,
        detail: 'API responde correctamente.',
        checkedAt: new Date('2026-03-22T00:00:00Z'),
      },
    ],
  });

  assert.equal(snapshot.providers.length, 1);
  assert.equal(snapshot.providers[0]?.provider, 'Gemini');
  assert.equal(snapshot.providers[0]?.status, 'healthy');
});
