import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { MasterProduct, StoredMasterProduct } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { mergeCatalogSource, catalogSearchKeys, manualEvidence } = require('../functions/lib/functions/src/catalog/model.js');
const { masterProductId } = require('../functions/lib/functions/src/spreadsheets/masterProducts.js');
const source = (extra: Partial<MasterProduct> = {}): MasterProduct => ({ id: 'legacy', clientId: 'c', garmentId: 'g', batchIds: ['b'], values: { name: 'Imported', sku: '00001' }, variants: [{ id: 'v', values: { sku: '00002', gtin: '00001234567890' } }], evidence: {}, legacyDrafts: [], originalImages: [], approvedImages: [], pendingImages: 0, marketplaces: {}, revision: 0, ...extra });
const current = (extra: Partial<StoredMasterProduct> = {}): StoredMasterProduct => ({ clientId: 'c', values: { name: 'Manual', description: '' }, variants: [{ id: 'v', values: { sku: '00002', price: '25' } }], marketplaces: { shein: { templateId: 't', categoryId: 'cat' } }, revision: 2, updatedAt: 1, updatedByUid: 'u', ...extra });
test('imports preserve manual corrections, explicitly empty values, variants and zero-prefixed identifiers', () => {
  const merged = mergeCatalogSource(current(), source({ values: { name: 'Imported', description: 'AI text', sku: '00001' } }), 'batches/b');
  assert.equal(merged.values.name, 'Manual'); assert.equal(merged.values.description, '');
  assert.equal(merged.values.sku, '00001'); assert.equal(merged.variants[0].values.gtin, '00001234567890'); assert.equal(merged.variants[0].values.price, '25');
  assert.equal(merged.catalog.issues.length, 2);
  assert.equal(merged.catalog.evidence.sku.state, 'confirmed');
  assert.equal(manualEvidence('').state, 'empty'); assert.equal(merged.catalog.evidence.currency, undefined);
});
test('verified commercial evidence outranks imports; AI suggestions cannot replace it', () => {
  const record = current({ values: { name: 'Verified' }, catalog: { version: 1, status: 'draft', createdAt: 1, attributes: {}, issues: [], searchKeys: [], evidence: { name: { original: 'Verified', normalized: 'Verified', source: 'drive', confidence: 1, verified: true } } } });
  const ai = mergeCatalogSource(record, source({ values: { name: 'AI' }, evidence: { name: { original: 'AI', normalized: 'AI', source: 'ai', confidence: 0.99 } } }), 'ai');
  assert.equal(ai.values.name, 'Verified'); assert.equal(ai.catalog.issues[0].incoming, 'AI');
});
test('repeated imports do not duplicate conflicts or variants; name similarity never supplies identity', () => {
  const first = mergeCatalogSource(current(), source(), 'b');
  const again = mergeCatalogSource({ ...current(), ...first }, source(), 'b');
  assert.deepEqual(again, first);
  assert.notEqual(masterProductId({ id: 'batch1' }, 'g'), masterProductId({ id: 'batch2' }, 'g'));
  assert.equal(masterProductId({ id: 'b', automationJobId: 'automation' }, 'g'), 'c590927f0f0d3502abe823ee139da1b40f83bdd1');
});
test('search materialization retains exact SKU/SKC/SPU strings across 200 variants', () => {
  const variants = Array.from({ length: 200 }, (_, i) => ({ id: `v${i}`, values: { sku: `00000-${i}`, skc: `SKC-${i}`, spu: `SPU-${i}` } }));
  const keys = catalogSearchKeys({ name: 'Camisa de algodón' }, variants);
  assert.ok(keys.includes('00000-199')); assert.ok(keys.includes('skc-199')); assert.ok(keys.includes('spu-199')); assert.ok(keys.includes('cami'));
  assert.ok(keys.length < 1000);
});
test('explicit variant maps enrich the canonical variant without rekeying it', () => {
  const result = mergeCatalogSource(current(), source({ variants: [{ id: 'another-row', values: { color: 'Rojo' } }] }), 'b2', { 'another-row': 'v' });
  assert.equal(result.variants.length, 1); assert.equal(result.variants[0].id, 'v'); assert.equal(result.variants[0].values.color, 'Rojo');
});
