import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sharp: typeof import('../functions/node_modules/sharp') = require('sharp');
// Optional original snapshot lets the same characterization run before and after extraction.
const modulePath = process.env.COMPRESSION_CHARACTERIZATION_MODULE
  || require.resolve('./lib/functions/src/media/compressGeneratedImage.js');
const { compressGeneratedImageIfNeeded: compress } = require(modulePath) as {
  compressGeneratedImageIfNeeded: (image: { bytes: Buffer; contentType: string }) => Promise<{ bytes: Buffer; contentType: string }>;
};
const limit = 3 * 1024 * 1024;
const report: Record<string, unknown> = {};
after(() => {
  if (process.env.COMPRESSION_CHARACTERIZATION_REPORT) {
    writeFileSync(process.env.COMPRESSION_CHARACTERIZATION_REPORT, JSON.stringify(report, null, 2));
  }
});
const record = async (name: string, image: Awaited<ReturnType<typeof compress>>) => {
  const metadata = await sharp(image.bytes).metadata();
  report[name] = {
    bytes: image.bytes.length, contentType: image.contentType,
    sha256: createHash('sha256').update(image.bytes).digest('hex'),
    width: metadata.width, height: metadata.height, format: metadata.format,
    orientation: metadata.orientation ?? null, hasAlpha: metadata.hasAlpha,
  };
};
const pad = (bytes: Buffer, length: number) => Buffer.concat([bytes, Buffer.alloc(length - bytes.length)]);
const small = () => sharp({ create: { width: 13, height: 7, channels: 4, background: '#22664488' } });
const noise = (width: number, height: number) => {
  let seed = 42;
  const bytes = Buffer.alloc(width * height * 3);
  for (let i = 0; i < bytes.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    bytes[i] = seed & 255;
  }
  return sharp(bytes, { raw: { width, height, channels: 3 } });
};

test('imports and compresses without Firebase, bucket, budget, provider or network access', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    globalThis.fetch = () => { throw new Error('Unexpected network request'); };
    const { compressGeneratedImageIfNeeded } = require(${JSON.stringify(modulePath)});
    assert.ok(!Object.keys(require.cache).some(file => /firebase|@google-cloud|[/](automation|providers|manglar)[/]/.test(file)));
    const sharp = require(${JSON.stringify(require.resolve('sharp'))});
    (async () => {
      const png = await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
      const bytes = Buffer.concat([png, Buffer.alloc(${limit + 1} - png.length)]);
      const result = await compressGeneratedImageIfNeeded({ bytes, contentType: 'image/png' });
      assert.equal(result.contentType, 'image/jpeg');
      assert.equal((await sharp(result.bytes).metadata()).format, 'jpeg');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('JPEG, PNG and WebP preserve the original bytes and MIME below and at 3 MiB', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const image = await small()[format]().withMetadata({ orientation: 6 }).toBuffer();
    for (const [name, bytes] of [['small', image], ['below', pad(image, limit - 1)], ['at', pad(image, limit)]] as const) {
      const result = await compress({ bytes, contentType: `image/${format}` });
      assert.equal(result.bytes, bytes);
      assert.equal(result.contentType, `image/${format}`);
      await record(`${format}-${name}`, result);
    }
  }
});

test('one byte above 3 MiB converts each accepted format to the first quality-90 JPEG without enlargement', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const original = await small()[format]().toBuffer();
    const bytes = pad(original, limit + 1);
    const result = await compress({ bytes, contentType: `image/${format}` });
    const expected = await sharp(bytes, { failOn: 'none' }).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    assert.deepEqual(result.bytes, expected);
    assert.equal(result.contentType, 'image/jpeg');
    const metadata = await sharp(result.bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height, metadata.hasAlpha], [13, 7, false]);
    await record(`${format}-above`, result);
  }
});

test('un-padded noisy PNG, WebP and JPEG exercise resizing and falling through to quality-82', async () => {
  for (const side of [2200, 2400]) {
    const image = noise(side, side);
    for (const format of ['png', 'webp', 'jpeg'] as const) {
      const bytes = await (format === 'webp' ? image.clone().webp({ lossless: true })
        : format === 'jpeg' ? image.clone().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }) : image.clone().png()).toBuffer();
      assert.ok(bytes.length > limit);
      const pipeline = () => sharp(bytes, { failOn: 'none' }).rotate().resize({ width: 2200, fit: 'inside', withoutEnlargement: true });
      const quality90 = await pipeline().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      const needsLowerQuality = side === 2200 || format !== 'webp';
      assert.equal(quality90.length > limit, needsLowerQuality, `${format}-${side}`);
      const expected = needsLowerQuality ? await pipeline().jpeg({ quality: 82, mozjpeg: true }).toBuffer() : quality90;
      assert.ok(expected.length <= limit);
      const result = await compress({ bytes, contentType: `image/${format}` });
      assert.deepEqual(result.bytes, expected);
      assert.equal(result.contentType, 'image/jpeg');
      await record(`${format}-noise-${side}`, result);
    }
  }
});

test('preserves current landscape, portrait, square and EXIF resize-axis behavior', async () => {
  for (const [name, width, height, orientation, expectedWidth, expectedHeight] of [
    ['landscape', 3000, 1000, 1, 2200, 733],
    ['portrait', 1000, 3000, 1, 733, 2200],
    ['square', 2400, 2400, 1, 2200, 2200],
    // The existing axis is selected from encoded dimensions, before auto-orientation.
    ['rotated-landscape', 3000, 1000, 6, 1000, 3000],
    ['rotated-portrait', 1000, 3000, 8, 3000, 1000],
  ] as const) {
    const original = await sharp({ create: { width, height, channels: 3, background: '#663322' } })
      .jpeg().withMetadata({ orientation }).toBuffer();
    const result = await compress({ bytes: pad(original, limit + 1), contentType: 'image/jpeg' });
    const metadata = await sharp(result.bytes).metadata();
    assert.deepEqual([metadata.width, metadata.height], [expectedWidth, expectedHeight]);
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    await record(name, result);
  }
});

test('undersized opaque bytes bypass decoding; oversized invalid images still reject', async () => {
  const bytes = Buffer.from('not an image');
  assert.deepEqual(await compress({ bytes, contentType: 'image/custom' }), { bytes, contentType: 'image/custom' });
  await assert.rejects(() => compress({ bytes: pad(bytes, limit + 1), contentType: 'image/png' }), /unsupported image format/i);
});

// Force otherwise impractical encoder outcomes without mocking any business services.
const controlledEncoder = (metadata: { width?: number; height?: number }, candidates: Buffer[]) => {
  const attempts: { resize?: unknown; jpeg?: unknown }[] = [];
  let rotations = 0;
  const fakeSharp = (_bytes: Buffer, options: unknown) => {
    assert.deepEqual(structuredClone(options), { failOn: 'none' });
    const attempt: typeof attempts[number] = {};
    const pipeline = {
      rotate: () => { rotations++; return pipeline; },
      metadata: async () => metadata,
      resize: (options: unknown) => { attempt.resize = structuredClone(options); return pipeline; },
      jpeg: (options: unknown) => { attempt.jpeg = structuredClone(options); return pipeline; },
      toBuffer: async () => { attempts.push(attempt); return candidates[Math.min(attempts.length - 1, candidates.length - 1)]; },
    };
    return pipeline;
  };
  const module = { exports: {} as { compressGeneratedImageIfNeeded: typeof compress } };
  // CommonJS wrapper permits injection at Sharp's boundary, isolated from the real module cache.
  const wrapper = runInNewContext(`(function(require, module, exports) { ${readFileSync(modulePath, 'utf8')}\n})`, { Buffer });
  wrapper((id: string) => {
    assert.ok(id === 'sharp' || id === require.resolve('sharp'), id);
    return fakeSharp;
  }, module, module.exports);
  return { compress: module.exports.compressGeneratedImageIfNeeded, attempts, rotations: () => rotations };
};

test('tries qualities 90,82,74,66,58,50 within each scale 2200..1000 and returns the first fitting candidate', async () => {
  const oversized = Buffer.alloc(limit + 1);
  const fitting = Buffer.alloc(limit);
  const input = { bytes: Buffer.alloc(limit + 2), contentType: 'image/webp' };
  const sizes = [2200, 2000, 1800, 1600, 1400, 1200, 1000];
  const qualities = [90, 82, 74, 66, 58, 50];
  // Every quality and every scale can be the first success, including the last candidate.
  for (let success = 0; success < 42; success++) {
    const encoder = controlledEncoder({ width: 3000, height: 4000 }, [...Array(success).fill(oversized), fitting]);
    const result = await encoder.compress(input);
    assert.equal(result.bytes, fitting);
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(encoder.attempts.length, success + 1);
    assert.equal(encoder.rotations(), success + 2);
    encoder.attempts.forEach((attempt, i) => {
      assert.deepEqual(attempt.jpeg, { quality: qualities[i % 6], mozjpeg: true });
      assert.deepEqual(attempt.resize, { width: undefined, height: sizes[Math.floor(i / 6)], fit: 'inside', withoutEnlargement: true });
    });
  }
});

test('after exhausting candidates chooses the smallest only if strictly smaller, otherwise preserves original bytes and MIME', async () => {
  const bytes = Buffer.alloc(limit + 100);
  const cases: [string, Buffer[], number][] = [
    ['smaller', [Buffer.alloc(limit + 50), Buffer.alloc(limit + 10), Buffer.alloc(limit + 30)], 1],
    ['equal', [Buffer.alloc(bytes.length)], -1],
    ['larger', [Buffer.alloc(bytes.length + 1)], -1],
  ];
  for (const [name, candidates, expected] of cases) {
    const encoder = controlledEncoder({}, candidates);
    const result = await encoder.compress({ bytes, contentType: 'image/png' });
    assert.equal(encoder.attempts.length, 42, name);
    assert.ok(encoder.attempts.every((attempt) => attempt.resize === undefined));
    assert.equal(result.bytes, expected < 0 ? bytes : candidates[expected], name);
    assert.equal(result.contentType, expected < 0 ? 'image/png' : 'image/jpeg', name);
  }
});

test('only resizes scales smaller than the known longest side, including landscape and missing dimensions', async () => {
  for (const metadata of [{ width: 2000, height: 1000 }, { width: 600, height: 400 }, { width: 1500 }, { height: 1500 }]) {
    const encoder = controlledEncoder(metadata, [Buffer.alloc(limit + 1)]);
    await encoder.compress({ bytes: Buffer.alloc(limit + 2), contentType: 'image/png' });
    const longest = Math.max(metadata.width || 0, metadata.height || 0);
    for (const [index, attempt] of encoder.attempts.entries()) {
      const side = [2200, 2000, 1800, 1600, 1400, 1200, 1000][Math.floor(index / 6)];
      assert.deepEqual(attempt.resize, side < longest ? {
        width: (metadata.width || 0) >= (metadata.height || 0) ? side : undefined,
        height: (metadata.height || 0) > (metadata.width || 0) ? side : undefined,
        fit: 'inside', withoutEnlargement: true,
      } : undefined);
    }
  }
});
