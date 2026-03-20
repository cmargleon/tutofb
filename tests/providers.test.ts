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

test('mapea aspect ratios de seedream y openai como espera el worker', () => {
  assert.equal(mapAspectRatioToSeedreamSize('1:1'), 'square_hd');
  assert.equal(mapAspectRatioToSeedreamSize('16:9'), 'landscape_16_9');
  assert.equal(mapAspectRatioToSeedreamSize('3:4'), 'portrait_16_9');

  assert.equal(mapAspectRatioToOpenAISize('1:1'), '1024x1024');
  assert.equal(mapAspectRatioToOpenAISize('16:9'), '1536x1024');
  assert.equal(mapAspectRatioToOpenAISize('3:4'), '1024x1536');
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
          aspectRatio: '3:4',
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
          aspectRatio: '3:4',
          signal: AbortSignal.timeout(10),
        },
        {},
      ),
    /OPENAI_API_KEY/,
  );
});
