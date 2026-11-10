import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { MasterProduct, SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { MARKETPLACE_ADAPTERS, isValidGtin, safePublicImageUrl } = require('../functions/lib/shared/src/marketplaceExport/adapters.js');
const { projectMasterProducts, masterProductId } = require('../functions/lib/functions/src/spreadsheets/masterProducts.js');
const product = (): MasterProduct => ({ id: 'p', clientId: 'c', batchIds: ['b'], garmentId: 'g', values: { name: 'Blusa', brand: 'Marca verificada' }, variants: [{ id: 'red-s', values: { sku: 'red-s', color: 'Rojo', size: 'S', price: '10.50', gtin: '4006381333931' } }, { id: 'blue-m', values: { sku: 'blue-m', color: 'Azul', size: 'M', price: '12' } }], evidence: {}, legacyDrafts: [], originalImages: [], approvedImages: [{ outputId: 'out', jobId: 'job', storagePath: 'generated/c/b/job/out.jpg' }], pendingImages: 0, marketplaces: {}, revision: 0 });
const category: SpreadsheetTemplateCategory = { id: 'cat', templateId: 't', clientId: 'c', sheetName: 'Products', label: 'Products', rowStart: 7, columns: [{ key: 'seller_sku', label: 'SKU', index: 0, letter: 'A', required: true, requirementLabel: null, guidance: null, validation: null }, { key: 'color', label: 'Color', index: 1, letter: 'B', required: true, requirementLabel: null, guidance: null, validation: 'list', dropdownFormula: 'Colors', dropdownOptions: ['Rojo', 'Azul'] }, { key: 'gtin', label: 'GTIN', index: 2, letter: 'C', required: false, requirementLabel: null, guidance: null, validation: null }], attributes: [], createdAt: null, updatedAt: null };
const template = (id: any, operation = 'listing'): SpreadsheetTemplate => ({ id: 't', clientId: 'c', exportConfig: { marketplaceId: id, version: 1, operation, validationStatus: 'compatible', validationMessages: [], mappings: { cat: { seller_sku: { source: 'variant.sku' }, color: { source: 'variant.color' }, gtin: { source: 'variant.gtin' } } } } } as any);
for (const id of ['shein', 'mercado-libre', 'tiktok-shop', 'amazon'] as const) test(`${id}: shares master variants, validates enums and never fabricates GTINs`, () => {
  const p = product(); p.marketplaces[id] = { templateId: 't', categoryId: 'cat' };
  const result = MARKETPLACE_ADAPTERS[id].prepare(p, template(id), category);
  assert.deepEqual(result.issues, []); assert.equal(result.rows.length, 2); assert.equal(result.rows[1].values.gtin, '');
  p.variants[0].values.color = 'Unknown'; assert.ok(MARKETPLACE_ADAPTERS[id].prepare(p, template(id), category).issues.some((i: any) => i.code === 'enum'));
  p.variants[0].values.gtin = '123'; assert.ok(MARKETPLACE_ADAPTERS[id].prepare(p, template(id), category).issues.some((i: any) => i.code === 'gtin'));
});
test('manual output overrides prevail, closed lists reject arbitrary AI values, unresolved dependent validations block', () => {
  const p = product(); p.marketplaces.shein = { templateId: 't', categoryId: 'cat', rows: [{ id: 'red-s', values: { color: 'Azul' } }] };
  assert.equal(MARKETPLACE_ADAPTERS.shein.prepare(p, template('shein'), category).rows[0].values.color, 'Azul');
  const unresolved = structuredClone(category); unresolved.columns[1].dropdownOptions = [];
  assert.ok(MARKETPLACE_ADAPTERS.shein.prepare(p, template('shein'), unresolved).issues.some((i: any) => i.code === 'unresolved_list'));
});
test('Amazon existing ASIN, new products, GTIN exemption and variant parent/child relationships remain explicit', () => {
  const p = product(); p.marketplaces.amazon = { templateId: 't', categoryId: 'cat' };
  const amazonCategory = structuredClone(category); amazonCategory.columns.push({ key: 'asin', label: 'ASIN', index: 3, letter: 'D', required: false, requirementLabel: null, guidance: null, validation: null });
  const amazonTemplate = (operation: string) => { const t = template('amazon', operation); t.exportConfig!.mappings.cat.asin = { source: 'variant.asin' }; return t; };
  p.variants = [{ id: 'v', values: { sku: 'v', color: 'Rojo', asin: 'B012345678' } }];
  assert.equal(MARKETPLACE_ADAPTERS.amazon.prepare(p, amazonTemplate('existing_catalog'), amazonCategory).issues.length, 0);
  const newResult = () => MARKETPLACE_ADAPTERS.amazon.prepare(p, template('amazon', 'new_product'), category);
  assert.ok(newResult().issues.some((i: any) => i.code === 'gtin_authorization'));
  p.variants[0].values.gtinExemption = 'pending'; assert.ok(newResult().issues.some((i: any) => i.code === 'gtin_authorization'));
  p.variants[0].values.gtinExemption = 'approved'; assert.equal(newResult().issues.length, 0);
  p.variants.push({ id: 'child', values: { sku: 'child', color: 'Azul', gtin: '4006381333931' } });
  assert.ok(newResult().issues.some((i: any) => i.code === 'variants'));
  p.variants[0].values.parentage = 'parent'; p.variants[1].values.parentage = 'child'; p.variants[1].values.parentSku = 'v';
  assert.equal(newResult().issues.length, 0);
});
test('images require current approval and authorized stable URLs, never private input or temporary links', () => {
  for (const value of ['http://example.com/a.jpg', 'https://storage.googleapis.com/a.jpg', 'https://drive.google.com/a.jpg', 'https://example.com/a.jpg?token=x', 'https://127.0.0.1/a.jpg', 'https://192.168.1.1/a.jpg']) assert.equal(safePublicImageUrl(value), false);
  assert.equal(safePublicImageUrl('https://images.example.com/a.jpg'), true);
  const p = product(); p.marketplaces.shein = { templateId: 't', categoryId: 'cat' }; p.approvedImages = [];
  assert.ok(MARKETPLACE_ADAPTERS.shein.prepare(p, template('shein'), category).issues.some((i: any) => i.code === 'images_pending'));
  assert.equal(isValidGtin('4006381333931'), true); assert.equal(isValidGtin('4006381333932'), false);
});
test('historical drafts are recovered losslessly, photos-only batches work, automation batches share product identity', () => {
  const batches = [{ id: 'b1', automationJobId: 'auto', clientId: 'c' }, { id: 'b2', automationJobId: 'auto', clientId: 'c' }];
  const rawDraft = { id: 'draft', batchId: 'b1', clientId: 'c', garmentId: 'g', garmentName: 'Prenda', rows: [{ id: 'v1', values: { supplier_code: 'SPU-1', sku_code: 'SKU-1', custom_field: 'Do not lose' } }], inferredValues: { custom: { value: 'sugerido', source: 'gemini', confidence: 0.8 } }, originalImages: [] };
  const job = { id: 'j', batchId: 'b2', clientId: 'c', garmentId: 'g', garmentName: 'Prenda', status: 'completed', currentOutput: { id: 'out', resultImagePath: 'generated/c/b2/j/out.jpg', autoReview: { verdict: 'approved' } } };
  const result = projectMasterProducts('c', batches, [job], [rawDraft]);
  assert.equal(result.length, 1); assert.deepEqual(result[0].batchIds, ['b1', 'b2']); assert.deepEqual(result[0].legacyDrafts[0], rawDraft); assert.equal(result[0].variants[0].values.spu, 'SPU-1'); assert.equal(result[0].approvedImages.length, 1);
  const id = masterProductId(batches[0], 'g'); assert.equal(id, masterProductId(batches[1], 'g'));
  const corrected = projectMasterProducts('c', batches, [job], [rawDraft], { [id]: { clientId: 'c', values: { name: 'Manual' }, variants: [{ id: 'v1', values: { sku: 'manual-sku' } }], marketplaces: {}, revision: 4 } });
  assert.equal(corrected[0].values.name, 'Manual'); assert.equal(corrected[0].legacyDrafts[0].rows[0].values.custom_field, 'Do not lose');
  assert.equal(projectMasterProducts('c', batches, [job], []).length, 1);
  assert.throws(() => projectMasterProducts('other', batches, [job], []));
});
test('no XLSX serializer is used anywhere in generation, review or automation; only explicit download uses export service', () => {
  for (const path of ['functions/src/callables/createGenerationBatch.ts', 'functions/src/callables/createProductGenerationBatch.ts', 'functions/src/workers/jobWorker.ts', 'functions/src/automation/pipelines.ts', 'functions/src/automation/worker.ts']) {
    const source = readFileSync(path, 'utf8'); assert.doesNotMatch(source, /downloadMarketplaceExport|patchWorkbookCells|prepareBatchSpreadsheetExport|exportBatchSpreadsheetWorkbook|XLSX\.write/);
  }
});

test('manual output values remain final and value maps cannot read inherited properties', () => {
  const p = product(); p.marketplaces.shein = { templateId: 't', categoryId: 'cat', rows: [{ id: 'red-s', values: { color: 'Azul' } }] };
  const t = template('shein'); t.exportConfig!.mappings.cat.color.valueMap = { Azul: 'not-an-allowed-value' };
  t.exportConfig!.mappings.cat.seller_sku.valueMap = {}; p.variants[0].values.sku = 'constructor'; p.variants[1].values.color = 'Rojo';
  const result = MARKETPLACE_ADAPTERS.shein.prepare(p, t, category);
  assert.equal(result.rows[0].values.color, 'Azul'); assert.equal(result.rows[0].values.seller_sku, 'constructor'); assert.equal(result.issues.length, 0);
});

test('historical missing IDs, unreviewed outputs and paths outside the batch never count as approval', () => {
  const batches = [{ id: 'b', clientId: 'c' }];
  for (const currentOutput of [{ resultImagePath: 'generated/c/b/j/a.jpg' }, { id: 'a', resultImagePath: 'generated/c/b/j/a.jpg' }, { id: 'a', resultImagePath: 'generated/foreign/b/j/a.jpg', autoReview: { verdict: 'approved' } }]) {
    const projected = projectMasterProducts('c', batches, [{ id: 'j', clientId: 'c', batchId: 'b', garmentId: 'g', garmentName: 'G', status: 'completed', currentOutput }], []);
    assert.equal(projected[0].approvedImages.length, 0);
  }
});

test('official category lists override legacy Color/Size assumptions without changing historical behavior', () => {
  const p = product(); p.variants = [p.variants[0]]; p.marketplaces.shein = { templateId: 't', categoryId: 'cat', rows: [{ id: 'red-s', values: { main_attribute: 'Material(9)' } }] };
  const c = structuredClone(category); c.attributes = [{ name: 'Color(27)', attributeType: 'Especificación', required: false, important: true, values: ['Rojo'] }];
  c.columns.push({ key: 'main_attribute', label: 'Especificación principal', index: 3, letter: 'D', required: true, requirementLabel: null, guidance: null, validation: 'list', dropdownFormula: 'MainAttributes', dropdownOptions: ['Material(9)'] });
  const t = template('shein'); t.exportConfig!.mappings.cat.main_attribute = { source: 'literal.Material(9)' };
  const result = MARKETPLACE_ADAPTERS.shein.prepare(p, t, c);
  assert.equal(result.issues.length, 0); assert.equal(result.rows[0].values.main_attribute, 'Material(9)');
});

test('GTIN authorizations are channel-specific and a pending channel correction overrides the legacy exemption', () => {
  const p = product(); p.variants = [{ id: 'v', values: { sku: 'v', color: 'Rojo', gtinExemption: 'approved' } }];
  p.marketplaces.amazon = { templateId: 't', categoryId: 'cat', requirements: { gtinExemptionByVariant: { v: 'pending' }, brandSnapshot: p.values.brand, categoryIdSnapshot: 'cat' } };
  const result = () => MARKETPLACE_ADAPTERS.amazon.prepare(p, template('amazon', 'new_product'), category);
  assert.ok(result().issues.some((issue: any) => issue.code === 'gtin_authorization'));
  p.marketplaces.amazon.requirements!.gtinExemptionByVariant!.v = 'approved'; assert.equal(result().issues.length, 0);
  p.values.brand = 'Otra marca'; assert.ok(result().issues.some((issue: any) => issue.code === 'gtin_authorization')); p.values.brand = 'Marca verificada';
  p.marketplaces.amazon.requirements!.gtinExemptionByVariant = {}; assert.ok(result().issues.some((issue: any) => issue.code === 'gtin_authorization'));
});
