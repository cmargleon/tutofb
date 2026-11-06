import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sharp: typeof import('../functions/node_modules/sharp') = require('sharp');
const { HttpsError } = require('firebase-functions/v2/https');
const { normalizeInputImage, MAX_INPUT_BYTES } = require('./lib/functions/src/media/normalizeInputImage.js') as typeof import('../functions/src/media/normalizeInputImage');
const small = () => sharp({ create: { width: 13, height: 7, channels: 4, background: '#22664488' } });
const rejectsImage = async (bytes: Buffer, message: string) => {
  await assert.rejects(() => normalizeInputImage(bytes), (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal((error as Error & { code: string }).code, 'invalid-argument');
    assert.equal((error as Error).message, message);
    return true;
  });
};

test('normalization imports and runs with no Firebase app, Storage or Drive initialization', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    globalThis.fetch = () => { throw new Error('Unexpected network request'); };
    const { normalizeInputImage } = require(${JSON.stringify(require.resolve('./lib/functions/src/media/normalizeInputImage.js'))});
    const { getApps } = require(${JSON.stringify(require.resolve('firebase-admin/app'))});
    assert.equal(getApps().length, 0);
    const loaded = Object.keys(require.cache);
    assert.ok(!loaded.some(file => /[/]functions[/]src[/](automation|organizer|firebase)[/]|@google-cloud[/]storage/.test(file)));
    const sharp = require(${JSON.stringify(require.resolve('sharp'))});
    (async () => {
      const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
      assert.equal((await sharp(await normalizeInputImage(bytes)).metadata()).format, 'jpeg');
      assert.equal(getApps().length, 0);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('JPEG, PNG and WebP become small JPEGs without enlargement, alpha or metadata', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const output = await normalizeInputImage(await small()[format]().toBuffer());
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 13);
    assert.equal(metadata.height, 7);
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
    assert.equal(metadata.hasProfile, false);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    // Baseline luminance quantization entries from the existing quality-94 JPEG output.
    const quantization = output.indexOf(Buffer.from([0xff, 0xdb]));
    assert.notEqual(quantization, -1);
    assert.deepEqual([...output.subarray(quantization + 5, quantization + 13)], [2, 1, 1, 2, 1, 1, 2, 2]);
  }
});

test('auto-orients EXIF before fitting inside 2200x2200 and preserves aspect ratio', async () => {
  const image = sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#663322' } });
  const oriented = await normalizeInputImage(await image.clone().jpeg().withMetadata({ orientation: 6 }).toBuffer());
  const wide = await normalizeInputImage(await image.png().toBuffer());
  const portrait = await sharp(oriented).metadata();
  const landscape = await sharp(wide).metadata();
  assert.deepEqual([portrait.width, portrait.height], [733, 2200]);
  assert.deepEqual([landscape.width, landscape.height], [2200, 733]);
  assert.equal(portrait.orientation, undefined);
  assert.equal(portrait.exif, undefined);
});

test('rejects empty input and exactly 10 MiB, but accepts a valid image one byte below', async () => {
  assert.equal(MAX_INPUT_BYTES, 10_485_760);
  const png = await small().png().toBuffer();
  const padded = Buffer.concat([png, Buffer.alloc(MAX_INPUT_BYTES - png.length)]);
  await rejectsImage(Buffer.alloc(0), 'Imagen vacía o de más de 10 MB.');
  await rejectsImage(padded, 'Imagen vacía o de más de 10 MB.');
  await rejectsImage(Buffer.concat([padded, Buffer.alloc(1)]), 'Imagen vacía o de más de 10 MB.');
  assert.deepEqual(await normalizeInputImage(padded.subarray(0, MAX_INPUT_BYTES - 1)), await normalizeInputImage(png));
});

test('preserves public errors for unsupported formats and damaged recognized signatures', async () => {
  for (const bytes of [Buffer.from('not-image'), Buffer.from('<svg/>'), await small().gif().toBuffer()]) {
    await rejectsImage(bytes, 'Usa una fotografía JPEG, PNG o WebP.');
  }
  const jpeg = await small().jpeg().toBuffer();
  const png = await small().png().toBuffer();
  const webp = await small().webp().toBuffer();
  for (const bytes of [jpeg.subarray(0, 3), png.subarray(0, 8), webp.subarray(0, 12)]) {
    await rejectsImage(bytes, 'Archivo de imagen no compatible.');
  }
});

test('accepts exactly 40 million pixels and rejects larger decoded images', async () => {
  const image = (height: number) => sharp({ create: { width: 8000, height, channels: 3, background: '#226644' } }).png().toBuffer();
  const metadata = await sharp(await normalizeInputImage(await image(5000))).metadata();
  assert.deepEqual([metadata.width, metadata.height], [2200, 1375]);
  await rejectsImage(await image(5001), 'Archivo de imagen no compatible.');
});

test('legacy exports retain identity and Drive no longer depends on automation/imports', () => {
  const importsPath = require.resolve('./lib/functions/src/automation/imports.js');
  const legacy = require(importsPath);
  assert.equal(legacy.normalizeInputImage, normalizeInputImage);
  assert.equal(legacy.MAX_INPUT_BYTES, MAX_INPUT_BYTES);
  const drive = require.cache[require.resolve('./lib/functions/src/automation/drive.js')]!;
  const seen = new Set<string>();
  const visit = (module: NodeJS.Module) => {
    if (seen.has(module.id)) return;
    seen.add(module.id);
    for (const child of module.children) visit(child);
  };
  visit(drive);
  assert.ok(!seen.has(importsPath), 'Drive must not import automation/imports, directly or transitively');
});
