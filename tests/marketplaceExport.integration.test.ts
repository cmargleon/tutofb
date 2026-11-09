import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-marketplace-export';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));
test('multichannel export, immutable versions, lazy migration, isolation, concurrency, failures and temporary cleanup (local Firebase)', { skip: !enabled }, async t => {
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket(); const files: string[] = [];
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://local-download.invalid/export']);
  const XLSX = require('../functions/node_modules/xlsx'); const JSZip = require('../functions/node_modules/jszip');
  const handlers = require('../functions/lib/functions/src/callables/marketplaceExports.js');
  const { importClientSpreadsheetTemplate } = require('../functions/lib/functions/src/callables/importClientSpreadsheetTemplate.js');
  const { cleanupMarketplaceExports } = require('../functions/lib/functions/src/spreadsheets/cleanupMarketplaceExports.js');
  const uid = 'market-export-admin'; const limitedUid = 'market-export-limited'; const clientId = 'market-export-c'; const batchId = 'market-export-b';
  const channels = ['shein', 'mercado-libre', 'tiktok-shop', 'amazon'];
  const auth = { uid, token: {} }; const scope = { clientId, batchIds: [batchId] };
  const request = (data: any, identity = auth) => ({ auth: identity, data });
  try {
    await db.collection('users').doc(uid).set({ uid, role: 'admin', active: true });
    await db.collection('users').doc(limitedUid).set({ uid: limitedUid, role: 'operador', active: true, clientAccess: { mode: 'assigned', clientIds: ['other'] } });
    await db.collection('clients').doc(clientId).set({ name: 'Export QA', status: 'active', marketplaces: Object.fromEntries(channels.map(c => [c, { enabled: true }])) });
    await db.collection('clients').doc('other').set({ name: 'Other', status: 'active' });
    await db.collection('batches').doc(batchId).set({ clientId, status: 'completed', generationKind: 'product' });
    await db.collection('batches').doc('other-batch').set({ clientId: 'other', status: 'completed' });
    const job = db.collection('jobs').doc('market-export-job');
    await job.set({ clientId, batchId, garmentId: 'g', garmentName: 'Product', status: 'completed', currentOutput: { id: 'out', resultImagePath: `generated/${clientId}/${batchId}/job/out.jpg`, autoReview: { verdict: 'approved' } } });
    const templates: Record<string, string> = {};
    for (const channel of channels) {
      // Synthetic transport fixture: never counted as an official verified integration.
      const wb = XLSX.utils.book_new();
      const keys = channel === 'shein' ? ['supplier_code', 'sku_code', 'goods_name'] : channel === 'amazon' ? ['item_sku', 'item_name', 'quantity'] : channel === 'tiktok-shop' ? ['seller_sku', 'product_name', 'quantity'] : ['seller_sku', 'title', 'available_quantity'];
      for (const sheet of ['Tops', 'Shoes']) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(channel === 'shein' ? [['SHEIN'], ['SPU', 'SKU', 'Nombre'], keys, ['Opcional', 'Requerido', 'Requerido'], [''], [''], ['', '', '']] : [keys, ['', '', '']]), sheet);
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const path = `client_spreadsheets/${clientId}/upload-${channel}/template.xlsx`; files.push(path); await bucket.file(path).save(buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const imported = await importClientSpreadsheetTemplate.run(request({ clientId, storagePath: path, originalFileName: 'template.xlsx', marketplaceId: channel }));
      const ref = db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(imported.templateId);
      const draftTemplate = (await ref.get()).data(); files.push(draftTemplate.storagePath);
      assert.equal(draftTemplate.exportConfig.validationStatus, 'needs_configuration');
      const cs = await ref.collection('categories').get(); assert.equal(cs.size, 2);
      const activated = await handlers.configureMarketplaceTemplate.run(request({ clientId, templateId: ref.id, marketplaceId: channel, operation: 'listing', mappings: draftTemplate.exportConfig.mappings }));
      templates[channel] = activated.templateId;
      const active = await ref.parent.doc(activated.templateId).get(); files.push(active.get('storagePath'));
      assert.equal(active.get('exportConfig.validationStatus'), 'compatible'); assert.equal(activated.templateId, ref.id); assert.equal((await ref.get()).get('status'), 'active'); assert.equal(active.get('exportConfig.version'), 1);
      assert.deepEqual((await bucket.file(path).download())[0], buffer);
      assert.deepEqual((await bucket.file(active.get('storagePath')).download())[0], buffer);
    }
    const initial = await handlers.previewMarketplaceExports.run(request(scope));
    assert.equal(initial.products.length, 1); assert.equal(initial.products[0].legacyDrafts.length, 0);
    assert.ok(initial.channels.every((c: any) => !c.ready));
    assert.equal((await db.collection('marketplaceExportRequests').get()).size, 0);
    assert.equal((await bucket.getFiles({ prefix: `client_spreadsheet_exports/${clientId}/` }))[0].length, 0);
    const p = initial.products[0];
    await handlers.saveMasterProduct.run(request({ ...scope, productId: p.id, expectedRevision: 0, values: { name: 'Verified product' }, variants: [{ id: 'red-s', values: { sku: '00123', color: 'Rojo', size: 'S', inventory: '2' } }, { id: 'blue-m', values: { sku: '00124', color: 'Azul', size: 'M', inventory: '3' } }], marketplaces: Object.fromEntries(channels.map(c => [c, { templateId: templates[c], categoryId: 'tops' }])) }));
    const ready = await handlers.previewMarketplaceExports.run(request(scope)); assert.ok(ready.channels.every((c: any) => c.ready));
    assert.equal((await db.collection('marketplaceExportRequests').get()).size, 0);
    const beforeJobs = await db.collection('jobs').get();
    const singleInput = { ...scope, marketplaceIds: ['shein'], requestId: randomUUID() };
    const single = await handlers.downloadMarketplaceExports.run(request(singleInput)); assert.match(single.fileName, /\.xlsx$/); assert.equal(single.failures.length, 0);
    const singleDoc = (await db.collection('marketplaceExportRequests').get()).docs[0]; files.push(singleDoc.get('artifactPath'));
    const singleBuffer = (await bucket.file(singleDoc.get('artifactPath')).download())[0];
    const resultWb = XLSX.read(singleBuffer, { type: 'buffer' }); assert.equal(resultWb.Sheets.Tops.B7.v, '00123'); assert.equal(resultWb.Sheets.Tops.B8.v, '00124'); assert.equal(resultWb.Sheets.Tops.B7.t, 's');
    assert.deepEqual(await handlers.downloadMarketplaceExports.run(request(singleInput)), single);
    const zipInput = { ...scope, marketplaceIds: channels, requestId: randomUUID() };
    const simultaneous = await Promise.allSettled([handlers.downloadMarketplaceExports.run(request(zipInput)), handlers.downloadMarketplaceExports.run(request(zipInput))]);
    const ok = simultaneous.filter((r: any) => r.status === 'fulfilled'); assert.ok(ok.length >= 1);
    const zipResponse = (ok[0] as any).value; assert.match(zipResponse.fileName, /\.zip$/); assert.equal(zipResponse.exportedMarketplaces.length, 4);
    const artifacts = await db.collection('marketplaceExportRequests').get(); assert.equal(artifacts.size, 2);
    const zipDoc = artifacts.docs.find((d: any) => d.get('result.fileName') === zipResponse.fileName); files.push(zipDoc.get('artifactPath'));
    const outputZip = await JSZip.loadAsync((await bucket.file(zipDoc.get('artifactPath')).download())[0]); assert.equal(Object.values(outputZip.files).filter((f: any) => !f.dir).length, 4);
    assert.equal((await db.collection('jobs').get()).size, beforeJobs.size);
    for (const count of [2, 3]) {
      const response = await handlers.downloadMarketplaceExports.run(request({ ...scope, marketplaceIds: channels.slice(0, count), requestId: randomUUID() }));
      assert.match(response.fileName, /\.zip$/); assert.equal(response.exportedMarketplaces.length, count);
    }
    // Additive association of a legacy template: old draft and original remain untouched.
    const oldPath = `client_spreadsheets/${clientId}/legacy-upload/legacy.xlsx`; files.push(oldPath);
    const oldWb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(oldWb, XLSX.utils.aoa_to_sheet([['SHEIN'], ['SPU', 'SKU', 'Nombre'], ['supplier_code', 'sku_code', 'goods_name'], ['Opcional', 'Requerido', 'Requerido'], [''], ['']]), 'Legacy');
    const oldBytes = XLSX.write(oldWb, { type: 'buffer', bookType: 'xlsx' }); await bucket.file(oldPath).save(oldBytes);
    const oldImport = await importClientSpreadsheetTemplate.run(request({ clientId, storagePath: oldPath, originalFileName: 'legacy.xlsx' }));
    const oldRef = db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(oldImport.templateId); files.push((await oldRef.get()).get('storagePath'));
    const association = await handlers.configureMarketplaceTemplate.run(request({ clientId, templateId: oldImport.templateId, marketplaceId: 'shein', operation: 'listing', mappings: { legacy: { supplier_code: { source: 'legacy.supplier_code' }, sku_code: { source: 'legacy.sku_code' }, goods_name: { source: 'legacy.goods_name' } } } }));
    files.push((await oldRef.parent.doc(association.templateId).get()).get('storagePath'));
    const legacyBatch = 'market-export-legacy-batch'; await db.collection('batches').doc(legacyBatch).set({ clientId, status: 'completed', spreadsheetTemplateId: oldImport.templateId });
    const legacyRows = [{ id: 'legacy-row', values: { sku_code: 'OLD-001', goods_name: 'Legacy product', custom: 'retain all source fields' } }];
    const legacyRef = db.collection('batches').doc(legacyBatch).collection('productDrafts').doc('legacy-draft');
    await legacyRef.set({ clientId, batchId: legacyBatch, garmentId: 'legacy-g', garmentName: 'Legacy', templateId: oldImport.templateId, categoryId: 'legacy', rows: legacyRows });
    await db.collection('jobs').doc('market-export-legacy-job').set({ clientId, batchId: legacyBatch, garmentId: 'legacy-g', garmentName: 'Legacy', status: 'completed', currentOutput: { id: 'legacy-out', resultImagePath: `generated/${clientId}/${legacyBatch}/j/out.jpg`, autoReview: { verdict: 'approved' } } });
    const mastersBefore = (await db.collection('clients').doc(clientId).collection('products').get()).size;
    const migrationPreview = await handlers.previewMarketplaceExports.run(request({ clientId, batchIds: [legacyBatch] }));
    assert.equal(migrationPreview.products[0].marketplaces.shein.templateId, association.templateId);
    assert.equal(migrationPreview.channels.find((c: any) => c.marketplaceId === 'shein').ready, true);
    assert.equal((await db.collection('clients').doc(clientId).collection('products').get()).size, mastersBefore);
    assert.deepEqual((await legacyRef.get()).get('rows'), legacyRows); assert.equal((await oldRef.get()).get('status'), 'active');
    const grouped = await handlers.downloadMarketplaceExports.run(request({ clientId, batchIds: [batchId, legacyBatch], marketplaceIds: ['shein'], requestId: randomUUID() }));
    assert.match(grouped.fileName, /\.zip$/); assert.deepEqual(grouped.exportedMarketplaces, ['shein']);
    const groupedDoc = (await db.collection('marketplaceExportRequests').get()).docs.find((doc: any) => doc.get('result.fileName') === grouped.fileName);
    const groupedZip = await JSZip.loadAsync((await bucket.file(groupedDoc.get('artifactPath')).download())[0]);
    assert.equal(Object.values(groupedZip.files).filter((file: any) => !file.dir).length, 2);


    await assert.rejects(() => handlers.previewMarketplaceExports.run(request(scope, { uid: limitedUid, token: { role: 'admin' } })), { code: 'permission-denied' });
    await assert.rejects(() => handlers.previewMarketplaceExports.run(request({ clientId, batchIds: ['other-batch'] })), { code: 'permission-denied' });
    await assert.rejects(() => handlers.configureMarketplaceTemplate.run(request({ clientId, templateId: templates.shein, marketplaceId: 'shein', operation: 'listing', mappings: {} }, { uid: limitedUid, token: {} })), { code: 'permission-denied' });
    await assert.rejects(() => handlers.downloadMarketplaceExports.run({ data: singleInput }), { code: 'unauthenticated' });
    await assert.rejects(() => handlers.saveMasterProduct.run(request({ ...scope, productId: p.id, expectedRevision: 0, values: {}, variants: [{ id: 'x', values: {} }], marketplaces: {} })), { code: 'aborted' });
    await job.update({ 'currentOutput.autoReview.verdict': 'rejected' });
    assert.ok((await handlers.previewMarketplaceExports.run(request(scope))).channels.every((c: any) => c.issues.some((i: any) => i.code === 'images_pending')));
    await job.update({ 'currentOutput.autoReview.verdict': 'approved' });
    await db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(templates.amazon).update({ status: 'archived' });
    const partial = await handlers.downloadMarketplaceExports.run(request({ ...scope, marketplaceIds: ['shein', 'amazon'], requestId: randomUUID() }));
    assert.equal(partial.failures[0].marketplaceId, 'amazon'); assert.deepEqual(partial.exportedMarketplaces, ['shein']); assert.match(partial.fileName, /\.xlsx$/);
    await db.collection('clients').doc(clientId).update({ status: 'archived' });
    await assert.rejects(() => handlers.previewMarketplaceExports.run(request(scope)), { code: 'failed-precondition' });
    await db.collection('clients').doc(clientId).update({ status: 'active', marketplaces: {} });
    assert.equal((await handlers.previewMarketplaceExports.run(request(scope))).channels.length, 0);
    for (const d of (await db.collection('marketplaceExportRequests').get()).docs) { if (d.get('artifactPath')) files.push(d.get('artifactPath')); await d.ref.update({ expiresAt: admin.firestore.Timestamp.fromMillis(0) }); }
    await cleanupMarketplaceExports(); assert.equal((await db.collection('marketplaceExportRequests').get()).size, 0);
    for (const f of files.filter(f => f.startsWith('client_spreadsheet_exports/'))) assert.equal((await bucket.file(f).exists())[0], false);
  } finally {
    await Promise.all(files.map(path => bucket.file(path).delete({ ignoreNotFound: true })));
    await cleanupEmulatorDatabase(db); await app.delete();
  }
});
