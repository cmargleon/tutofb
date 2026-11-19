import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-organizer-binding';
const require = createRequire(import.meta.url);
const local = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') && process.env.GCLOUD_PROJECT === 'demo-manglar-automation';

test('base-code binding: automatic creation, unique link, ambiguity, concurrency and generation routing', { skip: !local }, async t => {
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'demo-manglar-automation' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { bindOrganizerBase, baseAliasId } = require('../functions/lib/functions/src/catalog/organizerBinding.js');
  const { catalogSearchKeys } = require('../functions/lib/functions/src/catalog/model.js');
  const { syncCatalogSource } = require('../functions/lib/functions/src/catalog/triggers.js');
  const { organizerLegacyIds } = require('../functions/lib/functions/src/automation/persistence.js');
  const client = db.collection('clients').doc('c');
  const products = client.collection('products');
  const variant = (base: string, skc: string, color = 'Negro') => ({ id: `org-${skc}`, base, visual: skc, name: 'Camisa Oxford', color, pack: '', category: 'Camisas',
    skcs: [skc], skus: [`${skc}-S`], sizes: ['S'], status: 'pending', issues: [], documented: {}, referenceState: 'approved', references: { front: [], back: [], main: [] }, driveFolderUrl: null, baseDeclared: true });
  const source = (skc: string) => ({ variants: [{ id: `mv-${skc}`, values: { skc, sku: `${skc}-S`, color: 'Negro', size: 'S' } }], origins: {}, values: { name: 'Camisa Oxford' }, issue: null });
  const existing = async (id: string, variants: { id: string; values: Record<string, string> }[]) => products.doc(id).set({ clientId: 'c', values: { name: id }, variants, marketplaces: {}, revision: 1,
    updatedAt: 0, updatedByUid: 'operator', catalog: { version: 1, status: 'active', createdAt: 0, evidence: {}, attributes: {}, issues: [], searchKeys: catalogSearchKeys({ name: id }, variants) } });
  try {
    await client.set({ name: 'Binding test', status: 'active' });
    await t.test('creates one draft product and its alias, idempotently', async () => {
      const first = await bindOrganizerBase('c', 'CAM001', 'b1', variant('CAM001', 'CAM001-N'), source('CAM001-N'));
      assert.equal(first.created, true);
      const again = await bindOrganizerBase('c', 'cam001', 'b1', variant('CAM001', 'CAM001-N'), source('CAM001-N'));
      assert.deepEqual(again, { productId: first.productId, created: false, issue: null });
      const product = await products.doc(first.productId).get();
      assert.equal(product.get('catalog.status'), 'draft');
      assert.equal(product.get('variants')[0].values.spu, 'CAM001');
      assert.equal((await client.collection('productAliases').doc(baseAliasId('CAM001')).get()).get('productId'), first.productId);
    });
    await t.test('concurrent first bindings converge on one product', async () => {
      const results = await Promise.all([1, 2, 3].map(() => bindOrganizerBase('c', 'CAM002', 'b2', variant('CAM002', 'CAM002-N'), source('CAM002-N'))));
      assert.equal(new Set(results.map((result: { productId: string }) => result.productId)).size, 1);
      const created = (await products.get()).docs.filter((doc: any) => doc.get('catalog.attributes.organizerBaseCode') === 'CAM002');
      assert.equal(created.length, 1);
    });
    await t.test('links to the single existing product with the code and reports ambiguity', async () => {
      await existing('manual-cam003', [{ id: 'v1', values: { spu: 'CAM003', color: 'Negro' } }]);
      const linked = await bindOrganizerBase('c', 'CAM003', 'b3', variant('CAM003', 'CAM003-N'), source('CAM003-N'));
      assert.deepEqual(linked, { productId: 'manual-cam003', created: false, issue: null });
      assert.equal((await products.doc('manual-cam003').get()).get('revision'), 1, 'binding never rewrites the product');
      await existing('dup-a', [{ id: 'v', values: { sku: 'CAM004-N-S' } }]);
      await existing('dup-b', [{ id: 'v', values: { spu: 'CAM004' } }]);
      const ambiguous = await bindOrganizerBase('c', 'CAM004', 'b4', variant('CAM004', 'CAM004-N'), source('CAM004-N'));
      assert.equal(ambiguous.productId, null);
      assert.match(ambiguous.issue, /2 fichas/);
      assert.equal((await client.collection('productAliases').doc(baseAliasId('CAM004')).get()).exists, false);
    });
    await t.test('a routed generation lands in the bound product without a duplicate', async () => {
      const [legacyId] = organizerLegacyIds('c', 'auto1', 'item1');
      await client.collection('productAliases').doc(legacyId).set({ clientId: 'c', productId: 'manual-cam003', legacyProductId: legacyId, origin: 'organizer', baseCode: 'CAM003' });
      await db.doc('batches/routed').set({ clientId: 'c', status: 'completed', automationJobId: 'auto1' });
      await db.doc('jobs/routed-job').set({ clientId: 'c', batchId: 'routed', garmentId: 'item1', garmentName: 'Camisa', status: 'completed' });
      await db.doc('batches/routed/productDrafts/d').set({ clientId: 'c', batchId: 'routed', garmentId: 'item1', garmentName: 'Camisa',
        rows: [{ id: 'r1', values: { sku_code: 'CAM003-N-S', goods_name: 'Camisa Oxford' } }, { id: 'r2', values: { sku_code: 'CAM003-B-S' } }] });
      await syncCatalogSource('job', 'routed-job');
      await syncCatalogSource('draft', 'd', 'routed');
      assert.equal((await products.doc(legacyId).get()).exists, false, 'no legacy duplicate is materialized');
      const product = await products.doc('manual-cam003').get();
      const links = await products.doc('manual-cam003').collection('generationLinks').get();
      assert.equal(links.size, 1);
      assert.ok(product.get('variants').some((row: { values: Record<string, string> }) => row.values.sku === 'CAM003-B-S'), 'new variant added');
      assert.equal(product.get('values.name'), 'manual-cam003', 'manual value keeps precedence');
      assert.notEqual(product.get('catalog.manuallyConfirmed'), true);
    });
  } finally {
    await cleanupEmulatorDatabase(db);
  }
});
