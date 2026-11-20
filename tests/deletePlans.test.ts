import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractLiveOutputPaths } = require('../functions/lib/functions/src/triggers/deletePlans.js') as {
  extractLiveOutputPaths: typeof import('../functions/src/triggers/deletePlans').extractLiveOutputPaths;
};

test('extractLiveOutputPaths deduplica y omite outputs ya marcados como borrados', () => {
  const paths = extractLiveOutputPaths([
    { resultImagePath: 'generated/a.png' },
    { resultImagePath: 'generated/a.png' },
    { resultImagePath: 'generated/b.png', storageDeletedAt: new Date() },
    { resultImagePath: 'generated/c.png' },
  ]);

  assert.deepEqual(paths, ['generated/a.png', 'generated/c.png']);
});

const { modelStoragePrefixes, batchesToRecomputeAfterModelDelete } = require('../functions/lib/functions/src/triggers/deletePlans.js') as {
  modelStoragePrefixes: typeof import('../functions/src/triggers/deletePlans').modelStoragePrefixes;
  batchesToRecomputeAfterModelDelete: typeof import('../functions/src/triggers/deletePlans').batchesToRecomputeAfterModelDelete;
};

test('modelStoragePrefixes incluye la raíz del modelo y model_generations', () => {
  assert.deepEqual(modelStoragePrefixes({ modelId: 'm1', clientId: 'c1' }), [
    'models/c1/m1/',
    'model_generations/c1/m1/',
  ]);
  assert.deepEqual(modelStoragePrefixes({ modelId: 'm1', clientId: 'c1', storageRootPath: 'imports/c1/m1/' }), [
    'imports/c1/m1/',
    'models/c1/m1/',
    'model_generations/c1/m1/',
  ]);
});

test('modelStoragePrefixes ignora un storageRootPath que no termina en el modelo', () => {
  assert.deepEqual(modelStoragePrefixes({ modelId: 'm1', clientId: 'c1', storageRootPath: 'models/c1' }), [
    'models/c1/m1/',
    'model_generations/c1/m1/',
  ]);
  assert.deepEqual(modelStoragePrefixes({ modelId: 'm1', storageRootPath: 'm1' }), []);
});

test('batchesToRecomputeAfterModelDelete devuelve solo lotes mixtos, sin duplicados', () => {
  assert.deepEqual(
    batchesToRecomputeAfterModelDelete(
      [{ batchId: 'own' }, { batchId: 'mixed' }, { batchId: 'mixed' }, { batchId: null }, {}],
      ['own'],
    ),
    ['mixed'],
  );
});
