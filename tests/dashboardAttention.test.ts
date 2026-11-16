import test from 'node:test';
import assert from 'node:assert/strict';
import type { Batch, Job, JobOutput } from '../shared/src/types';
import { createRequire } from 'node:module';

const { catalogBatchUrl, summarizeBatchAttention } = createRequire(import.meta.url)('../src/features/dashboard/attention.ts') as
  typeof import('../src/features/dashboard/attention');

test('Inicio distingue aprobación, incidencias y actividad en curso en un lote', () => {
  const batch = { id: 'lote', clientId: 'cliente' } as Batch;
  const now = 10_000;
  const photo = { id: 'output', resultImagePath: 'generated/cliente/lote/output.png' } as JobOutput;
  const job = (data: Partial<Job> = {}) => ({ status: 'completed', currentOutput: photo, ...data }) as Job;
  const attention = summarizeBatchAttention(batch, [
    job(),
    job({ userSelectedOutput: photo }),
    job({ retainedApprovedOutput: photo }),
    job({ currentOutput: { ...photo, autoReview: { verdict: 'approved' } as JobOutput['autoReview'] } }),
    job({ manuallyFlagged: true, userSelectedOutput: photo }),
    job({ currentOutput: { ...photo, storageDeletedAt: now } }),
    job({ status: 'failed', currentOutput: null }),
    job({ status: 'failed', currentOutput: null, failureInfo: { reasonCode: 'manual_cancellation' } as Job['failureInfo'] }),
    job({ status: 'processing', claimExpiresAt: now - 1 }),
    job({ status: 'processing', claimExpiresAt: now + 1 }),
    job({ status: 'processing', claimExpiresAt: null }),
  ], now);
  assert.deepEqual(attention, { batch, pendingReview: 1, incidents: 4, generating: true });
});

test('El enlace al catálogo codifica cliente y lote', () => {
  const url = new URL(catalogBatchUrl('cliente&1', 'lote +1'), 'https://tuto.example');
  assert.equal(url.pathname, '/catalogo');
  assert.equal(url.searchParams.get('clientId'), 'cliente&1');
  assert.equal(url.searchParams.get('batchId'), 'lote +1');
});
