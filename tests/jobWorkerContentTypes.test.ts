import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extensionForContentType, mimeTypeFromStoragePath } = require('../functions/lib/functions/src/workers/jobWorker.helpers.js') as typeof import('../functions/src/workers/jobWorker.helpers');

test('extensionForContentType maps jpeg and webp and defaults to png', () => {
  assert.equal(extensionForContentType('image/jpeg'), 'jpg');
  assert.equal(extensionForContentType('image/webp'), 'webp');
  assert.equal(extensionForContentType('image/png'), 'png');
  assert.equal(extensionForContentType('application/octet-stream'), 'png');
});

test('mimeTypeFromStoragePath is case-insensitive and defaults to png', () => {
  assert.equal(mimeTypeFromStoragePath('garments/a/B.JPG'), 'image/jpeg');
  assert.equal(mimeTypeFromStoragePath('garments/a/b.jpeg'), 'image/jpeg');
  assert.equal(mimeTypeFromStoragePath('poses/x.webp'), 'image/webp');
  assert.equal(mimeTypeFromStoragePath('poses/x.gif'), 'image/png');
});
