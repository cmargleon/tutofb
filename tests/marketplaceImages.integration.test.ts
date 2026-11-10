import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-marketplace-images';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('approved photo publication, stable direct URLs, automatic Excel links, isolation and retention (local Firebase)', { skip: !enabled }, async t => {
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket();
  const { marketplaceImageBucketName, marketplaceImageClientPrefix } = require('../functions/lib/functions/src/spreadsheets/marketplaceImages.js');
  const publishedBucket = admin.storage().bucket(marketplaceImageBucketName());
  const { publishMarketplaceImages } = require('../functions/lib/functions/src/callables/publishMarketplaceImages.js');
  const { previewMarketplaceExports, saveMasterProduct, downloadMarketplaceExports } = require('../functions/lib/functions/src/callables/marketplaceExports.js');
  const { permanentlyDeleteClient } = require('../functions/lib/functions/src/callables/permanentlyDeleteClient.js');
  const sharp = require('../functions/node_modules/sharp');
  const XLSX = require('../functions/node_modules/xlsx');
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://local-download.invalid/export']);
  const clientId = 'publication-client'; const batchId = 'publication-batch'; const uid = 'publication-admin'; const jobId = 'publication-job';
  const channels = ['shein', 'amazon', 'mercado-libre', 'tiktok-shop'];
  const scope = { clientId, batchIds: [batchId] };
  const req = (data: any, caller = uid) => ({ data, auth: { uid: caller, token: {} } });
  const path = `generated/${clientId}/${batchId}/${jobId}/out.png`;
  const source = await sharp({ create: { width: 900, height: 1200, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 0.5 } } }).png().toBuffer();
  const clientRef = db.doc(`clients/${clientId}`); const jobRef = db.doc(`jobs/${jobId}`);
  try {
    await db.doc(`users/${uid}`).set({ uid, role: 'admin', active: true });
    await db.doc('users/limited').set({ uid: 'limited', role: 'operador', active: true, clientAccess: { mode: 'assigned', clientIds: ['other'] } });
    await clientRef.set({ name: 'Image publication QA', status: 'active', marketplaces: Object.fromEntries(channels.map(id => [id, { enabled: true }])) });
    await db.doc(`batches/${batchId}`).set({ clientId, status: 'completed', generationKind: 'product' });
    await jobRef.set({ clientId, batchId, garmentId: 'g', garmentName: 'Product', status: 'completed', currentOutput: { id: 'out', resultImagePath: path, autoReview: { verdict: 'approved' } } });
    await bucket.file(path).save(source, { contentType: 'image/png' });
    let p = (await previewMarketplaceExports.run(req(scope))).products[0];
    const input = { ...scope, productId: p.id, marketplaceId: 'shein', authorizePublicImages: true };
    const registry = clientRef.collection('products').doc(p.id).collection('marketplaceImages');
    assert.equal((await registry.get()).size, 0);
    await assert.rejects(publishMarketplaceImages.run({ data: input }), { code: 'unauthenticated' });
    await assert.rejects(publishMarketplaceImages.run(req({ ...input, authorizePublicImages: false })), { code: 'invalid-argument' });
    await assert.rejects(publishMarketplaceImages.run(req(input, 'limited')), { code: 'permission-denied' });
    await assert.rejects(publishMarketplaceImages.run(req({ ...input, productId: 'other-product' })), { code: 'not-found' });
    await clientRef.update({ 'marketplaces.shein.enabled': false });
    await assert.rejects(publishMarketplaceImages.run(req(input)), { code: 'permission-denied' });
    await clientRef.update({ 'marketplaces.shein.enabled': true });
    assert.equal((await publishedBucket.getFiles({ prefix: marketplaceImageClientPrefix(clientId) }))[0].length, 0);

    const first = await publishMarketplaceImages.run(req(input));
    assert.deepEqual(first.failures, []); assert.equal(first.images.length, 1);
    const image = first.images[0];
    assert.equal(image.width, image.height); assert.equal(image.contentType, 'image/jpeg'); assert.ok(image.bytes < 3_000_000);
    assert.equal(image.url, `https://storage.googleapis.com/${publishedBucket.name}/${image.storagePath}`);
    assert.equal(new URL(image.url).search, ''); assert.ok(image.url.endsWith('.jpg'));
    assert.deepEqual((await bucket.file(path).download())[0], source);
    const [metadata] = await publishedBucket.file(image.storagePath).getMetadata();
    assert.equal(metadata.contentType, 'image/jpeg'); assert.match(metadata.cacheControl, /^public,/);
    const second = await publishMarketplaceImages.run(req(input)); assert.equal(second.images[0].url, image.url);
    assert.equal((await publishedBucket.getFiles({ prefix: marketplaceImageClientPrefix(clientId) }))[0].length, 1);
    // Opening a preview is read-only and does not create a master-product document.
    p = (await previewMarketplaceExports.run(req(scope))).products[0];
    assert.equal(p.publishedImages.shein.out.url, image.url);
    assert.equal((await clientRef.collection('products').doc(p.id).get()).exists, false);

    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['sku', 'main_img'], ['', '']]), 'Products');
    const workbook = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const templatePath = `client_spreadsheets/${clientId}/template/template.xlsx`;
    await bucket.file(templatePath).save(workbook);
    const templateRef = clientRef.collection('spreadsheetTemplates').doc('template');
    await templateRef.set({ clientId, name: 'Publication QA', status: 'active', storagePath: templatePath, categoryIds: ['products'], templateFingerprint: createHash('sha256').update(workbook).digest('hex'), exportConfig: { marketplaceId: 'shein', version: 1, operation: 'listing', validationStatus: 'compatible', mappings: { products: { sku: { source: 'variant.sku' }, main_img: { source: 'image.0', required: true } } } } });
    await templateRef.collection('categories').doc('products').set({ clientId, templateId: 'template', sheetName: 'Products', rowStart: 2, attributes: [], columns: [{ key: 'sku', label: 'SKU', index: 0, letter: 'A', required: true }, { key: 'main_img', label: 'Main image', index: 1, letter: 'B', required: true }] });
    const save = (marketplaces: any, revision = p.revision) => saveMasterProduct.run(req({ ...scope, productId: p.id, expectedRevision: revision, authorizePublicImages: true, values: { name: 'Product' }, variants: [{ id: 'v', values: { sku: 'IMG-001' } }], marketplaces }));
    // Links are resolved automatically even when the operator saves only template/category.
    await save({ shein: { templateId: 'template', categoryId: 'products' } });
    let preview = await previewMarketplaceExports.run(req(scope)); p = preview.products[0];
    assert.equal(p.marketplaces.shein.imageUrls.out, image.url);
    assert.equal(preview.channels.find((channel: any) => channel.marketplaceId === 'shein').ready, true);
    const exported = await downloadMarketplaceExports.run(req({ ...scope, marketplaceIds: ['shein'], requestId: randomUUID() }));
    assert.deepEqual(exported.failures, []);
    const artifact = (await db.collection('marketplaceExportRequests').get()).docs[0].get('artifactPath');
    const excel = XLSX.read((await bucket.file(artifact).download())[0], { type: 'buffer' });
    assert.equal(excel.Sheets.Products.B2.v, image.url);
    const foreignUrl = image.url.replace(publishedBucket.name, 'foreign-marketplace-images');
    await assert.rejects(save({ shein: { templateId: 'template', categoryId: 'products', imageUrls: { out: foreignUrl } } }), { code: 'invalid-argument' });
    await save({ shein: { templateId: 'template', categoryId: 'products', imageUrls: { out: 'https://images.example.com/authorized.jpg' } } });
    p = (await previewMarketplaceExports.run(req(scope))).products[0]; assert.equal(p.marketplaces.shein.imageUrls.out, 'https://images.example.com/authorized.jpg');
    await jobRef.update({ manuallyFlagged: true });
    preview = await previewMarketplaceExports.run(req(scope)); assert.equal(preview.products[0].publishedImages?.shein?.out, undefined);
    assert.equal(preview.channels.find((channel: any) => channel.marketplaceId === 'shein').ready, false);
    await assert.rejects(publishMarketplaceImages.run(req(input)), { code: 'failed-precondition' });
    // Previously exported publications survive later rejection and source retention cleanup.
    assert.equal((await publishedBucket.file(image.storagePath).exists())[0], true);
    await jobRef.update({ manuallyFlagged: false });
    for (const marketplaceId of channels.slice(1)) {
      const result = await publishMarketplaceImages.run(req({ ...input, marketplaceId }));
      assert.equal(result.failures.length, 0); assert.equal(result.images[0].width / result.images[0].height, 3 / 4);
    }
    await bucket.file(path).delete();
    assert.equal((await publishMarketplaceImages.run(req(input))).images[0].url, image.url);
    // A stale path from another job cannot be published even if a malformed historical document claims approval.
    await jobRef.update({ 'currentOutput.resultImagePath': `generated/${clientId}/${batchId}/foreign/out.jpg` });
    const rejected = await publishMarketplaceImages.run(req(input)); assert.equal(rejected.images.length, 0); assert.equal(rejected.failures.length, 1);
    await jobRef.update({ 'currentOutput.resultImagePath': path });
    // Permanent client deletion removes only this client's public copies; archival alone does not.
    await clientRef.update({ status: 'archived' });
    assert.equal((await publishedBucket.file(image.storagePath).exists())[0], true);
    await publishedBucket.file(`images/${'f'.repeat(64)}/other-client.jpg`).save(Buffer.from('other client'));
    await permanentlyDeleteClient.run(req({ id: clientId }));
    assert.equal((await publishedBucket.getFiles({ prefix: marketplaceImageClientPrefix(clientId) }))[0].length, 0);
    assert.equal((await publishedBucket.file(`images/${'f'.repeat(64)}/other-client.jpg`).exists())[0], true);
  } finally {
    await bucket.deleteFiles({ prefix: `generated/${clientId}/`, force: true });
    await bucket.deleteFiles({ prefix: `client_spreadsheets/${clientId}/`, force: true });
    await bucket.deleteFiles({ prefix: `client_spreadsheet_exports/${clientId}/`, force: true });
    await publishedBucket.deleteFiles({ force: true });
    await cleanupEmulatorDatabase(db); await app.delete();
  }
});
