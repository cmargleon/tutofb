import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { CatalogPhoto, Job, MasterVariant } from '../shared/src/types';

// shared/ is CommonJS: load through require so every export is available.
const require = createRequire(import.meta.url);
const {
  attributeCatalogVariant, catalogBrowseProjection, catalogFamiliesOfGroup, catalogPhotoFromJob, classifyCatalogCategory, groupCatalogVariants,
} = require('../shared/src/clientCatalog/browse.ts') as typeof import('../shared/src/clientCatalog/browse');

test('classifies template values and marketplace-like categories into universal types', () => {
  assert.deepEqual(classifyCatalogCategory('Vaso'), { typeId: 'vaso', familyId: 'cocina', group: 'objetos' });
  assert.deepEqual(classifyCatalogCategory('Suéteres mujer'), { typeId: 'sueter', familyId: 'ropa', group: 'ropa' });
  assert.deepEqual(classifyCatalogCategory('Juego de vasos'), { typeId: 'juego-de-vasos', familyId: 'cocina', group: 'objetos' });
  assert.deepEqual(classifyCatalogCategory('carpas'), { typeId: 'casa-de-campana', familyId: 'exterior', group: 'objetos' });
  assert.equal(classifyCatalogCategory('Tops deportivos mujer').typeId, 'top');
  assert.equal(classifyCatalogCategory('Buzos mujer').typeId, 'sudadera');
  assert.equal(classifyCatalogCategory('Mesa y sillas ple').typeId, 'mesa-o-silla-plegable');
  assert.deepEqual(classifyCatalogCategory(''), { typeId: null, familyId: null, group: null });
  assert.deepEqual(classifyCatalogCategory('Algo raro'), { typeId: null, familyId: null, group: null });
  assert.equal(catalogBrowseProjection({ category: 'Tazas' }).listed, true);
});

test('groups split clothing from every other family', () => {
  assert.deepEqual(catalogFamiliesOfGroup('ropa').map(f => f.id), ['ropa']);
  assert.ok(catalogFamiliesOfGroup('objetos').every(f => f.id !== 'ropa'));
  assert.equal(catalogFamiliesOfGroup('').length, catalogFamiliesOfGroup('ropa').length + catalogFamiliesOfGroup('objetos').length);
});

const job = (overrides: Partial<Job> = {}) => ({
  id: 'job-1', clientId: 'c', batchId: 'b', garmentId: 'g', status: 'completed',
  currentOutput: { id: 'out-1', resultImagePath: 'generated/c/b/job-1/out-1.png', thumbnailPath: 'generated/c/b/job-1/out-1_thumb.jpg', autoReview: { verdict: 'approved' } },
  ...overrides,
}) as unknown as Job & { id: string };

test('projects the current output of a completed job', () => {
  const photo = catalogPhotoFromJob(job({ photoTask: { variantId: 'v-red', view: 'front', destinations: [{ role: 'alternative', position: 3 }, { role: 'main', position: 1 }] } as never }));
  assert.equal(photo?.sourceVariantId, 'v-red');
  assert.equal(photo?.role, 'main');
  assert.equal(photo?.position, 1);
  assert.equal(photo?.approved, true);
  assert.equal(catalogPhotoFromJob(job())?.sourceVariantId, 'g');
  assert.equal(catalogPhotoFromJob(job({ status: 'processing' })), null);
  assert.equal(catalogPhotoFromJob(job({ manuallyFlagged: true } as never)), null);
});

test('attributes a source variant through the generation link map', () => {
  const variants = [{ id: 'a', values: {} }, { id: 'b', values: {} }];
  assert.equal(attributeCatalogVariant('src', variants, { src: 'b' }), 'b');
  assert.equal(attributeCatalogVariant('a', variants), 'a');
  assert.equal(attributeCatalogVariant('unknown', variants), null);
  assert.equal(attributeCatalogVariant('unknown', [{ id: 'only', values: {} }]), 'only');
  // Photos are per SKC: sizes of a single SKC take the photo on the first variant.
  const sizes = [{ id: 's', values: { skc: 'SR-05-NEG', size: 'S' } }, { id: 'm', values: { skc: 'SR-05-NEG', size: 'M' } }];
  assert.equal(attributeCatalogVariant('garment', sizes), 's');
  assert.equal(attributeCatalogVariant('garment', [...sizes, { id: 'r', values: { skc: 'SR-05-ROJ' } }]), null);
});

test('groups sizes by SKC and picks the approved main photo', () => {
  const variants: MasterVariant[] = [
    { id: 'r-s', values: { skc: 'CAM-ROJO', color: 'Rojo', size: 'S' } },
    { id: 'r-m', values: { skc: 'CAM-ROJO', color: 'Rojo', size: 'M' } },
    { id: 'n-s', values: { skc: 'CAM-NEGRO', color: 'Negro', size: 'S' } },
    { id: 'x', values: {} },
  ];
  const photo = (jobId: string, variantId: string | null, extra: Partial<CatalogPhoto> = {}): CatalogPhoto => ({
    jobId, batchId: 'b', outputId: jobId, storagePath: `p/${jobId}`, thumbnailPath: null, variantId, approved: true, role: null, position: null, view: null, ...extra,
  });
  const { groups, unassigned } = groupCatalogVariants(variants, [
    photo('j1', 'r-m', { role: 'alternative', position: 2 }), photo('j2', 'r-s', { role: 'main', position: 1, approved: false }),
    photo('j3', 'r-s', { role: 'main', position: 1 }), photo('j4', null),
  ]);
  assert.deepEqual(groups.map(g => g.key), ['skc:CAM-ROJO', 'skc:CAM-NEGRO', 'variant:x']);
  assert.equal(groups[0].variants.length, 2);
  assert.equal(groups[0].main?.jobId, 'j3');
  assert.deepEqual(groups[0].photos.map(p => p.jobId), ['j3', 'j1', 'j2']);
  assert.equal(groups[1].main, null);
  assert.deepEqual(unassigned.map(p => p.jobId), ['j4']);
});
