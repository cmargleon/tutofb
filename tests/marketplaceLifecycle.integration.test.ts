import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-marketplace-lifecycle';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('marketplace lifecycle regressions (local Firebase)', { skip: !enabled }, async t => {
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket();
  const XLSX = require('../functions/node_modules/xlsx');
  const h = require('../functions/lib/functions/src/callables/marketplaceExports.js');
  const imp = require('../functions/lib/functions/src/callables/importClientSpreadsheetTemplate.js').importClientSpreadsheetTemplate;
  const toggle = require('../functions/lib/functions/src/callables/updateClientMarketplace.js').updateClientMarketplace;
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://local-download.invalid/export']);
  const uid = 'lifecycle-admin';
  const req = (data: any, user = uid) => ({ auth: { uid: user, token: { role: 'admin' } }, data });
  const originals = new Map<string, Buffer>();
  const templateRef = (clientId: string, id: string) => db.doc(`clients/${clientId}/spreadsheetTemplates/${id}`);
  async function fixture(clientId: string) {
    await db.doc(`clients/${clientId}`).set({ name: clientId, status: 'active', marketplaces: { shein: { enabled: true }, amazon: { enabled: true } } });
    await db.doc(`batches/${clientId}`).set({ clientId, status: 'completed' });
    await db.doc(`jobs/${clientId}`).set({ clientId, batchId: clientId, garmentId: 'g', garmentName: 'Product', status: 'completed', currentOutput: { id: 'out', resultImagePath: `generated/${clientId}/${clientId}/j/out.jpg`, autoReview: { verdict: 'approved' } } });
    return { clientId, batchIds: [clientId] };
  }
  async function upload(clientId: string, channel: string | null, replacesTemplateId?: string) {
    const wb = XLSX.utils.book_new();
    const rows = channel === 'amazon' ? [['item_sku', 'item_name', 'quantity'], ['', '', '']] : [['SHEIN'], ['SPU', 'SKU', 'Nombre'], ['supplier_code', 'sku_code', 'goods_name'], ['Opcional', 'Requerido', 'Requerido'], [''], ['']];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Tops');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const storagePath = `client_spreadsheets/${clientId}/${randomUUID()}/template.xlsx`;
    await bucket.file(storagePath).save(bytes); originals.set(storagePath, bytes);
    const result = await imp.run(req({ clientId, storagePath, originalFileName: 'template.xlsx', ...(channel ? { marketplaceId: channel } : {}), ...(replacesTemplateId ? { replacesTemplateId } : {}) }));
    const doc = await templateRef(clientId, result.templateId).get(); originals.set(doc.get('storagePath'), bytes);
    return result.templateId;
  }
  async function configuration(clientId: string, templateId: string, channel = 'shein') {
    const snap = await templateRef(clientId, templateId).get();
    const mappings = snap.get('exportConfig.mappings') || { tops: { supplier_code: { source: 'legacy.supplier_code' }, sku_code: { source: 'legacy.sku_code' }, goods_name: { source: 'legacy.goods_name' } } };
    return { clientId, templateId, marketplaceId: channel, operation: 'listing', mappings };
  }
  async function activate(clientId: string, templateId: string, channel = 'shein') {
    const original = await templateRef(clientId, templateId).get();
    const id = (await h.configureMarketplaceTemplate.run(req(await configuration(clientId, templateId, channel)))).templateId;
    originals.set((await templateRef(clientId, id).get()).get('storagePath'), originals.get(original.get('storagePath'))!);
    return id;
  }
  async function activationRace(clientId: string, ids: string[]) {
    // Force both validations to finish before either transaction commits.
    const original = db.runTransaction.bind(db);
    let arrivals = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const mocked = t.mock.method(db, 'runTransaction', async (callback: any, ...args: any[]) => {
      if (++arrivals === ids.length) release();
      await gate;
      return original(callback, ...args);
    });
    try { return await Promise.allSettled(ids.map(id => activate(clientId, id))); }
    finally { mocked.mock.restore(); }
  }
  async function product(scope: any) { return (await h.previewMarketplaceExports.run(req(scope))).products[0]; }
  async function save(scope: any, p: any, marketplaces = p.marketplaces) {
    return h.saveMasterProduct.run(req({ ...scope, productId: p.id, expectedRevision: p.revision, values: p.values, variants: p.variants, marketplaces }));
  }
  try {
    await db.doc(`users/${uid}`).set({ role: 'admin', active: true });
    await db.doc('users/lifecycle-operator').set({ role: 'operador', active: true, clientAccess: { mode: 'assigned', clientIds: ['products'] } });
    await db.doc('users/lifecycle-reviewer').set({ role: 'revisor', active: true, clientAccess: { mode: 'assigned', clientIds: ['products'] } });
    await db.doc('users/lifecycle-limited').set({ role: 'operador', active: true, clientAccess: { mode: 'assigned', clientIds: ['other'] } });
    await t.test('repeated replacements, immutable history and simultaneous activation', async () => {
      const scope = await fixture('versions');
      const draftA = await upload(scope.clientId, 'shein');
      assert.equal((await templateRef(scope.clientId, draftA).get()).get('exportConfig.version'), 0);
      const a = await activate(scope.clientId, draftA);
      const p = await product(scope);
      p.values = { name: 'Historical product' }; p.variants = [{ id: 'v', values: { sku: '001', inventory: '2' } }];
      p.marketplaces = { shein: { templateId: a, categoryId: 'tops', rows: [{ id: 'v', values: { goods_name: 'Saved override' } }] } };
      await save(scope, p);
      const storedRef = db.doc(`clients/${scope.clientId}/products/${p.id}`);
      const storedBefore = (await storedRef.get()).data();
      const aBefore = await templateRef(scope.clientId, a).get();
      const draftB = await upload(scope.clientId, 'shein', a);
      assert.equal((await templateRef(scope.clientId, a).get()).get('status'), 'active', 'import alone does not replace the current version');
      const b = await activate(scope.clientId, draftB);
      const bSnap = await templateRef(scope.clientId, b).get();
      assert.equal((await templateRef(scope.clientId, a).get()).get('status'), 'archived', 'A must stop being current when B replaces it');
      assert.equal(a, draftA, 'activate the pending document without another temporary version');
      assert.equal(aBefore.get('exportConfig.version'), 1);
      assert.equal(b, draftB); assert.equal(bSnap.get('exportConfig.version'), 2); assert.equal(bSnap.get('exportConfig.replacesTemplateId'), a);
      assert.ok(bSnap.get('exportConfig.legacyTemplateIds').includes(a));
      assert.equal((await templateRef(scope.clientId, a).get()).get('exportConfig.supersededByTemplateId'), b);
      assert.deepEqual((await templateRef(scope.clientId, a).get()).get('exportConfig.mappings'), aBefore.get('exportConfig.mappings'));
      assert.deepEqual((await storedRef.get()).data(), storedBefore);
      const historical = await h.previewMarketplaceExports.run(req(scope));
      assert.equal(historical.products[0].marketplaces.shein.templateId, a);
      assert.equal(historical.channels.find((c: any) => c.marketplaceId === 'shein').ready, true);
      const download = await h.downloadMarketplaceExports.run(req({ ...scope, marketplaceIds: ['shein'], requestId: randomUUID() }));
      assert.deepEqual(download.exportedMarketplaces, ['shein']);
      const artifact = (await db.collection('marketplaceExportRequests').get()).docs.find((d: any) => d.get('result.fileName') === download.fileName);
      const exported = XLSX.read((await bucket.file(artifact.get('artifactPath')).download())[0], { type: 'buffer' });
      assert.equal(exported.Sheets.Tops.C7.v, 'Saved override');
      const draftC = await upload(scope.clientId, 'shein', b);
      const draftD = await upload(scope.clientId, 'shein', b);
      const race = await activationRace(scope.clientId, [draftC, draftD]);
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((race.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'aborted');
      const c = (race.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>).value;
      assert.equal((await templateRef(scope.clientId, c).get()).get('exportConfig.version'), 3);
      assert.ok((await templateRef(scope.clientId, c).get()).get('exportConfig.legacyTemplateIds').includes(a));
      const sameSource = await activationRace(scope.clientId, [c, c]);
      assert.equal(sameSource.filter(r => r.status === 'fulfilled').length, 1);
      const current = (sameSource.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>).value;
      const versions = (await templateRef(scope.clientId, a).parent.get()).docs;
      assert.equal(versions.filter((d: any) => d.get('status') === 'active' && d.get('exportConfig.validationStatus') === 'compatible').length, 1);
      assert.equal((await templateRef(scope.clientId, current).get()).get('exportConfig.version'), 4);
      const draftE = await upload(scope.clientId, 'shein', current);
      const pendingRace = await activationRace(scope.clientId, [draftE, draftE]);
      assert.equal(pendingRace.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await templateRef(scope.clientId, draftE).get()).get('exportConfig.version'), 5);
      await h.archiveMarketplaceTemplate.run(req({ clientId: scope.clientId, templateId: draftE }));
      const onlyHistorical = await h.previewMarketplaceExports.run(req(scope));
      assert.equal(onlyHistorical.channels.find((ch: any) => ch.marketplaceId === 'shein').ready, true);
      assert.equal(onlyHistorical.channels.find((ch: any) => ch.marketplaceId === 'shein').compatibleTemplates, 1);
      assert.deepEqual((await h.downloadMarketplaceExports.run(req({ ...scope, marketplaceIds: ['shein'], requestId: randomUUID() }))).exportedMarketplaces, ['shein']);
      // Manual archival still revokes export; supersession alone preserves historical use.
      await h.archiveMarketplaceTemplate.run(req({ clientId: scope.clientId, templateId: a }));
      assert.equal((await h.previewMarketplaceExports.run(req(scope))).channels.find((ch: any) => ch.marketplaceId === 'shein').ready, false);
    });
    await t.test('an activation repairs active ancestors left by the old lifecycle without renumbering or changing products', async () => {
      const scope = await fixture('old-lineage');
      const a = await activate(scope.clientId, await upload(scope.clientId, 'shein'));
      let p = await product(scope);
      p.values = { name: 'Older saved product' }; p.variants = [{ id: 'v', values: { sku: 'OLD-001' } }];
      p.marketplaces = { shein: { templateId: a, categoryId: 'tops' } }; await save(scope, p);
      const b = await activate(scope.clientId, await upload(scope.clientId, 'shein', a));
      // Recreate the released state produced by 8632676, including its numbering.
      await templateRef(scope.clientId, a).update({ status: 'active', 'exportConfig.version': 2, 'exportConfig.supersededByTemplateId': admin.firestore.FieldValue.delete() });
      await templateRef(scope.clientId, b).update({ 'exportConfig.version': 4 });
      const storedRef = db.doc(`clients/${scope.clientId}/products/${p.id}`); const before = (await storedRef.get()).data();
      const categoriesBefore = (await templateRef(scope.clientId, a).collection('categories').get()).docs.map((d: any) => d.data());
      const c = await activate(scope.clientId, b);
      assert.equal((await templateRef(scope.clientId, a).get()).get('status'), 'archived');
      assert.equal((await templateRef(scope.clientId, a).get()).get('exportConfig.supersededByTemplateId'), c);
      assert.equal((await templateRef(scope.clientId, a).get()).get('exportConfig.version'), 2);
      assert.equal((await templateRef(scope.clientId, b).get()).get('exportConfig.version'), 4);
      assert.equal((await templateRef(scope.clientId, c).get()).get('exportConfig.version'), 5);
      assert.deepEqual((await storedRef.get()).data(), before);
      assert.deepEqual((await templateRef(scope.clientId, a).collection('categories').get()).docs.map((d: any) => d.data()), categoriesBefore);
      assert.equal((await h.previewMarketplaceExports.run(req(scope))).channels.find((ch: any) => ch.marketplaceId === 'shein').ready, true);
    });
    await t.test('disabled channels survive partial saves, stale writes and re-enabling', async () => {
      const scope = await fixture('products');
      const shein = await activate(scope.clientId, await upload(scope.clientId, 'shein'));
      const amazon = await activate(scope.clientId, await upload(scope.clientId, 'amazon'), 'amazon');
      let p = await product(scope);
      p.values = { name: 'Before', brand: 'Brand' }; p.variants = [{ id: 'v', values: { sku: '001', inventory: '2' } }];
      p.marketplaces = { shein: { templateId: shein, categoryId: 'tops' }, amazon: { templateId: amazon, categoryId: 'tops', rows: [{ id: 'v', values: { item_name: 'Amazon original' } }], requirements: { gtinExemptionByVariant: { v: 'approved' } } } };
      await save(scope, p);
      p = await product(scope); const amazonBefore = structuredClone(p.marketplaces.amazon);
      await toggle.run(req({ clientId: scope.clientId, marketplaceId: 'amazon', enabled: false, expected: { enabled: true } }));
      // Existing clients sending an unchanged disabled channel remain compatible.
      p.values.name = 'After'; await save(scope, p);
      p = await product(scope); assert.deepEqual(p.marketplaces.amazon, amazonBefore);
      p.values.brand = 'Changed brand'; p.variants = [{ id: 'new-v', values: { sku: '002', inventory: '3' } }];
      await save(scope, p, { shein: { templateId: shein, categoryId: 'tops' } });
      p = await product(scope); assert.deepEqual(p.marketplaces.amazon, amazonBefore);
      const tampered = { ...p.marketplaces, amazon: { ...amazonBefore, rows: [] } };
      await assert.rejects(save(scope, p, tampered), { code: 'invalid-argument' });
      await assert.rejects(h.saveMasterProduct.run(req({ ...scope, productId: p.id, expectedRevision: p.revision - 1, values: { name: 'Stale' }, variants: p.variants, marketplaces: {} })), { code: 'aborted' });
      const writes = await Promise.allSettled([save(scope, { ...p, values: { name: 'Winner 1' } }, {}), save(scope, { ...p, values: { name: 'Winner 2' } }, {})]);
      assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((writes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'aborted');
      p = await product(scope); assert.deepEqual(p.marketplaces.amazon, amazonBefore); assert.equal(p.marketplaces.shein.templateId, shein);
      // A channel toggle during prevalidation must be rechecked in the commit transaction.
      const originalTransaction = db.runTransaction.bind(db); let intercepted = false;
      const mock = t.mock.method(db, 'runTransaction', async (callback: any, ...args: any[]) => {
        if (!intercepted) { intercepted = true; await db.doc(`clients/${scope.clientId}`).update({ 'marketplaces.shein.enabled': false }); }
        return originalTransaction(callback, ...args);
      });
      await assert.rejects(save(scope, p, { shein: { ...p.marketplaces.shein, rows: [{ id: 'new-v', values: { goods_name: 'Hidden edit' } }] } }), { code: 'invalid-argument' });
      mock.mock.restore();
      p = await product(scope); p.values.name = 'All disabled'; await save(scope, p, {});
      assert.deepEqual((await product(scope)).marketplaces.amazon, amazonBefore);
      await toggle.run(req({ clientId: scope.clientId, marketplaceId: 'amazon', enabled: true, expected: { enabled: false } }));
      assert.deepEqual((await product(scope)).marketplaces.amazon, amazonBefore);
      // Enabled channels and roles still work; foreign clients/batches/templates stay forbidden.
      for (const user of ['lifecycle-operator', 'lifecycle-reviewer']) {
        p = await product(scope);
        await h.saveMasterProduct.run(req({ ...scope, productId: p.id, expectedRevision: p.revision, values: p.values, variants: p.variants, marketplaces: {} }, user));
        await assert.rejects(h.configureMarketplaceTemplate.run(req(await configuration(scope.clientId, amazon, 'amazon'), user)), { code: 'permission-denied' });
      }
      p = await product(scope);
      const input = { ...scope, productId: p.id, expectedRevision: p.revision, values: p.values, variants: p.variants, marketplaces: {} };
      await assert.rejects(h.saveMasterProduct.run(req(input, 'lifecycle-limited')), { code: 'permission-denied' });
      await assert.rejects(h.saveMasterProduct.run({ data: input }), { code: 'unauthenticated' });
      await assert.rejects(h.previewMarketplaceExports.run(req({ clientId: 'versions', batchIds: scope.batchIds })), { code: 'permission-denied' });
      await assert.rejects(h.configureMarketplaceTemplate.run(req(await configuration(scope.clientId, amazon, 'amazon'), 'lifecycle-limited')), { code: 'permission-denied' });
      await fixture('other');
      const foreignTemplate = await activate('other', await upload('other', 'amazon'), 'amazon');
      const before = (await db.doc(`clients/${scope.clientId}/products/${p.id}`).get()).data();
      await assert.rejects(save(scope, p, { amazon: { templateId: foreignTemplate, categoryId: 'tops' } }), { code: 'invalid-argument' });
      assert.deepEqual((await db.doc(`clients/${scope.clientId}/products/${p.id}`).get()).data(), before);
    });
    await t.test('legacy generation template, drafts, categories and all original bytes remain intact', async () => {
      const scope = await fixture('legacy');
      const old = await upload(scope.clientId, null);
      const before = (await templateRef(scope.clientId, old).get()).data();
      const categories = (await templateRef(scope.clientId, old).collection('categories').get()).docs.map((d: any) => d.data());
      const draftRef = db.doc(`batches/${scope.clientId}/productDrafts/old`);
      const legacy = { clientId: scope.clientId, batchId: scope.clientId, garmentId: 'g', templateId: old, categoryId: 'tops', rows: [{ id: 'v', values: { sku_code: 'OLD', goods_name: 'Legacy', unknown: 'Preserved' } }] };
      await draftRef.set(legacy);
      const race = await activationRace(scope.clientId, [old, old]);
      assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((race.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'aborted');
      const associated = (race.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>).value;
      const replacement = await activate(scope.clientId, await upload(scope.clientId, 'shein', associated));
      assert.equal((await templateRef(scope.clientId, associated).get()).get('exportConfig.version'), 1);
      assert.equal((await templateRef(scope.clientId, replacement).get()).get('exportConfig.version'), 2);
      assert.notEqual((await templateRef(scope.clientId, associated).get()).get('storagePath'), before.storagePath);
      assert.deepEqual((await templateRef(scope.clientId, old).get()).data(), before);
      assert.deepEqual((await templateRef(scope.clientId, old).collection('categories').get()).docs.map((d: any) => d.data()), categories);
      assert.deepEqual((await draftRef.get()).data(), legacy);
      assert.equal((await product(scope)).marketplaces.shein.templateId, replacement);
      for (const [path, bytes] of originals) assert.deepEqual((await bucket.file(path).download())[0], bytes, path);
    });
  } finally {
    // Only data owned by this named emulator database is removed.
    for (const client of (await db.collection('clients').get()).docs) {
      for (const file of [...(await bucket.getFiles({ prefix: `client_spreadsheets/${client.id}/` }))[0], ...(await bucket.getFiles({ prefix: `client_spreadsheet_exports/${client.id}/` }))[0]]) {
        if (file) await file.delete({ ignoreNotFound: true });
      }
    }
    await cleanupEmulatorDatabase(db); await app.delete();
  }
});
