import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-manglar-parity';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('Manglar app parity: real handlers, exact approvals, scope and async edit budget (local Firebase)', { skip: !enabled }, async t => {
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { executeManglarTool } = require('../functions/lib/functions/src/automation/mcp.js');
  const owner = { uid: 'parity-admin', role: 'admin', connectionId: 'parity-connection', accessVersion: 0, allowedClientIds: null, scopes: ['jobs:read', 'jobs:create'] };
  const operator = { ...owner, uid: 'parity-operator', role: 'operador', accessVersion: 1, allowedClientIds: ['parity-client'] };
  let serial = 0;
  const call = (caller: any, domain: string, action: string, data: any, extra = {}) => executeManglarTool(`manglar_${domain}`, { action, data, ...extra }, caller);
  const write = (domain: string, action: string, data: any) => call(owner, domain, action, data, { idempotencyKey: `parity-write-${++serial}` });
  const prepare = async (domain: string, action: string, data: any, budgetUsd?: number) => {
    const result = await executeManglarTool('manglar_prepare_action', { domain, action, data, idempotencyKey: `parity-prepare-${++serial}`, ...(budgetUsd ? { budgetUsd, allowEstimatedCosts: true } : {}) }, owner);
    return { operationId: result.operationId, confirmationToken: result.confirmationToken, ...(budgetUsd ? { confirmedBudgetUsd: budgetUsd } : {}) };
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((url: any, options: any) => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(String(url)).hostname), 'Tests must not call real providers');
    return nativeFetch(url, options);
  }) as typeof fetch;
  try {
    await db.doc(`users/${owner.uid}`).set({ active: true, role: 'admin', clientAccess: { mode: 'global' } });
    await db.doc(`users/${operator.uid}`).set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['parity-client'] } });
    await db.doc(`manglarAccess/${operator.uid}`).set({ enabled: true, version: 1, clientIds: ['parity-client'] });
    await db.doc('clients/parity-client').set({ name: 'Parity', status: 'active' });
    await db.doc('clients/foreign-client').set({ name: 'Foreign', status: 'active' });
    await db.doc('batches/parity-batch').set({ clientId: 'parity-client', createdByUid: owner.uid, status: 'completed', failedJobs: 2, generationKind: 'product' });
    await db.doc('models/parity-model').set({ clientId: 'parity-client', status: 'active', poses: [] });
    const source = { id: 'source', jobId: 'parity-job', batchId: 'parity-batch', clientId: 'parity-client', resultImagePath: 'generated/parity-client/parity-batch/parity-job/source.jpg', provider: 'fal-gpt-image-2.5-flare', aspectRatio: '3:4', autoReview: { verdict: 'approved' } };
    await db.doc('jobs/parity-job').set({ clientId: 'parity-client', batchId: 'parity-batch', createdByUid: owner.uid, garmentId: 'item', garmentName: 'Product', status: 'completed', generationKind: 'product', currentOutput: source });
    await db.doc('jobs/parity-job/outputs/source').set(source);

    await t.test('contact-only updates retain concurrency and identity', async () => {
      const input = { id: 'parity-client', contacts: [{ name: 'Ana', email: 'ana@example.test' }], expected: { contacts: [] } };
      const saved = await write('clients', 'save', input);
      assert.deepEqual(saved.values.contacts, input.contacts);
      assert.equal(saved.values.name, 'Parity');
      await assert.rejects(() => write('clients', 'save', { ...input, contacts: [] }), { code: 'aborted' });
    });
    await t.test('marketplace changes require an exact approval and reject operators', async () => {
      const data = { clientId: 'parity-client', marketplaceId: 'amazon', enabled: true, expected: { enabled: false } };
      await assert.rejects(() => call(owner, 'clients', 'marketplace', data), { code: 'failed-precondition' });
      await assert.rejects(() => call(operator, 'clients', 'marketplace', data), { code: 'permission-denied' });
      const authorization = await prepare('clients', 'marketplace', data);
      await assert.rejects(() => call(owner, 'clients', 'marketplace', { ...data, enabled: false }, { authorization }), { code: 'permission-denied' });
      await call(owner, 'clients', 'marketplace', data, { authorization });
      assert.equal((await db.doc('clients/parity-client').get()).get('marketplaces.amazon.enabled'), true);
    });
    await t.test('free marketplace preview uses real projection and rejects paid flags', async () => {
      const scope = { clientId: 'parity-client', batchIds: ['parity-batch'] };
      const preview = await call(owner, 'spreadsheets', 'previewMarketplace', scope);
      assert.equal(preview.products.length, 1);
      assert.equal(preview.channels[0].marketplaceId, 'amazon');
      await assert.rejects(() => call(owner, 'spreadsheets', 'previewMarketplace', { ...scope, analyzeAutofill: true }), { code: 'invalid-argument' });
      await assert.rejects(() => call(owner, 'spreadsheets', 'analyzeMarketplace', scope), { code: 'failed-precondition' });
      await assert.rejects(() => call(operator, 'spreadsheets', 'previewMarketplace', scope), { code: 'permission-denied' });
      await assert.rejects(() => call(operator, 'spreadsheets', 'previewMarketplace', { clientId: 'foreign-client', batchIds: [] }), { code: 'permission-denied' });
    });
    await t.test('catalog-derived export batches cannot bypass production ownership', async () => {
      const { masterProductId } = require('../functions/lib/functions/src/spreadsheets/masterProducts.js');
      const legacyProductId = masterProductId({ id: 'parity-batch' }, 'item');
      const ref = db.doc('clients/parity-client/products/canonical');
      await ref.set({ clientId: 'parity-client', values: { name: 'Canonical' }, variants: [], marketplaces: {}, revision: 0, catalog: { version: 1 } });
      await ref.collection('generationLinks').doc('link').set({ clientId: 'parity-client', batchId: 'parity-batch', legacyProductId });
      await db.doc(`clients/parity-client/productAliases/${legacyProductId}`).set({ productId: 'canonical' });
      await assert.rejects(() => call(operator, 'spreadsheets', 'previewMarketplace', { clientId: 'parity-client', batchIds: [], catalogProductIds: ['canonical'] }), { code: 'permission-denied' });
    });
    await t.test('model activation, template state and queue failure review reuse handlers', async () => {
      await write('models', 'setActive', { modelId: 'parity-model', active: false });
      assert.equal((await db.doc('models/parity-model').get()).get('active'), false);
      await db.doc('clients/parity-client/spreadsheetTemplates/template').set({ status: 'active' });
      await write('spreadsheets', 'setStatus', { clientId: 'parity-client', templateId: 'template', status: 'disabled', expectedStatus: 'active' });
      assert.equal((await db.doc('clients/parity-client/spreadsheetTemplates/template').get()).get('status'), 'disabled');
      const input = { batchId: 'parity-batch' };
      const once = await call(owner, 'catalog', 'acknowledgeFailures', input, { idempotencyKey: 'ack-once' });
      assert.deepEqual(await call(owner, 'catalog', 'acknowledgeFailures', input, { idempotencyKey: 'ack-once' }), once);
      assert.equal(once.acknowledgedFailedJobs, 2);
    });
    await t.test('photo edits bind source versions, preserve budget for worker and never generate inline', async () => {
      const data = { jobId: 'parity-job', sourceOutputId: 'source', instructions: 'Use a white background.' };
      await assert.rejects(() => call(operator, 'catalog', 'editPhoto', data), { code: 'permission-denied' });
      await assert.rejects(() => call(owner, 'catalog', 'editPhoto', data), { code: 'failed-precondition' });
      const stale = await prepare('catalog', 'editPhoto', data, 2);
      await db.doc('jobs/parity-job/outputs/source').update({ changed: true });
      await assert.rejects(() => call(owner, 'catalog', 'editPhoto', data, { authorization: stale }), { code: 'failed-precondition' });
      const authorization = await prepare('catalog', 'editPhoto', data, 2);
      await call(owner, 'catalog', 'editPhoto', data, { authorization });
      const job = (await db.doc('jobs/parity-job').get()).data();
      assert.equal(job.status, 'pending');
      assert.equal(job.manglarBudgetId, authorization.operationId);
      assert.equal(job.imageEdit.sourceOutputId, 'source');
      assert.equal((await db.doc(`manglarOperations/${authorization.operationId}`).get()).get('committedUsd'), 0);
    });
  } finally {
    globalThis.fetch = nativeFetch;
    await cleanupEmulatorDatabase(db);
    await app.delete();
  }
});
