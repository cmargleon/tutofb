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
    if (id.endsWith('shared/src/commercialPhoto')) return require('./lib/shared/src/commercialPhoto.js');
    if (id.endsWith('shared/src/providerImageConfig')) return require('./lib/shared/src/providerImageConfig.js');
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

const commercial = require(modulePath).compressGeneratedImageIfNeeded as typeof import('../functions/src/media/compressGeneratedImage').compressGeneratedImageIfNeeded;
const profile = 'commercial-photo-v1' as const;
test('commercial profile normalizes small PNG/WebP/JPEG, bounds geometry and records actual metadata despite incorrect MIME', async () => {
  for (const [width, height] of [[1536, 2048], [2048, 2048], [2048, 1536], [13, 7], [3000, 1000]]) {
    for (const format of ['png', 'webp', 'jpeg'] as const) {
      const source = await sharp({ create: { width, height, channels: 4, background: '#66332200' } })[format]().toBuffer();
      const result = await commercial({ bytes: source, contentType: 'image/wrong', photoProfile: profile,
        imageConfig: { provider: 'fal-gpt-image-2.5-flare', imageSize: { width: 1536, height: 2048 }, quality: 'medium', outputFormat: 'png' } });
      const metadata = await sharp(result.bytes).metadata();
      const scale = Math.min(1, 2048 / Math.max(width, height));
      assert.deepEqual([metadata.width, metadata.height], [Math.round(width * scale), Math.round(height * scale)]);
      assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.depth, 'uchar'); assert.equal(metadata.space, 'srgb');
      assert.equal(metadata.hasAlpha, false); assert.ok(metadata.icc); assert.match(metadata.icc!.toString('ascii').replace(/\x00/g, ''), /sRGB/);
      assert.equal(metadata.orientation, undefined); assert.equal(result.contentType, 'image/jpeg'); assert.ok(result.bytes.length <= 2_800_000);
      assert.equal(result.storedImage!.sizeBytes, result.bytes.length);
      assert.equal(result.storedImage!.requestedGeometryDiffers, width !== 1536 || height !== 2048);
      if (format !== 'jpeg') { const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true }); assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]); }
    }
  }
});

test('commercial profile applies EXIF before sizing and converts P3/CMYK/16 bit inputs to tagged 8 bit sRGB', async () => {
  for (const colour of ['p3', 'cmyk', 'rgb16'] as const) {
    let pipeline = sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#996644' } });
    const source = colour === 'p3' ? await pipeline.withIccProfile('p3').jpeg().withExifMerge({ IFD0: { Orientation: '6' } }).toBuffer()
      : colour === 'cmyk' ? await pipeline.toColourspace('cmyk').jpeg().withExifMerge({ IFD0: { Orientation: '6' } }).toBuffer()
      : await pipeline.toColourspace('rgb16').png().withExifMerge({ IFD0: { Orientation: '6' } }).toBuffer();
    const sourceMeta = await sharp(source).metadata();
    const rotated = await sharp(source).rotate().toBuffer({ resolveWithObject: true });
    const result = await commercial({ bytes: source, contentType: 'image/png', photoProfile: profile });
    const m = await sharp(result.bytes).metadata();
    const scale = Math.min(1, 2048 / Math.max(rotated.info.width, rotated.info.height));
    assert.deepEqual([m.width, m.height], [Math.round(rotated.info.width * scale), Math.round(rotated.info.height * scale)]);
    assert.equal(m.depth, 'uchar'); assert.equal(m.space, 'srgb'); assert.ok(m.icc); assert.equal(m.orientation, undefined);
    if (colour === 'cmyk') assert.equal(sourceMeta.space, 'cmyk');
    if (colour === 'rgb16') assert.equal(sourceMeta.depth, 'ushort');
    if (colour === 'p3') assert.ok(sourceMeta.icc);
  }
});

test('commercial profile decodes invalid and truncated bytes even under the byte limit', async () => {
  await assert.rejects(commercial({ bytes: Buffer.from([1, 2, 3]), contentType: 'image/jpeg', photoProfile: profile }));
  const png = await small().png().toBuffer();
  await assert.rejects(commercial({ bytes: png.subarray(0, png.length - 30), contentType: 'image/png', photoProfile: profile }));
});

test('commercial adaptive encoding starts from original pixels and keeps full resolution before lowering it', async () => {
  const original = await noise(2048, 2048).png().toBuffer();
  assert.ok(original.length > 2_800_000);
  const result = await commercial({ bytes: original, contentType: 'image/png', photoProfile: profile });
  const m = await sharp(result.bytes).metadata(); assert.deepEqual([m.width, m.height], [2048, 2048]);
  assert.ok(result.bytes.length <= 2_800_000);
  for (const quality of [90, 88, 85, 82, 80]) {
    const candidate = await sharp(original, { failOn: 'warning' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').flatten({ background: '#ffffff' }).withIccProfile('srgb').jpeg({ quality, mozjpeg: true }).toBuffer();
    if (candidate.length <= 2_800_000) { assert.deepEqual(result.bytes, candidate); break; }
  }
});

test('commercial candidate order reduces size only after all qualities, avoids duplicate scales and rejects an impossible limit', async () => {
  const policy = require('./lib/shared/src/commercialPhoto.js');
  const input = Buffer.from('original pixels placeholder');
  const attempts: Array<{ size: number; quality: number }> = [];
  let successAt = 6;
  const fakeSharp = (bytes: Buffer) => {
    let size = 0, quality = 0;
    const pipeline: any = {
      rotate: () => pipeline, resize: (options: any) => { size = options.width; return pipeline; },
      toColourspace: () => pipeline, flatten: () => pipeline, withIccProfile: () => pipeline,
      jpeg: (options: any) => { quality = options.quality; return pipeline; },
      metadata: async () => bytes === input ? { width: 10, height: 10, format: 'png' } : { width: 9, height: 9, format: 'jpeg', depth: 'uchar', space: 'srgb', icc: Buffer.from('sRGB'), hasAlpha: false },
      toBuffer: async () => { assert.equal(bytes, input); attempts.push({ size, quality }); return Buffer.alloc(attempts.length === successAt ? 10 : 2_800_001); },
    };
    return pipeline;
  };
  const module = { exports: {} as typeof import('../functions/src/media/compressGeneratedImage') };
  const wrapper = runInNewContext(`(function(require, module, exports) { ${readFileSync(modulePath, 'utf8')}\n})`, { Buffer });
  wrapper((id: string) => id === 'sharp' ? fakeSharp : id.endsWith('commercialPhoto') ? policy : require('./lib/shared/src/providerImageConfig.js'), module, module.exports);
  await module.exports.compressGeneratedImageIfNeeded({ bytes: input, contentType: 'image/png', photoProfile: profile });
  assert.deepEqual(attempts, [90, 88, 85, 82, 80].map(quality => ({ size: 10, quality })).concat([{ size: 9, quality: 90 }]));
  attempts.length = 0; successAt = -1;
  await assert.rejects(module.exports.compressGeneratedImageIfNeeded({ bytes: input, contentType: 'image/png', photoProfile: profile }), /máximo absoluto/);
  const scales = attempts.filter(a => a.quality === 90).map(a => a.size);
  assert.equal(scales.length, new Set(scales).size); assert.equal(scales.at(-1), 1);
});
