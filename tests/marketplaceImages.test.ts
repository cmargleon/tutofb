import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../functions/node_modules/sharp');
const { prepareMarketplaceImage, MARKETPLACE_IMAGE_MAX_BYTES } = require('../functions/lib/functions/src/media/prepareMarketplaceImage.js');
const { safePublicImageUrl } = require('../functions/lib/shared/src/marketplaceExport/adapters.js');

test('publication produces a small RGB JPEG and preserves portrait framing for Amazon, TikTok and Mercado Libre', async () => {
  const bytes = await sharp({ create: { width: 1200, height: 1600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const original = Buffer.from(bytes);
  for (const channel of ['amazon', 'tiktok-shop', 'mercado-libre']) {
    const result = await prepareMarketplaceImage(bytes, channel);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.space, 'srgb'); assert.equal(metadata.hasAlpha, false);
    assert.equal(result.width / result.height, 3 / 4); assert.ok(result.bytes.length <= MARKETPLACE_IMAGE_MAX_BYTES);
  }
  assert.deepEqual(bytes, original);
});

test('SHEIN square publication adds white borders without cutting the top or bottom of the product', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="green"/><rect width="900" height="100" fill="red"/><rect y="1100" width="900" height="100" fill="blue"/></svg>');
  const { bytes, width, height } = await prepareMarketplaceImage(svg, 'shein');
  assert.equal(width, 1200); assert.equal(height, 1200);
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(pixel(600, 30)[0] > 220); assert.ok(pixel(600, 1170)[2] > 220);
  assert.ok(pixel(20, 600).every(value => value > 245));
});

test('unsupported TikTok aspect ratio is padded; oversized Mercado Libre images are reduced without enlargement', async () => {
  const bytes = await sharp({ create: { width: 2600, height: 1000, channels: 3, background: 'white' } }).png().toBuffer();
  const tiktok = await prepareMarketplaceImage(bytes, 'tiktok-shop'); assert.equal(tiktok.width, tiktok.height);
  const mercado = await prepareMarketplaceImage(bytes, 'mercado-libre'); assert.equal(mercado.width, 1920); assert.ok(mercado.height >= 500);
});

test('publication rejects insufficient resolution, invalid bytes and oversized inputs rather than inventing detail', async () => {
  const tiny = await sharp({ create: { width: 400, height: 600, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(prepareMarketplaceImage(tiny, 'shein'), /900 px/);
  await assert.rejects(prepareMarketplaceImage(tiny, 'tiktok-shop'), /600 px/);
  await assert.rejects(prepareMarketplaceImage(Buffer.from('not an image'), 'amazon'));
  await assert.rejects(prepareMarketplaceImage(Buffer.alloc(33 * 1024 * 1024), 'amazon'), /32 MB/);
});

test('high-entropy images stay below the upload budget and extreme panoramas retain valid canvas dimensions', async () => {
  const pixels = Buffer.alloc(2200 * 2200 * 3);
  let seed = 19;
  for (let index = 0; index < pixels.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[index] = seed >>> 24; }
  const source = await sharp(pixels, { raw: { width: 2200, height: 2200, channels: 3 } }).png().toBuffer();
  const result = await prepareMarketplaceImage(source, 'shein');
  assert.ok(result.bytes.length <= MARKETPLACE_IMAGE_MAX_BYTES); assert.equal(result.width, 2200); assert.equal(result.height, 2200);
  const panorama = await sharp({ create: { width: 9000, height: 500, channels: 3, background: 'white' } }).png().toBuffer();
  const padded = await prepareMarketplaceImage(panorama, 'amazon');
  assert.ok(Math.min(padded.width, padded.height) >= 500); assert.ok(Math.max(padded.width, padded.height) <= 2200);
});

test('Google Storage URLs require an exact product publication; arbitrary Google links remain blocked', () => {
  const url = `https://storage.googleapis.com/example-marketplace-images/images/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.jpg`;
  assert.equal(safePublicImageUrl(url), false); assert.equal(safePublicImageUrl(url, [url]), true);
  assert.equal(safePublicImageUrl(url.replace('example-', 'foreign-'), [url]), false);
  for (const invalid of [url + '?token=x', url + '#fragment', url.replace('https:', 'http:'), url.replace('images/', '../images/'), url.replace('storage.googleapis.com', 'storage.googleapis.com.attacker.test')])
    assert.equal(safePublicImageUrl(invalid, [url]), false);
});
