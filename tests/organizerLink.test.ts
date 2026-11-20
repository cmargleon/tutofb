import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { freeCommercialVariants, pendingCommercialGroup, NO_COMMERCIAL_ROW, NO_COMMERCIAL_MATCH } = createRequire(import.meta.url)('../functions/lib/shared/src/organizerLink.js') as typeof import('../shared/src/organizerLink');
import type { OrganizerPhoto, OrganizerVariant, StoredMasterProduct } from '../shared/src/types';
const { mergeLinkedProduct } = createRequire(import.meta.url)('../functions/lib/functions/src/organizer/linkMerge.js') as typeof import('../functions/src/organizer/linkMerge');

test('free rows count commercial visual variants, independent of reference approval and size count', () => {
  const variants = [{ id: 'occupied', skcs: ['A'], skus: ['A-S', 'A-M'], referenceState: 'pending' }, { id: 'free', skcs: ['B'], skus: ['B-S'] }] as OrganizerVariant[];
  const photos = [{ name: 'A.jpg', variantId: 'occupied' }, { name: 'SINCOD_BUZO_FRENTE_01.jpg', variantId: 'free' }] as OrganizerPhoto[];
  assert.deepEqual(freeCommercialVariants(variants, photos).map(v => v.id), ['free']);
  photos[1].reviewedBy = 'human';
  assert.deepEqual(freeCommercialVariants(variants, photos), []);
});
test('one pending group gives error with no free rows and warning with available rows', () => {
  const photos = [{ id: 'back', name: 'SINCOD_BUZO_ESPALDA_01.jpg' }, { id: 'front', name: 'SINCOD_BUZO_FRENTE_01.jpg' }] as OrganizerPhoto[];
  const empty = pendingCommercialGroup('group', photos, []);
  assert.equal(empty.message, NO_COMMERCIAL_ROW); assert.equal(empty.severity, 'error');
  const available = pendingCommercialGroup('group', photos, [{ variantId: 'new', name: 'Buzo', color: '', pack: '', skcs: ['B'], skus: [], sizes: [], origins: [] }]);
  assert.equal(available.message, NO_COMMERCIAL_MATCH); assert.equal(available.severity, 'warning');
  assert.equal(available.name, 'SINCOD_BUZO'); assert.equal(available.photoIds.length, 2);
});
test('explicit merge takes Excel over filenames, preserves manual data, selected photos and channel edits', () => {
  const target = { clientId: 'c', values: { name: 'Buzo' }, variants: [], marketplaces: {}, revision: 1, updatedAt: 1, updatedByUid: 'sync' } as StoredMasterProduct;
  const provisional = { ...target, values: { name: 'SINCOD_BUZO_FRENTE_01.jpg', description: 'Texto revisado' },
    catalog: { evidence: { description: { source: 'manual' } }, selectedImages: [{ jobId: 'job', outputId: 'out', linkId: 'link' }], photos: [], issues: [] } } as unknown as StoredMasterProduct;
  const source = { values: { name: 'Buzo de algodón', description: 'Texto del Excel' }, variants: [{ id: 'row', values: { sku: 'BUZO-S', price: '100', inventory: '0' } }], origins: {}, issue: null };
  const preview = mergeLinkedProduct(target, [provisional], source);
  assert.equal(preview.product.values.name, 'Buzo de algodón');
  assert.equal(preview.conflicts.find(c => c.field === 'values.description')?.source, 'Texto revisado');
  const applied = mergeLinkedProduct(target, [provisional], source, { 'values.description': 'source' });
  assert.equal(applied.product.values.description, 'Texto revisado');
  assert.equal(applied.product.variants[0].values.inventory, '0');
  assert.equal(applied.product.catalog?.selectedImages?.[0].outputId, 'out');
});
