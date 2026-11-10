import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { selectCatalogPreviewPath } from '../src/features/catalog/catalogPreviewPath';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sharp: typeof import('../functions/node_modules/sharp') = require('sharp');
const thumbnails = require('./lib/functions/src/media/generatedThumbnail.js') as typeof import('../functions/src/media/generatedThumbnail');
const { extractLiveOutputPaths } = require('./lib/functions/src/triggers/deletePlans.js') as typeof import('../functions/src/triggers/deletePlans');

const png = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } }).png().toBuffer();

type Saved = { path: string; data: Buffer; options: { metadata: { contentType: string } } };
const fakeBucket = (saveError?: Error) => {
  const saved: Saved[] = [];
  return {
    saved,
    file: (path: string) => ({
      save: async (data: Buffer, options: Saved['options']) => {
        if (saveError) throw saveError;
        saved.push({ path, data, options });
      },
    }),
  };
};
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => undefined;
  try { return await fn(); } finally { console.error = original; }
};

test('la miniatura vive en la misma carpeta del job con sufijo _thumb.jpg', () => {
  assert.equal(thumbnails.buildGeneratedThumbnailPath('generated/c1/b1/j1/out1.png'), 'generated/c1/b1/j1/out1_thumb.jpg');
  assert.equal(thumbnails.buildGeneratedThumbnailPath('generated/c1/b1/j1/out1.jpg'), 'generated/c1/b1/j1/out1_thumb.jpg');
  assert.equal(thumbnails.buildGeneratedThumbnailPath('generated/c1/b1/j1/out1.webp'), 'generated/c1/b1/j1/out1_thumb.jpg');
});

test('renderiza JPEG de máximo 480 px por lado respetando proporción', async () => {
  const portrait = await sharp(await thumbnails.renderGeneratedThumbnail(await png(1536, 2048))).metadata();
  assert.equal(portrait.format, 'jpeg');
  assert.deepEqual([portrait.width, portrait.height], [360, 480]);

  const landscape = await sharp(await thumbnails.renderGeneratedThumbnail(await png(2000, 1000))).metadata();
  assert.deepEqual([landscape.width, landscape.height], [480, 240]);
});

test('no agranda imágenes pequeñas y aplana la transparencia sobre blanco', async () => {
  const small = await sharp(await thumbnails.renderGeneratedThumbnail(await png(200, 100))).metadata();
  assert.deepEqual([small.width, small.height], [200, 100]);

  const { data } = await sharp(await thumbnails.renderGeneratedThumbnail(await png(64, 64, 0))).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 245 && data[1] > 245 && data[2] > 245, `esperaba blanco, obtuve ${[...data.subarray(0, 3)]}`);
});

test('createGeneratedThumbnail sube la miniatura como image/jpeg y devuelve su ruta', async () => {
  const bucket = fakeBucket();
  const path = await thumbnails.createGeneratedThumbnail({ bucket, bytes: await png(1024, 1024), resultImagePath: 'generated/c/b/j/o.png' });
  assert.equal(path, 'generated/c/b/j/o_thumb.jpg');
  assert.equal(bucket.saved.length, 1);
  assert.equal(bucket.saved[0].path, 'generated/c/b/j/o_thumb.jpg');
  assert.equal(bucket.saved[0].options.metadata.contentType, 'image/jpeg');
  assert.ok(bucket.saved[0].data.length < 100_000);
});

test('createGeneratedThumbnail no lanza si la imagen es inválida o la subida falla', async () => {
  const invalid = fakeBucket();
  assert.equal(await quietly(() => thumbnails.createGeneratedThumbnail({ bucket: invalid, bytes: Buffer.from('no es imagen'), resultImagePath: 'generated/c/b/j/o.png' })), null);
  assert.equal(invalid.saved.length, 0);

  const failing = fakeBucket(new Error('GCS caído'));
  assert.equal(await quietly(async () => thumbnails.createGeneratedThumbnail({ bucket: failing, bytes: await png(10, 10), resultImagePath: 'generated/c/b/j/o.png' })), null);
});

test('al borrar outputs también se borran sus miniaturas', () => {
  assert.deepEqual(extractLiveOutputPaths([
    { resultImagePath: 'generated/a.png', thumbnailPath: 'generated/a_thumb.jpg' },
    { resultImagePath: 'generated/b.png' },
    { resultImagePath: 'generated/c.png', thumbnailPath: 'generated/c_thumb.jpg', storageDeletedAt: new Date() },
  ]), ['generated/a.png', 'generated/a_thumb.jpg', 'generated/b.png']);
});

test('catálogo usa la miniatura si existe y cae a la imagen completa si no', () => {
  const full = 'generated/c/b/j/o.png';
  const thumb = 'generated/c/b/j/o_thumb.jpg';
  assert.equal(selectCatalogPreviewPath({ resultImagePath: full, thumbnailPath: thumb }), thumb);
  assert.equal(selectCatalogPreviewPath({ resultImagePath: full }), full, 'jobs antiguos sin miniatura');
  assert.equal(selectCatalogPreviewPath({ resultImagePath: full, thumbnailPath: thumb }, true), full, 'miniatura no cargó');
  assert.equal(selectCatalogPreviewPath(null), null);
});
