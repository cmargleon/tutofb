import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Regressions found in the Drive → Organizer → Catalog → SHEIN end-to-end run of 2026-11-19.
const require = createRequire(import.meta.url);
const lib = '../functions/lib';
const { groupAutofillFields, buildAutofillResponseSchema, AUTOFILL_GROUP_MAX_FIELDS } = require(`${lib}/functions/src/spreadsheets/marketplaceAutofill.js`);
const { mergeNearDuplicateGroups, organizerAutomationBudget, selectGenerationReferences, differenceHash } = require(`${lib}/functions/src/organizer/automation.js`);
const { viewFromFileName } = require(`${lib}/functions/src/organizer/viewHints.js`);
const { shouldContinueRun } = require(`${lib}/functions/src/organizer/worker.js`);
const { declaredSheetAttributes, resolveCommercialRows } = require(`${lib}/functions/src/organizer/commerce.js`);
const { declaredSheetValue, declaredColumnKey, MARKETPLACE_ADAPTERS } = require(`${lib}/shared/src/marketplaceExport/adapters.js`);
const { snapNearWhite } = require(`${lib}/functions/src/media/compressGeneratedImage.js`);
const { resolveAutomationPresetName } = require(`${lib}/shared/src/automationConfig.js`);
const sharp = createRequire(new URL('../functions/package.json', import.meta.url))('sharp');

test('autollenado: 50 desplegables se piden en grupos pequeños sin límites de longitud en el esquema', () => {
  const fields = Array.from({ length: 50 }, (_, index) => ({ key: `attr_${index}`, label: `Campo ${index}`, options: Array.from({ length: 40 }, (_, o) => `Opción ${o}`) }));
  const groups = groupAutofillFields(fields);
  assert.equal(groups.flat().length, 50);
  assert.ok(groups.every((group: unknown[]) => group.length <= AUTOFILL_GROUP_MAX_FIELDS));
  const schema = buildAutofillResponseSchema(groups[0]);
  assert.equal('minItems' in schema, false);
  assert.equal('maxItems' in schema, false);
  assert.deepEqual(schema.items.properties.key.enum, groups[0].map((field: { key: string }) => field.key));
  assert.equal('enum' in schema.items.properties.value, false, 'Los valores se validan en el servidor, no en el esquema');
  assert.deepEqual(buildAutofillResponseSchema([fields[0]], true).items.properties.value.enum, fields[0].options);
});

test('vista declarada en el nombre del archivo', () => {
  assert.equal(viewFromFileName('AT-R01-TER-DETRAS.png'), 'back');
  assert.equal(viewFromFileName('AT-R01-TER-FRENTE.png'), 'front');
  assert.equal(viewFromFileName('blusa_espalda.jpg'), 'back');
  assert.equal(viewFromFileName('AT-O02-PACK4.webp'), null);
  assert.equal(viewFromFileName('frente y detras.jpg'), null, 'Ambiguo: decide la visión');
});

test('una ejecución reanudada o que agotó su tramo continúa de inmediato; el throttling espera al programador', () => {
  assert.equal(shouldContinueRun({ status: 'failed' }, { status: 'queued', createdBy: 'uid' }), true);
  assert.equal(shouldContinueRun({ status: 'paused' }, { status: 'queued', createdBy: 'uid' }), true);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'uid', error: null }), true);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'uid', error: 'HTTP 429' }), false);
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher' }), true, 'Las ejecuciones del vigilante también encadenan tramos');
  assert.equal(shouldContinueRun({ status: 'running' }, { status: 'queued', createdBy: 'watcher', error: 'HTTP 503' }), false);
  assert.equal(shouldContinueRun({ status: 'queued' }, { status: 'running' }), false);
});

test('preset por tipo: el preset integrado de objetos no bloquea las prendas', () => {
  assert.equal(resolveAutomationPresetName({ jobType: 'garment', preset: 'generic_product' }, {}), 'standard');
  assert.equal(resolveAutomationPresetName({ jobType: 'product', preset: 'generic_product' }, {}), 'generic_product');
});

test('presupuesto del lote único: escala por artículo hasta el máximo global', () => {
  assert.equal(organizerAutomationBudget(1, 10, 100), 10);
  assert.equal(organizerAutomationBudget(5, 10, 100), 50);
  assert.equal(organizerAutomationBudget(18, 10, 100), 100);
});

const source = (id: string, folder: string, variantId: string | null = null) => ({
  entry: { id, name: `${id}.png`, mimeType: 'image/png', parents: [folder], path: ['Origen', folder, `${id}.png`], sourceId: 'origin', version: '1', md5Checksum: id },
  photo: { id, name: `${id}.png`, path: [], sourceUrl: '', copyUrl: null, variantId, candidates: [], method: 'sin_asociar', evidence: [], confidence: 0,
    issue: null, duplicateOf: null, reviewedBy: null, view: 'front', kind: 'garment', quality: 0.9, visualConfidence: 0.95 },
});

test('duplicados sin código (PNG y JPG del mismo suéter) forman un solo artículo y una sola referencia', async () => {
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 30, height: 40, channels: 3, background: '#111111' } }).png().toBuffer(), left: 10, top: 12 }]).png().toBuffer();
  const other = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 50, height: 10, channels: 3, background: '#aa0000' } }).png().toBuffer(), left: 4, top: 40 }]).png().toBuffer();
  const [png, jpg, distinct] = await Promise.all([differenceHash(image), differenceHash(await sharp(image).jpeg({ quality: 70 }).toBuffer()), differenceHash(other)]);
  const groups = [
    { itemId: 'a', photos: [source('sueter-png', 'SIN CODIGO')] },
    { itemId: 'b', photos: [source('sueter-jpg', 'SIN CODIGO')] },
    { itemId: 'c', photos: [source('otro', 'SIN CODIGO')] },
    { itemId: 'd', photos: [source('sueter-otra-carpeta', 'OTRA')] },
  ];
  const merged = mergeNearDuplicateGroups(groups, new Map([['sueter-png', png], ['sueter-jpg', jpg], ['otro', distinct], ['sueter-otra-carpeta', png]]));
  assert.deepEqual(merged.map((group: { photos: Array<{ photo: { id: string } }> }) => group.photos.map(item => item.photo.id)),
    [['sueter-png', 'sueter-jpg'], ['otro'], ['sueter-otra-carpeta']]);
  assert.equal(merged[0].photos[1].photo.duplicateOf, 'sueter-png');
  assert.equal(selectGenerationReferences(merged[0].photos, 0.75).references.length, 1, 'La copia no se envía dos veces');
});

const cell = (header: string, value: string, field = '') => ({ column: 'A', header, value, originalValue: value, field });
const row = (sku: string, size: string, extra: ReturnType<typeof cell>[] = []) => ({
  fileId: 'f', fileName: 'CATALOGO.xlsx', tab: 'Hoja1', tabId: 0, line: 2, sourceVersion: '1', skc: 'AT-R01-TER', sku, base: 'AT-R01', name: 'Pantalón cargo',
  category: 'Pantalones de mujer', color: 'Terracota', size, pack: '', photo: '', upload: '', publish: '', comments: '',
  cells: [cell('SPU', 'AT-R01', 'base'), cell('SKC', 'AT-R01-TER', 'skc'), cell('SKU', sku, 'sku'), cell('TALLA', size, 'size'), cell('PRECIO', '549', 'price'),
    cell('MARCA', 'Manglar'), cell('Elasticidad de la tela', 'Elasticidad media'), cell('Tipo de embalaje', 'Bolsa'), ...extra],
});

test('Excel → SHEIN: SPU, variantes por talla y columnas extra con el mismo nombre que la plantilla', () => {
  assert.deepEqual(declaredSheetAttributes(row('AT-R01-TER-S', 'S')), { 'sheet:Elasticidad de la tela': 'Elasticidad media', 'sheet:Tipo de embalaje': 'Bolsa' });
  const variant = { id: 'v', color: 'Terracota', pack: '', name: 'Pantalón cargo', category: 'Pantalones de mujer' };
  const resolved = resolveCommercialRows(variant, [row('AT-R01-TER-S', 'S'), { ...row('AT-R01-TER-M', 'M'), line: 3 }, { ...row('AT-R01-TER-L', 'L'), line: 4 }], {}, true);
  assert.equal(resolved.issue, null);
  assert.deepEqual(resolved.variants.map((item: { values: { size: string; spu: string; price: string } }) => [item.values.size, item.values.spu, item.values.price]),
    [['S', 'AT-R01', '549'], ['M', 'AT-R01', '549'], ['L', 'AT-R01', '549']]);
  assert.equal(resolved.values.brand, 'Manglar');
  assert.equal(declaredColumnKey('Elasticidad de la tela(39)'), declaredColumnKey('ELASTICIDAD DE LA TELA'));
  assert.equal(declaredSheetValue(resolved.variants[0], { key: 'attr_39', label: 'Elasticidad de la tela(39)' }), 'Elasticidad media');
  assert.equal(declaredSheetValue(resolved.variants[0], { key: 'package_type', label: 'Tipo de embalaje' }), 'Bolsa');

  // The adapter uses a declared column only when its own mapping has no value, and one row per size.
  const columns = [
    { key: 'supplier_code', label: 'Número del artículo', required: true },
    { key: 'attr_39', label: 'Elasticidad de la tela(39)', required: true, dropdownOptions: ['Sin elasticidad', 'Elasticidad media', 'Alta elasticidad'] },
    { key: 'package_type', label: 'Tipo de embalaje', required: false, dropdownOptions: ['Bolsa', 'Caja'] },
  ].map((column, index) => ({ index, letter: String.fromCharCode(65 + index), requirementLabel: null, guidance: null, validation: 'list', ...column }));
  const category = { id: 'cat', templateId: 't', clientId: '', sheetName: 'Pantalones', label: 'Pantalones', rowStart: 7, attributes: [], columns };
  const template = { id: 't', categoryIds: ['cat'], exportConfig: { marketplaceId: 'shein', version: 1, mappings: { cat: {
    supplier_code: { source: 'variant.spu', required: true }, attr_39: { source: 'legacy.attr_39', required: true }, package_type: { source: 'legacy.package_type' } } } } };
  const product = { id: 'p', clientId: 'c', garmentId: 'g', batchIds: [], values: { name: 'Pantalón cargo' }, evidence: {}, variants: resolved.variants,
    legacyDrafts: [], originalImages: [], approvedImages: [{ outputId: 'o', jobId: 'j', storagePath: 'x' }], marketplaces: { shein: { templateId: 't', categoryId: 'cat' } }, revision: 0 };
  const prepared = MARKETPLACE_ADAPTERS.shein.prepare(product, template, category);
  assert.equal(prepared.rows.length, 3);
  assert.deepEqual(prepared.rows.map((item: { values: Record<string, string> }) => [item.values.supplier_code, item.values.attr_39, item.values.package_type]),
    Array(3).fill(['AT-R01', 'Elasticidad media', 'Bolsa']));
  assert.equal(prepared.issues.filter((issue: { code: string }) => issue.code === 'required').length, 0);
});

test('fondo blanco del archivo final: los casi blancos (254) se guardan como RGB 255', async () => {
  const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 254, g: 254, b: 253 } } })
    .composite([{ input: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#203040' } }).png().toBuffer(), left: 11, top: 11 }]).jpeg().toBuffer();
  const pixels = await sharp(await snapNearWhite(input)).raw().toBuffer();
  assert.deepEqual([...pixels.subarray(0, 3)], [255, 255, 255]);
  const center = (16 * 32 + 16) * 3;
  assert.ok(pixels[center] < 100, 'El producto no se blanquea');
});

test('unidades: el Excel en kg/m se convierte a g/cm cuando la plantilla SHEIN solo acepta esas unidades', () => {
  const { convertMeasurementUnits } = require(`${lib}/shared/src/marketplaceExport/adapters.js`);
  const unit = (key: string, option: string, index: number) => ({ key, label: key, index, letter: 'A', required: false, requirementLabel: null, guidance: null,
    validation: 'list', dropdownOptions: [option] });
  const category = { columns: [unit('weight_unit', 'g', 0), unit('length_unit', 'cm', 1)] };
  const values: Record<string, string> = { weight: '0.45', weight_unit: 'kg', length: '0.35', width: '0.28', height: '', length_unit: 'm' };
  convertMeasurementUnits(category, values);
  assert.deepEqual(values, { weight: '450', weight_unit: 'g', length: '35', width: '28', height: '', length_unit: 'cm' });
  const manual: Record<string, string> = { weight: '2', weight_unit: 'kg' };
  convertMeasurementUnits(category, manual, { weight_unit: 'kg' });
  assert.deepEqual(manual, { weight: '2', weight_unit: 'kg' }, 'Una corrección manual no se toca');
});

test('descarga parcial: con la opción activa se exporta lo listo y se informan los productos omitidos', () => {
  const admin = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-export-split', storageBucket: 'demo-export-split.appspot.com' });
  const { splitBlockedProducts } = require(`${lib}/functions/src/spreadsheets/marketplaceExportService.js`);
  const context = { products: [{ id: 'listo' }, { id: 'sin-foto' }] };
  const issue = (productId: string, blocking?: false) => ({ marketplaceId: 'shein', productId, productName: productId, code: 'x', message: `falta ${productId}`, ...(blocking === false ? { blocking } : {}) });
  const readiness = { marketplaceId: 'shein', compatibleTemplates: 1, ready: false, issues: [issue('sin-foto'), issue('listo', false)] };
  assert.equal(splitBlockedProducts(context, readiness, false).context, null, 'Sin la opción, sigue siendo todo o nada');
  const split = splitBlockedProducts(context, readiness, true);
  assert.deepEqual(split.context.products, [{ id: 'listo' }]);
  assert.deepEqual(split.skipped, [{ productId: 'sin-foto', productName: 'sin-foto', reasons: ['falta sin-foto'] }]);
  assert.equal(splitBlockedProducts(context, { ...readiness, issues: [issue('')] }, true).context, null, 'Un problema del destino no se omite');
  assert.equal(splitBlockedProducts({ products: [{ id: 'sin-foto' }] }, readiness, true).context, null, 'Nada que exportar');
});
