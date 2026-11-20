import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-organizer-link';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const local = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
  .every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('SINCOD → nueva fila → vínculo humano → fusión, fotos, ficha y exportación (Firebase demo)', { skip: !local }, async t => {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('./lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { defaultConfig } = require('./lib/functions/src/organizer/store.js');
  const { parseTab, productVariant } = require('./lib/functions/src/organizer/catalog.js');
  const { executeOrganizer } = require('./lib/functions/src/organizer/api.js');
  const { readCatalogAlerts } = require('./lib/functions/src/organizer/catalogAlerts.js');
  const { readLinkCandidates, previewCommercialLink, confirmCommercialLink } = require('./lib/functions/src/organizer/link.js');
  const { organizerDraftProduct } = require('./lib/functions/src/catalog/organizerBinding.js');
  const { syncCatalogSource, projectCatalogPhoto } = require('./lib/functions/src/catalog/triggers.js');
  const { jobMasterProductId } = require('./lib/functions/src/spreadsheets/masterProducts.js');
  const { loadExportContext, previewExportContext, splitBlockedProducts, validateTemplateCoordinates, downloadMarketplaceExport } = require('./lib/functions/src/spreadsheets/marketplaceExportService.js');
  const { MARKETPLACE_ADAPTERS } = require('./lib/shared/src/marketplaceExport/adapters.js');
  const clientId = 'sincod-client'; const uid = 'sincod-admin'; const root = db.doc(`organizers/${clientId}`);
  const actor = { uid, role: 'admin' };
  const call = (data: any) => executeOrganizer({ clientId, ...data }, actor);
  const refs = [{ id: 'front', version: '1' }, { id: 'back', version: '1' }];
  const scope = { clientId, batchIds: ['batch'] };
  const setRow = async (id: string, code: string) => {
    const rows = parseTab({ id: 'excel', name: 'JISHOP.xlsx' }, 'Ropa', null, [
      ['Código base', 'SKC', 'SKU', 'Nombre', 'Descripción', 'Categoría', 'Color', 'Talla', 'Pack', 'Precio', 'Stock', 'Peso (g)', 'Largo (cm)', 'Ancho (cm)', 'Alto (cm)'],
      [code, `${code}-AZ`, `${code}-S`, 'Buzo tiedye', 'Buzo de algodón', 'Buzos', 'Azul', 'S', '1', '149.5', '0', '325', '30', '20', '5'],
    ]).rows.map((row: any) => ({ ...row, sourceVersion: 'excel-v2' }));
    const variant = productVariant(id, rows);
    await root.collection('products').doc(id).set(variant);
    for (const row of rows) await root.collection('products').doc(id).collection('provenance').doc(String(row.line)).set(row);
    return variant;
  };
  try {
    await db.doc(`users/${uid}`).set({ uid, role: 'admin', active: true });
    await db.doc(`clients/${clientId}`).set({ name: 'JISHOP', status: 'active', marketplaces: { amazon: { enabled: true } } });
    await root.set(defaultConfig(clientId, 'JISHOP', { sourceIds: ['origin'], parentId: 'destination', operatorUids: [uid], enabled: false,
      budgetUsd: 1, model: 'gemini-3.1-flash-lite', minimumConfidence: .75, debounceMinutes: 10, controlSheet: false, maxCalls: 20 }));
    await setRow('occupied', 'JST-OLD');
    await root.collection('photos').doc('known').set({ name: 'JST-OLD_FRENTE.jpg', path: ['Origen', 'old'], variantId: 'occupied', variantIds: ['occupied'], reviewedBy: uid, issue: null });
    for (const [index, photo] of refs.entries()) {
      const name = `SINCOD_BUZO-TIEDYE_${index ? 'ESPALDA' : 'FRENTE'}_01.jpg`;
      await root.collection('photos').doc(photo.id).set({ ...photo, name, path: ['Origen', name], variantId: null, variantIds: [], baseId: null, reviewedBy: null, candidates: [], identityState: 'unresolved', method: 'sin_codigo', issue: 'Sin ficha comercial', view: index ? 'back' : 'front' });
      await root.collection('sourceFiles').doc(photo.id).set({ entry: { id: photo.id, name, parents: ['folder'], sourceId: 'origin', path: ['Origen', name], mimeType: 'image/jpeg', version: '1' } });
    }
    await db.doc('automationJobs/auto').set({ clientId, organizerCommerce: true, items: [] });
    await db.doc('automationJobs/auto/organizerCommerce/item').set({ itemId: 'item', photos: refs, organizerVariantId: null, source: { variants: [], values: {}, origins: {}, issue: 'Sin ficha comercial' } });
    const batch = { id: 'batch', clientId, automationJobId: 'auto', productScenes: [] };
    await db.doc('batches/batch').set(batch);
    for (const id of ['job-front', 'job-back']) await db.doc(`jobs/${id}`).set({ clientId, batchId: 'batch', garmentId: 'item', garmentName: 'SINCOD_BUZO-TIEDYE_FRENTE_01.jpg',
      status: 'completed', productScene: 'clean', currentOutput: { id: `${id}-output`, resultImagePath: `generated/${clientId}/batch/${id}/out.jpg`, autoReview: { verdict: 'approved', summary: 'Aprobada' } } });
    await syncCatalogSource('job', 'job-front');
    await projectCatalogPhoto('job-front');
    await projectCatalogPhoto('job-back');
    const originalJob = (await db.doc('jobs/job-front').get()).data();
    const legacyId = jobMasterProductId(batch, originalJob);
    const sourceRef = db.doc(`clients/${clientId}/products/${legacyId}`);
    const source = (await sourceRef.get()).data();
    await sourceRef.update({ 'catalog.selectedImages': [{ linkId: 'link', jobId: 'job-front', outputId: 'job-front-output' }] });
    const { MARKETPLACE_IMAGE_PROFILE_VERSION } = require('./lib/functions/src/media/prepareMarketplaceImage.js');
    const image = { jobId: 'job-front', outputId: 'job-front-output', storagePath: `generated/${clientId}/batch/job-front/out.jpg` };
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const publicPath = `images/${hash(clientId)}/${hash(JSON.stringify([clientId, legacyId, image.jobId, image.outputId, image.storagePath, 'amazon', MARKETPLACE_IMAGE_PROFILE_VERSION]))}/${hash('published-bytes')}.jpg`;
    const publication = { outputId: image.outputId, jobId: image.jobId, sourceStoragePath: image.storagePath, marketplaceId: 'amazon', profileVersion: MARKETPLACE_IMAGE_PROFILE_VERSION,
      bucket: 'demo-manglar-automation-marketplace-images', storagePath: publicPath, url: `https://storage.googleapis.com/demo-manglar-automation-marketplace-images/${publicPath}`,
      contentType: 'image/jpeg', width: 900, height: 1200, bytes: 1000, publishedAt: 1, publishedByUid: uid };
    await sourceRef.collection('marketplaceImages').doc('amazon').set({ images: { [image.outputId]: publication } });
    const publicationBefore = (await sourceRef.collection('marketplaceImages').doc('amazon').get()).data();
    await t.test('sin filas libres: error visible y organizer_identity bloqueante; skip lo reporta', async () => {
      const candidates = await call({ action: 'linkCandidates', photoId: 'front' });
      assert.equal(candidates.severity, 'error'); assert.match(candidates.message, /Agrega una fila al Excel/);
      assert.deepEqual(candidates.photoIds, ['back', 'front']);
      const alerts = await readCatalogAlerts(clientId, 'batch', uid);
      assert.equal(alerts.alerts.filter((alert: any) => alert.link).length, 1);
      const context = await loadExportContext(scope, uid); const preview = previewExportContext(context);
      assert.ok(preview.channels[0].issues.some((issue: any) => issue.code === 'organizer_identity'));
      const split = splitBlockedProducts(context, preview.channels[0], true);
      assert.equal(split.skipped.length, 1); assert.equal(split.context, null);
      const download = await downloadMarketplaceExport({ ...scope, marketplaceIds: ['amazon'], requestId: 'skip-all', skipBlockedProducts: true }, uid);
      assert.equal(download.downloadUrl, null); assert.equal(download.skippedProducts.length, 1);
      assert.ok(download.skippedProducts[0].reasons.some((reason: string) => /Sin ficha comercial/.test(reason)));
      await assert.rejects(call({ action: 'correct', photoId: 'front', variantId: 'occupied' }), /previewLink/);
    });
    await setRow('new-row', 'JST-NEW');
    await t.test('fila nueva: warning y candidata; nunca se asocia automáticamente', async () => {
      const candidates = await readLinkCandidates(clientId, 'back');
      assert.equal(candidates.severity, 'warning'); assert.equal(candidates.candidates[0].variantId, 'new-row');
      assert.equal((await root.collection('photos').doc('front').get()).get('variantId'), null);
      const alerts = await readCatalogAlerts(clientId, 'batch', uid);
      assert.equal(alerts.alerts.find((alert: any) => alert.link).severity, 'warning');
    });
    await t.test('previsualización caducada: no aplica ningún cambio', async () => {
      const preview = await call({ action: 'previewLink', photoId: 'front', variantId: 'new-row' });
      await sourceRef.update({ revision: source.revision + 1 });
      await assert.rejects(call({ action: 'link', photoId: 'front', variantId: 'new-row', previewToken: preview.previewToken, requestId: 'stale' }), /Cambió/);
      assert.equal((await root.collection('photos').doc('front').get()).get('variantId'), null);
    });
    const preliminary = await previewCommercialLink(clientId, 'front', 'new-row');
    const existing = organizerDraftProduct(clientId, 'JST-NEW', 'base-new', preliminary.values);
    existing.values.name = 'Título revisado'; existing.catalog.evidence.name = { source: 'manual', original: 'Título revisado', normalized: 'Título revisado', confidence: 1 };
    await db.doc(`clients/${clientId}/products/existing-master`).set(existing);
    const preview = await previewCommercialLink(clientId, 'front', 'new-row');
    assert.equal(preview.productId, 'existing-master');
    await assert.rejects(call({ action: 'link', photoId: 'front', variantId: 'new-row', previewToken: preview.previewToken, requestId: 'unresolved-conflict' }), /Resuelve/);
    const resolutions = { 'values.name': 'excel' };
    const result = await call({ action: 'link', photoId: 'front', variantId: 'new-row', previewToken: preview.previewToken, requestId: 'human-link', resolutions });
    await t.test('confirmación fusiona y conserva imágenes, revisión y publicaciones; reintento idempotente', async () => {
      assert.equal(result.state, 'linked');
      assert.deepEqual(await confirmCommercialLink(clientId, 'front', 'new-row', preview.previewToken, 'human-link', uid, resolutions), result);
      assert.equal((await root.collection('photos').doc('back').get()).get('variantId'), 'new-row');
      assert.equal((await sourceRef.get()).get('catalog.redirectTo'), result.productId);
      assert.deepEqual((await db.doc('jobs/job-front').get()).data(), originalJob);
      assert.deepEqual((await sourceRef.collection('marketplaceImages').doc('amazon').get()).data(), publicationBefore);
      const target = (await db.doc(`clients/${clientId}/products/${result.productId}`).get()).data();
      assert.equal(target.values.name, 'Buzo tiedye'); assert.equal(target.values.description, 'Buzo de algodón');
      assert.equal(target.variants[0].values.inventory, '0'); assert.equal(target.variants[0].values.weight, '325');
      assert.equal(target.catalog.selectedImages[0].outputId, 'job-front-output');
      assert.equal(target.catalog.photos.filter((photo: any) => photo.approved).length, 2);
      assert.equal((await readLinkCandidates(clientId, 'front')).state, 'linked');
      assert.ok(!(await readCatalogAlerts(clientId, 'batch', uid)).alerts.some((alert: any) => alert.link));
    });
    await t.test('exportación usa la ficha enriquecida, SKU y fotos originales; sin organizer_identity', async () => {
      const context = await loadExportContext(scope, uid); const product = context.products[0];
      assert.equal(product.canonicalProductId, result.productId);
      assert.equal(product.variants[0].values.sku, 'JST-NEW-S');
      assert.equal(product.values.name, 'Buzo tiedye');
      assert.equal(product.approvedImages.length, 2);
      assert.equal(product.publishedImages.amazon['job-front-output'].url, publication.url);
      assert.ok(!previewExportContext(context).channels[0].issues.some((issue: any) => issue.code === 'organizer_identity'));
      // The same adapter used by the actual XLSX download receives every source commercial field.
      const fields = { sku: 'variant.sku', name: 'product.name', description: 'product.description', category: 'product.category', color: 'variant.color', size: 'variant.size', pack: 'variant.pack', price: 'variant.price', stock: 'variant.inventory', weight: 'variant.weight', length: 'variant.length', width: 'variant.width', height: 'variant.height', image: 'image.0' };
      const columns = Object.keys(fields).map((key, index) => ({ key, label: key, index, letter: String.fromCharCode(65 + index), required: true, guidance: null, validation: null }));
      const category = { id: 'buzos', templateId: 'template', sheetName: 'Buzos', columns, attributes: [], rowStart: 2 };
      const template = { id: 'template', name: 'Amazon', clientId, storagePath: `client_spreadsheets/${clientId}/template.xlsx`, categoryIds: ['buzos'], exportConfig: { marketplaceId: 'amazon', operation: 'listing', validationStatus: 'compatible', mappings: { buzos: Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, { source }])) } } };
      product.marketplaces.amazon = { templateId: 'template', categoryId: 'buzos', imageUrls: Object.fromEntries(product.approvedImages.map((image: any) => [image.outputId, `https://existing.invalid/${image.outputId}.jpg`])) };
      const prepared = MARKETPLACE_ADAPTERS.amazon.prepare(product, template, category);
      const serialized = JSON.stringify(prepared);
      for (const value of ['JST-NEW-S', 'Buzo tiedye', '149.5', '325', '30', '20']) assert.ok(serialized.includes(value), `${value} missing from export`);
      assert.deepEqual(prepared.issues, []);
      const XLSX = require('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([Object.keys(fields), Object.keys(fields).map(() => '')]), 'Buzos');
      const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await admin.storage().bucket().file(template.storagePath).save(bytes);
      Object.assign(template, { templateFingerprint: createHash('sha256').update(bytes).digest('hex') });
      context.templates = [template]; context.categories = [category];
      const { plans } = await validateTemplateCoordinates(context, 'amazon');
      const { patchWorkbookCells } = require('./lib/functions/src/spreadsheets/ooxmlWorkbook.js');
      const exported = XLSX.read(await patchWorkbookCells(plans[0].buffer, plans[0].patches), { type: 'buffer' });
      const values = XLSX.utils.sheet_to_json(exported.Sheets.Buzos, { header: 1 });
      assert.deepEqual(values[1].slice(0, 13), ['JST-NEW-S', 'Buzo tiedye', 'Buzo de algodón', 'Buzos', 'Azul', 'S', '1', '149.5', '0', '325', '30', '20', '5']);
    });
    await t.test('el destino ocupado no se ofrece a otro grupo', async () => {
      await root.collection('photos').doc('other').set({ id: 'other', name: 'SINCOD_OTRO_FRENTE_01.jpg', path: ['Origen', 'other.jpg'], variantId: null });
      assert.equal((await readLinkCandidates(clientId, 'other')).candidates.length, 0);
      await assert.rejects(previewCommercialLink(clientId, 'other', 'new-row'), /ya no está libre/);
    });
    await t.test('dos confirmaciones concurrentes no pueden apropiarse de una fila libre', async () => {
      await setRow('race-row', 'JST-RACE');
      for (const id of ['race-a', 'race-b']) {
        const name = `SINCOD_${id}_FRENTE_01.jpg`;
        await root.collection('photos').doc(id).set({ id, name, path: ['Origen', name], version: '1', variantId: null });
        await root.collection('sourceFiles').doc(id).set({ entry: { id, name, path: ['Origen', name], parents: ['folder'], sourceId: 'origin', version: '1', mimeType: 'image/jpeg' } });
      }
      const previews = await Promise.all(['race-a', 'race-b'].map(id => previewCommercialLink(clientId, id, 'race-row')));
      const outcomes = await Promise.allSettled(previews.map((p, i) => confirmCommercialLink(clientId, i ? 'race-b' : 'race-a', 'race-row', p.previewToken, `race-${i}`, uid)));
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
    });
    await t.test('la API rechaza al operador sin acceso al cliente', async () => {
      await db.doc('users/outsider').set({ uid: 'outsider', role: 'operador', active: true, clientIds: [] });
      await assert.rejects(executeOrganizer({ action: 'linkCandidates', clientId, photoId: 'front' }, { uid: 'outsider', role: 'operador' }), /permiso|acceso|asignado|alcance/i);
    });
  } finally { await cleanupEmulatorDatabase(db); await app.delete(); }
});
