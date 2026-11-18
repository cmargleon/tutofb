import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';

process.env.FIRESTORE_DATABASE_ID = 'test-organizer-marketplace';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const local = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
  .every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('Organizer export preserves source identity, edits and the official Vaso workbook (Firebase demo)', { skip: !local }, async t => {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('./lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const { parseTab, productVariant } = require('./lib/functions/src/organizer/catalog.js');
  const { readOrganizerCommerce, organizerReferenceViews } = require('./lib/functions/src/organizer/commerce.js');
  const { inspectWorkbookPackage } = require('./lib/functions/src/spreadsheets/ooxmlWorkbook.js');
  const { analyzeMarketplaceTemplate } = require('./lib/functions/src/spreadsheets/marketplaceTemplates.js');
  const { parseSpreadsheetTemplateWorkbook } = require('./lib/functions/src/spreadsheets/templateWorkbook.js');
  const exports = require('./lib/functions/src/callables/marketplaceExports.js');
  const { publishMarketplaceImages } = require('./lib/functions/src/callables/publishMarketplaceImages.js');
  const XLSX = require('xlsx');
  const JSZip = require('jszip');
  const sharp = require('sharp');
  t.mock.method(require('@google-cloud/storage').File.prototype, 'getSignedUrl', async () => ['https://local-download.invalid/export']);
  const clientId = 'drive-catalog-qa';
  const uid = 'drive-catalog-qa-admin';
  const auth = { uid, token: {} };
  const client = db.doc(`clients/${clientId}`);
  const organizer = db.doc(`organizers/${clientId}`);
  const bucket = admin.storage().bucket();
  const publicBucket = admin.storage().bucket('demo-manglar-automation-marketplace-images');
  const request = (data: any) => ({ auth, data });
  const scope = { clientId, batchIds: ['object-batch'] };
  const publishScope = { ...scope, marketplaceId: 'shein', authorizePublicImages: true };
  const templatePath = `client_spreadsheets/${clientId}/vaso/original.xlsx`;
  const real = process.env.TUTO_JISHOP_VASO_TEMPLATE;
  const fixture = XLSX.utils.book_new();
  const keys = ['supplier_code', 'supplier_sku', 'goods_name', 'main_img', 'detail_img_1', 'stock', 'original_price', 'weight', 'weight_unit', 'main_attribute_value', 'attr_1000463', 'attr_1000411'];
  XLSX.utils.book_append_sheet(fixture, XLSX.utils.aoa_to_sheet([['SHEIN'], keys, keys,
    ['Requerido', 'opcional', 'Requerido'], [], []]), 'Vaso(1083-3218)');
  const bytes = real ? await readFile(real) : XLSX.write(fixture, { type: 'buffer', bookType: 'xlsx' });
  const jpg = async (color: string) => sharp({ create: { width: 900, height: 1200, channels: 3, background: color } }).jpeg().toBuffer();
  const refs = [{ id: 'object-reference', version: '1' }];
  const rows = (version: string, stock: number, names = ['Vaso de prueba', 'Vaso de prueba'], material = '') => {
    const grid = [['SKC', 'SKU', 'Nombre', 'Color', 'Talla', 'Stock', 'Precio de venta', 'Peso (g)', 'Materiales en contacto con alimentos', 'Marca'],
      ['QA-VASO', '00001', names[0], '', '300ml', String(stock), '149.5', '325', material, 'Marca declarada'],
      ['QA-VASO', '00002', names[1], '', '450ml', '', '154', '350', material, 'Marca declarada']];
    return parseTab({ id: 'drive-qa-source', name: 'Fuente QA.xlsm' }, 'HOGAR', null, grid).rows.map((row: any) => ({ ...row, sourceVersion: version }));
  };
  const writeRows = async (data: any[], variantId = 'object-visual') => {
    const ref = organizer.collection('products').doc(variantId);
    await ref.set(productVariant(variantId, data));
    await Promise.all(data.map(row => ref.collection('provenance').doc(String(row.line)).set(row)));
  };
  const writeScene = async (id: string, batchId: string, garmentId: string, scene: string, photoTask?: object) => {
    const path = `generated/${clientId}/${batchId}/${id}/out.jpg`;
    await bucket.file(path).save(await jpg(scene === 'clean' ? 'slategrey' : 'darkgrey'));
    await db.doc(`jobs/${id}`).set({ clientId, batchId, garmentId, garmentName: garmentId, status: 'completed',
      ...(photoTask ? { photoTask } : { productScene: scene, productReferencePaths: ['garments/reference.jpg'] }), currentOutput: { id: `${id}-output`, resultImagePath: path,
        autoReview: { verdict: 'approved', marketplaceData: { title: 'Título sugerido', description: 'Dice que es de acero', primaryColor: 'Rojo' } },
        ...(photoTask ? { photoValidation: { fidelity: true, destinations: [{ channel: 'shein', position: 1, passed: true }] } } : {}) } });
  };
  try {
    await db.doc(`users/${uid}`).set({ uid, role: 'admin', active: true });
    await client.set({ name: 'JISHOP – datos de prueba', status: 'active', marketplaces: { shein: { enabled: true } } });
    await bucket.file(templatePath).save(bytes);
    const parsed = parseSpreadsheetTemplateWorkbook({ buffer: bytes, clientId, clientNameSnapshot: 'QA', storagePath: templatePath, originalFileName: 'Vaso.xlsx', createdByUid: uid });
    const analyzed = await analyzeMarketplaceTemplate(bytes, 'shein', parsed.template, parsed.categories);
    assert.equal(analyzed.template.exportConfig.validationStatus, 'needs_configuration');
    const category = analyzed.categories[0];
    const mappings = analyzed.template.exportConfig.mappings[category.id];
    mappings.supplier_code = { source: 'variant.skc', required: true, dataType: 'text' };
    mappings.main_attribute_value = { source: 'variant.color', required: true };
    mappings.attr_1000463 = { source: 'attribute.foodContactMaterial', required: true };
    let exportedColor = 'Morado';
    if (real) {
      const specification = category.columns.find((column: any) => column.key === 'main_attribute');
      const dependent = category.columns.find((column: any) => column.key === 'main_attribute_value');
      const option = specification.dropdownOptions.find((value: string) => /color/i.test(value));
      exportedColor = dependent.dropdownDependency.optionsByValue[option].find((value: string) => /^morado$/i.test(value));
      assert.ok(option && exportedColor);
      mappings.main_attribute = { source: `literal.${option}`, required: true };
      mappings.secondary_attribute_1 = { source: 'literal.Talla(87)' };
    } else {
      category.columns.find((column: any) => column.key === 'main_attribute_value').dropdownOptions = ['Rojo', 'Morado'];
      category.columns.find((column: any) => column.key === 'attr_1000463').dropdownOptions = ['Vidrio', 'Acero inoxidable'];
      category.columns.find((column: any) => column.key === 'attr_1000411').dropdownOptions = ['1 pieza', '2 piezas'];
    }
    process.env.GEMINI_API_KEY = 'emulator-only';
    const originalFetch = globalThis.fetch;
    let geminiCalls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return originalFetch(url, init);
      geminiCalls++;
      const body = JSON.parse(String(init?.body));
      const { fields } = JSON.parse(body.contents[0].parts[0].text);
      const color = fields.find((field: { key: string }) => field.key === 'main_attribute_value');
      if (color) assert.ok(color.options.includes(exportedColor));
      const selected = color ? [{ key: color.key, value: exportedColor, source: 'visual', evidence: 'Se ve morado.', confidence: 0.99 }] : [];
      const quantity = fields.find((field: { key: string }) => field.key === 'attr_1000411');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([
        ...selected, { key: 'attr_1000463', value: 'Vidrio', source: 'estimate', evidence: 'La composición requiere verificación.', confidence: 0.4 },
        ...(quantity ? [{ key: quantity.key, value: quantity.options[0], source: 'estimate', evidence: 'Cantidad por verificar.', confidence: 0.4 }] : []),
      ]) }] } }] }), { status: 200 });
    });
    const templateRef = client.collection('spreadsheetTemplates').doc('vaso');
    const timestamp = admin.firestore.Timestamp.now();
    await templateRef.set({ ...parsed.template, createdAt: timestamp, updatedAt: timestamp });
    for (const c of analyzed.categories) await templateRef.collection('categories').doc(c.id).set({ ...c, templateId: 'vaso', createdAt: timestamp, updatedAt: timestamp });
    const activation = await exports.configureMarketplaceTemplate.run(request({ clientId, templateId: 'vaso', marketplaceId: 'shein', operation: 'listing', mappings: { [category.id]: mappings } }));
    const categoryDecision = { marketplaceId: 'shein', templateId: activation.templateId, categoryId: category.id, version: 1, confidence: 0.99, reason: 'Resultado simulado para el vaso de prueba.' };
    await organizer.collection('photos').doc(refs[0].id).set({ version: '1', variantId: 'object-visual', method: 'manual', reviewedBy: uid, issue: null });
    await writeRows(rows('1665', 0));
    const link = await readOrganizerCommerce(organizer, refs);
    assert.equal(link.source.variants[0].values.inventory, '0');
    assert.equal(link.source.variants[1].values.inventory, undefined);
    const matchingAnalysis = {
      usedGemini: true, garmentId: 'object-item', photos: [{ storagePath: 'garments/reference.jpg' }],
      photoAttributes: {
        color: { value: 'morado', confidence: 0.99, evidence: 'El vaso se ve morado.', source: 'gemini' },
        transparency: { value: false, confidence: 0.99, evidence: 'El cuerpo del vaso es opaco.', source: 'gemini' },
        packaging: { value: 'unit', confidence: 0.99, evidence: 'Se ve un vaso.', source: 'gemini' },
      },
    };
    await db.doc('automationJobs/object-intake').set({ clientId, analysisCache: {
      matching: matchingAnalysis,
      otherReference: { ...matchingAnalysis, photos: [{ storagePath: 'garments/other.jpg' }], photoAttributes: {
        color: { value: 'Rojo', confidence: 1, evidence: 'Se ve rojo.', source: 'gemini' },
      } },
    } });
    await db.doc('automationJobs/object-intake/organizerCommerce/object-item').set({ ...link, itemId: 'object-item', photos: refs, category: categoryDecision });
    await db.doc('batches/object-batch').set({ clientId, automationJobId: 'object-intake', poseIds: [], productScenes: [{ type: 'clean' }, { type: 'hero' }] });
    await writeScene('object-front', 'object-batch', 'object-item', 'clean');
    await writeScene('object-side', 'object-batch', 'object-item', 'hero');
    // First opening: the plain preview answers from cache only and reports the pending analysis.
    const opened = await exports.previewMarketplaceExports.run(request(scope));
    assert.equal(opened.autofillPending, true);
    assert.equal(geminiCalls, 0);
    // Two simultaneous openings share one Gemini analysis per variant and both receive its options.
    const [initial, concurrent] = await Promise.all([1, 2].map(() =>
      exports.previewMarketplaceExports.run(request({ ...scope, analyzeAutofill: true }))));
    assert.equal(geminiCalls, initial.products[0].variants.length);
    assert.deepEqual(concurrent.products[0].marketplaceAutofill, initial.products[0].marketplaceAutofill);
    assert.ok(!initial.autofillPending && !concurrent.autofillPending);
    const product = initial.products[0];
    assert.equal(product.variants.length, 2);
    assert.ok(product.variants.every((v: any) => v.values.color === 'morado' && v.attributes.transparency === 'No' && !v.values.pack));
    assert.equal(product.values.description, undefined);
    assert.equal(product.values.brand, 'Marca declarada');
    assert.ok(!initial.channels[0].issues.some((issue: any) => issue.field === 'main_attribute_value'));
    assert.deepEqual(Object.values(product.organizer.source.origins).flat().map((row: any) => [row.fileName, row.version, row.tab, row.row]), [
      ['Fuente QA.xlsm', '1665', 'HOGAR', 2], ['Fuente QA.xlsm', '1665', 'HOGAR', 3],
    ]);
    assert.ok(!initial.channels[0].issues.some((issue: any) => issue.field === 'main_img' || issue.field === 'detail_img_1'));
    // A low-certainty valid option completes the field: it is a warning with Gemini's reason, never a blocker.
    const materialIssues = initial.channels[0].issues.filter((issue: any) => issue.field === 'attr_1000463');
    assert.ok(materialIssues.length && materialIssues.every((issue: any) => issue.code === 'verify_suggestion' && issue.blocking === false
      && /La composición requiere verificación\./.test(issue.message)), JSON.stringify(materialIssues));
    if (!real) {
      assert.ok(product.marketplaceAutofill.shein.every((row: any) => row.values.attr_1000463 === 'Vidrio'
        && row.tentativeFields.includes('attr_1000463') && row.reasons.attr_1000463 === 'La composición requiere verificación.'));
      assert.ok(initial.channels[0].issues.some((issue: any) => issue.field === 'attr_1000411' && issue.blocking === false));
    }
    const calls = geminiCalls;
    const reopened = await exports.previewMarketplaceExports.run(request(scope));
    assert.equal(geminiCalls, calls);
    assert.ok(!reopened.autofillPending);
    assert.deepEqual(reopened.products[0].marketplaceAutofill, product.marketplaceAutofill);
    const material = 'Vidrio'; // Valor de atributo válido para el caso de prueba.
    // A manual correction wins over Gemini and does not invalidate the cached analysis of the other fields.
    const firstVariant = product.variants[0].id;
    const corrected = real ? product.marketplaces : { ...product.marketplaces, shein: { ...product.marketplaces.shein,
      rows: [{ id: firstVariant, values: { attr_1000411: '2 piezas' } }] } };
    await exports.saveMasterProduct.run(request({ ...scope, productId: product.id, expectedRevision: 0, organizerSourceRevision: product.organizer.revision,
      values: { ...product.values, description: 'Descripción corregida en Catálogo' }, marketplaces: corrected,
      variants: product.variants,
    }));
    const afterCorrection = await exports.previewMarketplaceExports.run(request(scope));
    assert.equal(geminiCalls, calls);
    if (!real) assert.ok(!afterCorrection.channels[0].issues.some((issue: any) => issue.field === 'attr_1000411' && issue.variantId === firstVariant));
    const updates = rows('1666', 12, undefined, material);
    updates[0].cells.find((cell: any) => cell.header === 'Precio de venta').originalValue = 159.5;
    await writeRows(updates);
    await assert.rejects(() => exports.saveMasterProduct.run(request({ ...scope, productId: product.id, expectedRevision: 1,
      organizerSourceRevision: product.organizer.revision, values: product.values, variants: product.variants, marketplaces: product.marketplaces })), { code: 'aborted' });
    const ready = await exports.previewMarketplaceExports.run(request({ ...scope, analyzeAutofill: true }));
    assert.equal(ready.products[0].values.description, 'Descripción corregida en Catálogo');
    assert.equal(ready.products[0].variants[0].values.inventory, '12');
    assert.equal(ready.products[0].variants[0].values.price, '159.5');
    assert.equal(ready.channels[0].ready, true, JSON.stringify(ready.channels[0].issues));
    const registry = db.doc(`clients/${clientId}/products/${product.id}/marketplaceImages/shein`);
    assert.equal((await registry.get()).exists, false);
    const input = { ...scope, marketplaceIds: ['shein'], requestId: 'qa-object-xlsx', authorizePublicImages: true };
    const denied = await exports.downloadMarketplaceExports.run(request({ ...input, requestId: 'qa-no-consent', authorizePublicImages: false }));
    assert.equal(denied.downloadUrl, null);
    assert.match(denied.failures[0].message, /Autoriza la publicación/);
    assert.equal((await registry.get()).exists, false);
    const callsBeforeDownload = geminiCalls;
    const downloaded = await exports.downloadMarketplaceExports.run(request(input));
    assert.equal(geminiCalls, callsBeforeDownload);
    assert.deepEqual(await exports.downloadMarketplaceExports.run(request(input)), downloaded);
    assert.equal(downloaded.failures.length, 0, JSON.stringify(downloaded.failures));
    const published = Object.values((await registry.get()).get('images')) as Array<{ jobId: string; url: string; storagePath: string }>;
    assert.equal(published.length, 2);
    const manual = await publishMarketplaceImages.run(request({ ...publishScope, productId: product.id }));
    assert.deepEqual(manual.images.map((i: any) => i.url).sort(), published.map(i => i.url).sort());
    for (const photo of published) {
      assert.match(photo.url, /^https:\/\/storage\.googleapis\.com\/demo-manglar-automation-marketplace-images\//);
      assert.ok((await publicBucket.file(photo.storagePath).exists())[0]);
    }
    const requests = await db.collection('marketplaceExportRequests').get();
    const artifacts = requests.docs.flatMap((doc: { get(field: string): string | undefined }) => doc.get('artifactPath') || []);
    assert.equal(artifacts.length, 1);
    const [buffer] = await bucket.file(artifacts[0]).download();
    const sheet = XLSX.read(buffer).Sheets[category.sheetName];
    const cell = (key: string, offset = 0) => sheet[`${category.columns.find((c: any) => c.key === key).letter}${category.rowStart + offset}`];
    assert.equal(cell('supplier_code').v, 'QA-VASO');
    assert.equal(cell('supplier_sku', 1).v, '00002');
    assert.equal(cell('supplier_sku').t, 's');
    assert.equal(cell('main_attribute_value').v, exportedColor);
    assert.equal(cell('attr_1000463').v, material);
    if (!real) {
      assert.equal(cell('attr_1000411').v, '2 piezas', 'The manual correction reaches the workbook');
      assert.equal(cell('attr_1000411', 1).v, '1 pieza', 'Optional suggestions reach the workbook unless corrected');
    }
    assert.equal(cell('main_img').v, published.find(i => i.jobId === 'object-front')!.url);
    assert.equal(cell('detail_img_1').v, published.find(i => i.jobId === 'object-side')!.url);
    assert.equal(cell(real ? category.columns.find((c: any) => c.key.startsWith('stock[')).key : 'stock').v, 12);
    const [before, after] = await Promise.all([inspectWorkbookPackage(bytes), inspectWorkbookPackage(buffer)]);
    assert.deepEqual(after.namedRanges, before.namedRanges);
    assert.deepEqual(after.sheets.map((s: any) => s.validations), before.sheets.map((s: any) => s.validations));
    const [originalZip, resultZip] = await Promise.all([JSZip.loadAsync(bytes), JSZip.loadAsync(buffer)]);
    const writtenSheet = before.sheets.find((s: any) => s.name === category.sheetName).path;
    assert.deepEqual(Object.keys(resultZip.files), Object.keys(originalZip.files));
    for (const path of Object.keys(originalZip.files).filter(path => path !== writtenSheet && !originalZip.files[path].dir))
      assert.deepEqual(await resultZip.file(path).async('nodebuffer'), await originalZip.file(path).async('nodebuffer'));
    if (process.env.TUTO_DRIVE_CATALOG_ARTIFACT) await writeFile(process.env.TUTO_DRIVE_CATALOG_ARTIFACT, buffer);

    const garmentRefs = [{ id: 'garment-reference', version: '1' }];
    const garmentRows = rows('2', 4).map((row: any) => ({ ...row, skc: 'QA-PRENDA', name: 'Prenda de prueba', tab: 'ROPA' }));
    await organizer.set({ minimumConfidence: .75 });
    await organizer.collection('photos').doc(garmentRefs[0].id).set({ version: '1', variantId: 'garment-visual', method: 'manual', issue: null,
      name: 'QA-PRENDA.jpg', view: 'front', quality: .95, visualConfidence: .99 });
    await writeRows(garmentRows, 'garment-visual');
    const garment = await readOrganizerCommerce(organizer, garmentRefs);
    await db.doc('automationJobs/garment-intake/organizerCommerce/garment-item').set({ ...garment, itemId: 'garment-item', photos: garmentRefs });
    assert.deepEqual(await organizerReferenceViews({ id: 'garment-intake', clientId, organizerCommerce: true }, 'garment-item'), { 'QA-PRENDA.jpg': 'front' });
    await db.doc('batches/garment-batch').set({ clientId, automationJobId: 'garment-intake', poseIds: [] });
    await writeScene('garment-front', 'garment-batch', 'garment-item', 'front', { id: 'task', itemId: 'garment-item', productId: 'garment-item', variantId: 'garment-item', view: 'front',
      destinations: [{ channel: 'shein', position: 1, role: 'main', required: true }] });
    const garmentPreview = await exports.previewMarketplaceExports.run(request({ clientId, batchIds: ['garment-batch'] }));
    assert.equal(garmentPreview.products[0].variants.length, 2);
    assert.ok(garmentPreview.products[0].variants.every((v: any) => v.values.skc === 'QA-PRENDA' &&
      garmentPreview.products[0].photoAssignments.some((a: any) => a.variantId === v.id && a.eligible)));
    assert.equal(garmentPreview.channels[0].issues[0].code, 'category');

    const ambiguous = rows('1667', 12, ['Vaso de cristal', 'Vaso con popote']);
    ambiguous[1].sku = ambiguous[0].sku;
    ambiguous[1].size = ambiguous[0].size;
    await writeRows(ambiguous);
    const blocked = await exports.previewMarketplaceExports.run(request(scope));
    assert.ok(blocked.channels[0].issues.some((issue: any) => issue.code === 'organizer_identity' && /productos distintos/.test(issue.message)));
    assert.equal((await db.collection('jobs').get()).size, 3);
  } finally {
    await cleanupEmulatorDatabase(db);
    await app.delete();
  }
});
