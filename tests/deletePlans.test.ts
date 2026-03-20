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
