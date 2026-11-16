import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';

process.env.FIRESTORE_DATABASE_ID = 'test-product-workflow';
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  && process.env.GCLOUD_PROJECT === 'demo-manglar-automation';

test('product workflow uses frozen production links and validates scoped export and access on the server', { skip: !local }, async () => {
  const admin = requireFunctions('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const { getAppFirestore } = requireFunctions('./lib/functions/src/firebase/appFirestore.js');
  const { organizerAction } = requireFunctions('./lib/functions/src/organizer/api.js');
  const { createProductGenerationBatch } = requireFunctions('./lib/functions/src/callables/createProductGenerationBatch.js');
  const { previewMarketplaceExports } = requireFunctions('./lib/functions/src/callables/marketplaceExports.js');
  const { digest } = requireFunctions('./lib/functions/src/organizer/drive.js');
  const db = getAppFirestore();
  const context = { clientId: 'client-a', baseProductId: digest(['BASE-1']), variantId: 'variant-a' };
  const otherBase = digest(['BASE-2']);
  const run = (fn: any, data: unknown, uid = 'operator') => fn.run({ data, auth: { uid, token: { role: 'admin' } } });
  const workflow = (extra = {}, uid?: string) => run(organizerAction, { action: 'workflow', ...context, ...extra }, uid);
  const job = (batchId: string, garmentId: string, details = {}) => ({
    clientId: context.clientId, batchId, garmentId, garmentName: 'Mismo nombre', status: 'completed',
    currentOutput: { id: 'output', resultImagePath: `generated/client-a/${batchId}/job/output.jpg`, autoReview: { verdict: 'approved' } },
    ...details,
  });
  try {
    await Promise.all([
      db.doc('users/operator').set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['client-a'] } }),
      db.doc('users/reviewer').set({ active: true, role: 'revisor', clientAccess: { mode: 'assigned', clientIds: ['client-a'] } }),
      db.doc('users/unassigned').set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['client-b'] } }),
      db.doc('users/no-organizer').set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['client-a'] } }),
      db.doc('system_config/main').set({ batchMaxJobs: 30, jobMaxRetries: 2 }),
      db.doc('clients/client-a').set({ name: 'Cliente A', status: 'active', marketplaces: { shein: { enabled: true } } }),
      db.doc('clients/client-b').set({ name: 'Cliente B', status: 'active' }),
      db.doc('organizers/client-a').set({ clientId: 'client-a', operatorUids: ['operator', 'reviewer', 'unassigned'] }),
      db.doc('organizers/client-a/products/variant-a').set({ base: 'BASE-1', name: 'Mismo nombre', visual: 'AZUL', referenceState: 'approved', references: { front: [], back: [], main: ['reference'] } }),
      db.doc('organizers/client-a/products/variant-b').set({ base: 'BASE-1', name: 'Mismo nombre', visual: 'VERDE', referenceState: 'suggested', references: { front: [], back: [], main: [] } }),
      db.doc('organizers/client-a/products/variant-c').set({ base: 'BASE-2', name: 'Mismo nombre', visual: 'OTRO', referenceState: 'approved', references: { front: [], back: [], main: [] } }),
      db.doc(`organizers/client-a/baseProducts/${context.baseProductId}`).set({ code: 'BASE-1', name: 'Familia de prueba', variants: ['variant-a', 'variant-b'] }),
      db.doc('organizers/client-a/photos/reference').set({ name: 'Referencia.jpg' }),
      db.doc('batches/history').set({ clientId: 'client-a', automationJobId: 'known-intake', poseIds: [] }),
      db.doc('batches/no-link').set({ clientId: 'client-a', automationJobId: 'unknown-intake' }),
      db.doc('batches/foreign').set({ clientId: 'client-b' }),
      db.doc('automationJobs/known-intake').set({ clientId: 'client-a', organizerCommerce: true, batchIds: ['history'] }),
      db.doc('automationJobs/unknown-intake').set({ clientId: 'client-a', organizerCommerce: true, batchId: 'no-link' }),
      db.doc('automationJobs/known-intake/organizerCommerce/linked-item').set({ organizerVariantId: 'variant-a', itemId: 'linked-item', photos: [] }),
      db.doc('automationJobs/unknown-intake/organizerCommerce/unlinked-item').set({ organizerVariantId: null, itemId: 'unlinked-item' }),
      db.doc('jobs/approved').set(job('history', 'linked-item')),
      db.doc('jobs/flagged').set(job('history', 'linked-item', { manuallyFlagged: true })),
      db.doc('jobs/cancelled').set(job('history', 'linked-item', { status: 'failed', failureInfo: { reasonCode: 'manual_cancellation' } })),
      db.doc('jobs/same-name').set(job('history', 'different-item')),
      db.doc('jobs/no-link').set(job('no-link', 'unlinked-item')),
    ]);
    const request = {
      organizerContext: context, clientId: context.clientId, requestId: 'wizard-linked', provider: 'fal-gpt-image-2.5-flare',
      prompt: 'Fotografía de producto', scenes: [{ type: 'hero', prompt: 'Una escena' }],
      items: [{ id: 'wizard-item', name: 'Mismo nombre', referencePaths: ['garments/drafts/operator/draft/wizard-item/reference.jpg'] }],
    };
    await assert.rejects(run(createProductGenerationBatch, request, 'reviewer'), { code: 'permission-denied' });
    await assert.rejects(run(createProductGenerationBatch, { ...request, organizerContext: { ...context, variantId: 'variant-b' } }), { code: 'failed-precondition' });
    await assert.rejects(run(createProductGenerationBatch, { ...request, organizerContext: { ...context, baseProductId: otherBase } }), { code: 'not-found' });
    const created = await run(createProductGenerationBatch, request);
    assert.deepEqual(await run(createProductGenerationBatch, request), created);
    const batch = await db.doc(`batches/${created.batchId}`).get();
    assert.deepEqual(batch.get('organizerOrigin'), { baseProductId: context.baseProductId, variantId: 'variant-a', itemId: 'wizard-item' });
    const detail = await workflow();
    assert.equal(detail.baseName, 'Familia de prueba');
    assert.deepEqual(detail.variants.map((item: any) => item.id), ['variant-a', 'variant-b']);
    assert.equal(detail.references[0].name, 'Referencia.jpg');
    assert.deepEqual(detail.generations.map((item: any) => item.batchId), [created.batchId, 'history']);
    const history = detail.generations[1];
    assert.deepEqual([history.approved, history.attention, history.cancelled, history.itemIds], [1, 1, 1, ['linked-item']]);
    assert.equal(detail.generations[0].inProgress, 1);
    assert.equal((await workflow({ batchId: 'history' }, 'reviewer')).generations.length, 1);
    await assert.rejects(workflow({}, 'unassigned'), { code: 'permission-denied' });
    await assert.rejects(workflow({}, 'no-organizer'), { code: 'permission-denied' });
    await assert.rejects(workflow({ batchId: 'foreign' }), { code: 'permission-denied' });
    await assert.rejects(workflow({ batchId: 'no-link' }), { code: 'not-found' });
    await assert.rejects(workflow({ variantId: 'variant-c' }), { code: 'not-found' });

    const scope = { clientId: context.clientId, batchIds: ['history'], masterProductId: history.masterProductIds[0], organizerContext: context };
    const exportPreview = await run(previewMarketplaceExports, scope, 'reviewer');
    assert.equal(exportPreview.products.length, 1);
    assert.equal(exportPreview.products[0].approvedImages.length, 1);
    assert.deepEqual(exportPreview.channels.map((channel: any) => [channel.marketplaceId, channel.ready]), [['shein', false]]);
    assert.ok(exportPreview.channels[0].issues.some((issue: any) => issue.code === 'template'));
    await assert.rejects(run(previewMarketplaceExports, scope, 'no-organizer'), { code: 'permission-denied' });
    await assert.rejects(run(previewMarketplaceExports, { ...scope, masterProductId: 'unrelated' }), { code: 'not-found' });
    assert.equal((await db.collection('marketplaceExportRequests').get()).size, 0);
  } finally {
    await cleanupEmulatorDatabase(db);
    await app.delete();
  }
});
