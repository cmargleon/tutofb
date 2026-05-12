import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { generateWithProvider } = require('../functions/lib/functions/src/providers/index.js') as {
  generateWithProvider: typeof import('../functions/src/providers').generateWithProvider;
};
const { mapAspectRatioToSeedreamSize } = require('../functions/lib/functions/src/providers/fal.js') as {
  mapAspectRatioToSeedreamSize: typeof import('../functions/src/providers/fal').mapAspectRatioToSeedreamSize;
};
const { mapAspectRatioToOpenAISize } = require('../functions/lib/functions/src/providers/openai.js') as {
  mapAspectRatioToOpenAISize: typeof import('../functions/src/providers/openai').mapAspectRatioToOpenAISize;
};
const { normalizeProviderImageConfig } = require('../functions/lib/shared/src/providerImageConfig.js') as {
  normalizeProviderImageConfig: typeof import('../shared/src/providerImageConfig').normalizeProviderImageConfig;
};

test('mapea aspect ratios de seedream y openai como espera el worker', () => {
  assert.equal(mapAspectRatioToSeedreamSize('1:1'), 'square_hd');
  assert.equal(mapAspectRatioToSeedreamSize('16:9'), 'landscape_16_9');
  assert.equal(mapAspectRatioToSeedreamSize('3:4'), 'portrait_4_3');

  assert.equal(mapAspectRatioToOpenAISize('1:1'), '1024x1024');
  assert.equal(mapAspectRatioToOpenAISize('16:9'), '1536x1024');
  assert.equal(mapAspectRatioToOpenAISize('3:4'), '1024x1536');
});

test('normaliza configuraciones por proveedor a un payload real de API', () => {
  const seedream = normalizeProviderImageConfig('fal-seedream', {
    provider: 'fal-seedream',
    imageSize: 'portrait_16_9',
  });
  assert.equal(seedream.aspectRatio, '9:16');

  const banana = normalizeProviderImageConfig('fal-banana-pro', {
    provider: 'fal-banana-pro',
    aspectRatio: '5:4',
    resolution: '2K',
  });
  assert.equal(banana.aspectRatio, '4:3');

  const openai = normalizeProviderImageConfig('openai-gpt-image-1.5', {
    provider: 'openai-gpt-image-1.5',
    size: '1024x1536',
    quality: 'high',
  });
  assert.equal(openai.aspectRatio, '2:3');

  const gptImage2 = normalizeProviderImageConfig('fal-gpt-image-2', {
    provider: 'fal-gpt-image-2',
    imageSize: { width: 1280, height: 720 },
    quality: 'high',
    outputFormat: 'webp',
  });
  assert.equal(gptImage2.aspectRatio, '16:9');
  assert.equal(gptImage2.imageConfig.provider, 'fal-gpt-image-2');
});

test('generateWithProvider valida secretos antes de intentar salir a red', async () => {
  await assert.rejects(
    () =>
      generateWithProvider(
        'fal-seedream',
        {
          poseImageUrl: 'https://example.com/pose.jpg',
          garmentImageUrl: 'https://example.com/garment.jpg',
          prompt: 'hola',
          imageConfig: {
            provider: 'fal-seedream',
            imageSize: 'portrait_4_3',
          },
          signal: AbortSignal.timeout(10),
        },
        {},
      ),
    /FAL_KEY/,
  );

  await assert.rejects(
    () =>
      generateWithProvider(
        'openai-gpt-image-1.5',
        {
          poseImageUrl: 'https://example.com/pose.jpg',
          garmentImageUrl: 'https://example.com/garment.jpg',
          prompt: 'hola',
          imageConfig: {
            provider: 'openai-gpt-image-1.5',
            size: '1024x1536',
            quality: 'medium',
          },
          signal: AbortSignal.timeout(10),
        },
        {},
      ),
    /OPENAI_API_KEY/,
  );

  await assert.rejects(
    () =>
      generateWithProvider(
        'fal-gpt-image-2',
        {
          poseImageUrl: 'https://example.com/pose.jpg',
          garmentImageUrl: 'https://example.com/garment.jpg',
          prompt: 'hola',
          imageConfig: {
            provider: 'fal-gpt-image-2',
            imageSize: 'portrait_4_3',
            quality: 'medium',
            outputFormat: 'png',
          },
          signal: AbortSignal.timeout(10),
        },
        {},
      ),
    /FAL_KEY/,
  );
});
