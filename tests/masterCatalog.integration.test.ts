import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-master-catalog';
const require = createRequire(import.meta.url);
const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') && process.env.GCLOUD_PROJECT === 'demo-manglar-automation';
test('canonical catalog: independent CRUD, concurrency, source links, dry-run, permissions and historical compatibility', { skip: !local }, async t => {
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const h = require('../functions/lib/functions/src/callables/catalogProducts.js');
  const { syncCatalogSource } = require('../functions/lib/functions/src/catalog/triggers.js');
  const { loadExportContext } = require('../functions/lib/functions/src/spreadsheets/marketplaceExportService.js');
  const exports = require('../functions/lib/functions/src/callables/marketplaceExports.js');
  const run = (name: string, data: unknown, uid = 'operator') => h[name].run({ data, auth: { uid, token: { role: 'admin' } } });
  const products = db.collection('clients').doc('c').collection('products');
  const input = { clientId: 'c', productId: 'canonical', expectedRevision: 0, values: { name: 'Camisa manual', sku: '00001', currency: 'MXN', price: '100' }, variants: [{ id: 'v', values: { sku: '00002', gtin: '00001234567890' }, attributes: {} }], status: 'draft', attributes: { capacity: '500 ml' }, verifiedGtinVariantIds: ['v'] };
  try {
    await Promise.all([
      db.doc('users/operator').set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['c'] } }),
      db.doc('users/foreign').set({ active: true, role: 'operador', clientAccess: { mode: 'assigned', clientIds: ['other'] } }),
      db.doc('clients/c').set({ name: 'Catalog test', status: 'active' }), db.doc('clients/other').set({ status: 'active' }),
    ]);
    for (const batchId of ['b1', 'b2']) {
      await db.doc(`batches/${batchId}`).set({ clientId: 'c', status: 'completed' });
      await db.doc(`jobs/${batchId}-job`).set({ clientId: 'c', batchId, garmentId: 'g', garmentName: 'Camisa importada', status: 'completed', currentOutput: { id: `${batchId}-out`, resultImagePath: `generated/c/${batchId}/j/out.jpg`, autoReview: { verdict: 'approved' } } });
      await db.doc(`batches/${batchId}/productDrafts/d`).set({ clientId: 'c', batchId, garmentId: 'g', garmentName: 'Camisa importada', rows: [{ id: 'r', values: { sku_code: '00002', goods_name: 'Camisa Excel', price: '90' } }], originalImages: [{ storagePath: 'garments/drafts/operator/ref.jpg', fileName: 'ref.jpg' }] });
    }
    await t.test('preview and paged history are read-only', async () => {
      const page = await run('listCatalogLegacyBatches', { clientId: 'c', pageSize: 1 }); assert.equal(page.batches.length, 1); assert.ok(page.nextCursor);
      const next = await run('listCatalogLegacyBatches', { clientId: 'c', cursor: page.nextCursor, pageSize: 1 }); assert.notEqual(page.batches[0].id, next.batches[0].id);
      await run('previewCatalogImport', { clientId: 'c', batchId: 'b1' });
      assert.equal((await products.get()).size, 0); assert.equal((await db.collection('clients').doc('c').collection('productAliases').get()).size, 0);
      await exports.previewMarketplaceExports.run({ data: { clientId: 'c', batchIds: ['b1'] }, auth: { uid: 'operator', token: {} } });
      assert.equal((await products.get()).size, 0);
    });
    await t.test('independent creation and exact retries retain identifiers and attributes', async () => {
      const saved = await run('saveCatalogProduct', input); assert.equal(saved.revision, 1); assert.deepEqual(await run('saveCatalogProduct', input), saved);
      const detail = await run('getCatalogProduct', { clientId: 'c', productId: 'canonical' });
      assert.equal(detail.links.length, 0); assert.equal(detail.product.values.sku, '00001'); assert.equal(detail.product.variants[0].values.gtin, '00001234567890'); assert.equal(typeof detail.product.updatedAt, 'number'); assert.equal(detail.product.catalog.evidence['variant.v.gtin'].verified, true);
    });
    await t.test('manual edits, stale revision and channel publications are preserved', async () => {
      await products.doc('canonical').set({ marketplaces: { shein: { templateId: 'existing', categoryId: 'cat' } }, futureField: 'retained' }, { merge: true });
      await products.doc('canonical').collection('marketplaceImages').doc('shein').set({ original: 'publication' });
      await run('saveCatalogProduct', { ...input, expectedRevision: 1, values: { ...input.values, description: '', name: 'Manual correction' }, variants: [{ ...input.variants[0], values: { ...input.variants[0].values, price: '150' } }], status: 'active' });
      await assert.rejects(run('saveCatalogProduct', { ...input, expectedRevision: 1 }), { code: 'aborted' });
      assert.equal((await products.doc('canonical').get()).get('marketplaces.shein.templateId'), 'existing'); assert.equal((await products.doc('canonical').get()).get('futureField'), 'retained'); assert.equal((await products.doc('canonical').collection('marketplaceImages').doc('shein').get()).get('original'), 'publication');
    });
    await t.test('explicit mappings associate multiple batches and imports cannot overwrite manual fields', async () => {
      for (const [index, batchId] of ['b1', 'b2'].entries()) {
        if (batchId === 'b2') { await syncCatalogSource('job', 'b2-job'); await syncCatalogSource('draft', 'd', 'b2'); }
        const { candidates: [candidate] } = await run('previewCatalogImport', { clientId: 'c', batchId });
        const payload = { clientId: 'c', batchId, legacyProductId: candidate.product.id, productId: 'canonical', expectedRevision: 2 + index, expectedSourceRevision: candidate.currentRevision, fingerprint: candidate.fingerprint, confirmAssociation: true, variantMap: { r: 'v' } };
        const saved = await run('applyCatalogImport', payload); assert.deepEqual(await run('applyCatalogImport', payload), saved);
      }
      const detail = await run('getCatalogProduct', { clientId: 'c', productId: 'canonical' });
      assert.equal(detail.links.length, 2); assert.equal(detail.product.values.name, 'Manual correction'); assert.equal(detail.product.variants.length, 1); assert.equal(detail.product.variants[0].values.price, '150'); assert.ok(detail.product.catalog.issues.some((i: any) => i.field === 'name'));
      const context = await loadExportContext({ clientId: 'c', batchIds: ['b1'] }, 'operator'); assert.equal(context.products[0].canonicalProductId, 'canonical'); assert.equal(context.products[0].values.name, 'Manual correction');
      const before = (await products.get()).size; await loadExportContext({ clientId: 'c', batchIds: ['b1'] }, 'operator'); assert.equal((await products.get()).size, before);
      const legacyId = context.products[0].id;
      await products.doc(legacyId).set({ clientId: 'c', values: {}, variants: [], revision: 0, marketplaces: { shein: { templateId: 'historical-template', categoryId: 'historical-category', rows: [{ id: 'r', values: { goods_name: 'Channel override' } }] } }, catalog: { redirectTo: 'canonical' } });
      const linked = await loadExportContext({ clientId: 'c', batchIds: ['b1'] }, 'operator');
      assert.equal(linked.products[0].marketplaces.shein.rows[0].id, 'v');
      assert.equal((await products.doc(legacyId).get()).get('marketplaces.shein.rows')[0].id, 'r');
      // A channel save against an associated generation updates the same canonical revision.
      const projected = linked.products[0];
      await exports.saveMasterProduct.run({ data: { clientId: 'c', batchIds: ['b1'], productId: legacyId, expectedRevision: projected.revision, values: projected.values, variants: projected.variants, marketplaces: {} }, auth: { uid: 'operator', token: {} } });
      const again = await loadExportContext({ clientId: 'c', batchIds: ['b1'] }, 'operator');
      assert.equal(again.products[0].values.name, 'Manual correction');
      assert.equal((await products.doc(legacyId).get()).get('clientId'), 'c');
    });
    await t.test('future source events are idempotent after an association', async () => {
      await syncCatalogSource('draft', 'd', 'b1');
      const rev = (await products.doc('canonical').get()).get('revision'); await syncCatalogSource('draft', 'd', 'b1'); assert.equal((await products.doc('canonical').get()).get('revision'), rev);
    });
    await t.test('manual confirmation remains protected after an automatic source refresh', async () => {
      await db.doc('batches/b3').set({ clientId: 'c' });
      await db.doc('jobs/b3-job').set({ clientId: 'c', batchId: 'b3', garmentId: 'g', garmentName: 'New source', status: 'pending' });
      await syncCatalogSource('job', 'b3-job');
      const { candidates: [first] } = await run('previewCatalogImport', { clientId: 'c', batchId: 'b3' });
      const auto = (await run('getCatalogProduct', { clientId: 'c', productId: first.product.id })).product;
      await run('saveCatalogProduct', { ...input, productId: auto.id, expectedRevision: auto.revision, values: auto.values, variants: auto.variants, attributes: {}, verifiedGtinVariantIds: [] });
      await db.doc('jobs/b3-job').update({ garmentName: 'Changed source' }); await syncCatalogSource('job', 'b3-job');
      const { candidates: [candidate] } = await run('previewCatalogImport', { clientId: 'c', batchId: 'b3' });
      const revision = (await products.doc('canonical').get()).get('revision');
      await assert.rejects(run('applyCatalogImport', { clientId: 'c', batchId: 'b3', legacyProductId: candidate.product.id, productId: 'canonical', expectedRevision: revision, expectedSourceRevision: candidate.currentRevision, fingerprint: candidate.fingerprint, confirmAssociation: true, variantMap: { g: 'v' } }), { code: 'failed-precondition' });
      assert.equal((await products.doc(auto.id).get()).get('catalog.manuallyConfirmed'), true);
    });
    await t.test('selection revalidates approved images, ownership and revision', async () => {
      const detail = await run('getCatalogProduct', { clientId: 'c', productId: 'canonical' });
      const link = detail.links.find((l: any) => l.batchId === 'b1');
      const images = await run('getCatalogGenerationImages', { clientId: 'c', productId: 'canonical', linkId: link.id }); assert.equal(images.products[0].approvedImages[0].outputId, 'b1-out');
      const selected = { ...input, expectedRevision: detail.product.revision, values: detail.product.values, variants: detail.product.variants, selectedImages: [{ linkId: link.id, jobId: 'b1-job', outputId: 'b1-out' }] };
      await run('saveCatalogProduct', selected);
      await db.doc('jobs/b1-job').update({ 'currentOutput.autoReview.verdict': 'rejected' });
      await assert.rejects(run('saveCatalogProduct', { ...selected, expectedRevision: selected.expectedRevision + 1 }), { code: 'failed-precondition' });
    });
    await t.test('same name and unverified SKU never merge products; duplicates are reviewable', async () => {
      await run('saveCatalogProduct', { ...input, productId: 'second' });
      const second = (await products.doc('second').get()).data(); assert.ok(second.catalog.issues.some((i: any) => i.kind === 'possible_duplicate')); assert.equal((await products.doc('canonical').get()).exists, true);
      await run('saveCatalogProduct', { ...input, clientId: 'other', productId: 'other-product' }, 'foreign');
      assert.equal((await db.doc('clients/other/products/other-product').get()).get('values.sku'), '00001');
    });
    await t.test('list/search/status paginate server-side without reconstructing historical batches', async () => {
      const first = await run('listCatalogProducts', { clientId: 'c', pageSize: 1 }); assert.equal(first.products.length, 1); assert.ok(first.nextCursor);
      const second = await run('listCatalogProducts', { clientId: 'c', pageSize: 1, cursor: first.nextCursor }); assert.notEqual(first.products[0].id, second.products[0]?.id);
      const matches = await run('listCatalogProducts', { clientId: 'c', search: '00001', status: 'draft' }); assert.ok(matches.products.every((p: any) => p.values.sku === '00001' && p.catalog.status === 'draft'));
      await db.doc('batches/broken-history').set({ clientId: 'c' }); await db.doc('jobs/broken-history').set({ clientId: 'other', batchId: 'broken-history' });
      assert.ok((await run('listCatalogProducts', { clientId: 'c', search: 'Camisa' })).products.length > 0);
    });
    await t.test('unauthenticated, foreign client/resource, invalid IDs and forged role claims are rejected', async () => {
      await assert.rejects(h.listCatalogProducts.run({ data: { clientId: 'c' } }), { code: 'unauthenticated' });
      for (const [name, data] of [['listCatalogProducts', { clientId: 'c' }], ['getCatalogProduct', { clientId: 'c', productId: 'canonical' }], ['saveCatalogProduct', input], ['previewCatalogImport', { clientId: 'c', batchId: 'b1' }]]) await assert.rejects(run(name as string, data, 'foreign'), { code: 'permission-denied' });
      await assert.rejects(run('previewCatalogImport', { clientId: 'other', batchId: 'b1' }, 'foreign'), { code: 'permission-denied' });
      await assert.rejects(run('getCatalogProduct', { clientId: 'c', productId: '../other' }), { code: 'invalid-argument' });
      await assert.rejects(run('saveCatalogProduct', { ...input, productId: 'bad', variants: [{ id: 'v', values: { sku: 123 } }] }), { code: 'invalid-argument' });
    });
  } finally { await cleanupEmulatorDatabase(db); await app.delete(); }
});
