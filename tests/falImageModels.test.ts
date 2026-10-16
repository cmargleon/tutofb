import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Provider } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { createDefaultProviderImageConfig, createLegacyProviderImageConfig, isProviderImageConfig, cloneProviderImageConfig, resolveAspectRatioForImageConfig } = require('../functions/lib/shared/src/providerImageConfig.js') as typeof import('../shared/src/providerImageConfig');
const { PROVIDER_VALUES, MODEL_PHOTO_PROVIDER_VALUES, isProvider } = require('../functions/lib/shared/src/domain.js') as typeof import('../shared/src/domain');
const { getProviderCostUsd, getModelPhotoProviderCostUsd } = require('../functions/lib/shared/src/constants/providerCosts.js') as typeof import('../shared/src/constants/providerCosts');

const { generateWithProvider } = require('../functions/lib/functions/src/providers/index.js') as typeof import('../functions/src/providers');
const { generateSingleModelPhoto } = require('../functions/lib/functions/src/utils/modelPhotoGeneration.js') as typeof import('../functions/src/utils/modelPhotoGeneration');
const { validateAutomationInput } = require('../functions/lib/functions/src/automation/domain.js') as typeof import('../functions/src/automation/domain');
const { resolveAutomationPreset } = require('../functions/lib/functions/src/automation/presets.js') as typeof import('../functions/src/automation/presets');
const endpoints = [
  ['fal-gpt-image-2.5-sunburst', 'openai/gpt-image-2.5/sunburst/text-to-image', 'openai/gpt-image-2.5/sunburst/edit'],
  ['fal-gpt-image-2.5-flare', 'openai/gpt-image-2.5/flare/text-to-image', 'openai/gpt-image-2.5/flare/edit'],
  ['fal-seedream-5-pro', 'bytedance/seedream/v5/pro/text-to-image', 'bytedance/seedream/v5/pro/edit'],
  ['fal-seedream-5-flash', 'bytedance/seedream/v5/flash/text-to-image', 'bytedance/seedream/v5/flash/edit'],
  ['fal-flux-2-edit', 'fal-ai/flux-2', 'fal-ai/flux-2/edit'],
] as const;

test('five fal models are selectable in every catalog and their configs survive normalization', () => {
  assert.equal(isProvider('openai-gpt-image-1.5'), false);
  assert.equal(MODEL_PHOTO_PROVIDER_VALUES.includes('openai-dalle'), false);
  for (const [provider] of endpoints) {
    assert.ok(PROVIDER_VALUES.includes(provider));
    assert.ok(MODEL_PHOTO_PROVIDER_VALUES.includes(provider));
    const config = createDefaultProviderImageConfig(provider);
    assert.ok(isProviderImageConfig(config));
    assert.deepEqual(cloneProviderImageConfig(config), config);
    for (const ratio of ['1:1', '3:4', '16:9'] as const) {
      const legacy = createLegacyProviderImageConfig(provider, ratio);
      assert.ok(isProviderImageConfig(legacy));
      assert.equal(resolveAspectRatioForImageConfig(legacy), ratio);
    }
    assert.ok(getProviderCostUsd(provider, config) > 0);
    assert.ok(getModelPhotoProviderCostUsd(provider, config) > 0);
  }
});

test('model-specific limits reject incompatible sizes and quality levels', () => {
  const config = (provider: Provider, extra: object) => ({ ...createDefaultProviderImageConfig(provider), ...extra });
  assert.equal(isProviderImageConfig(config('fal-gpt-image-2.5-sunburst', { quality: 'max' })), true);
  assert.equal(isProviderImageConfig(config('fal-gpt-image-2', { quality: 'max' })), false);
  assert.equal(isProviderImageConfig(config('fal-gpt-image-2.5-flare', { imageSize: { width: 1025, height: 1024 } })), false);
  for (const provider of ['fal-seedream-5-pro', 'fal-seedream-5-flash'] as const) {
    assert.equal(isProviderImageConfig(config(provider, { imageSize: 'auto_1K' })), true);
    assert.equal(isProviderImageConfig(config(provider, { imageSize: 'auto_3K' })), false);
    assert.equal(isProviderImageConfig(config(provider, { imageSize: { width: 2048, height: 2048 } })), true);
    assert.equal(isProviderImageConfig(config(provider, { imageSize: { width: 3072, height: 3072 } })), false);
    assert.equal(isProviderImageConfig(config(provider, { imageSize: { width: 512, height: 512 } })), false);
  }
  assert.equal(isProviderImageConfig(config('fal-flux-2-edit', { imageSize: 'auto' })), false);
  assert.equal(isProviderImageConfig(config('fal-flux-2-edit', { imageSize: { width: 4096, height: 1024 } })), false);
});

test('batch generation and model creation/editing submit every new model only to fal.ai', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === 'POST') return Response.json({ request_id: 'request-1', status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/result' });
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.endsWith('/result')) return Response.json({ images: [{ url: 'https://images.example/result.png', content_type: 'image/png' }] });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    for (const [provider, generate, edit] of endpoints) {
      const imageConfig = createDefaultProviderImageConfig(provider);
      const before = calls.length;
      const result = await generateWithProvider(provider, { imageConfig, prompt: 'Preserve identity', poseImageUrl: 'https://images.example/pose.png', garmentImageUrl: 'https://images.example/garment.png', signal: AbortSignal.timeout(1000) }, { falKey: 'test-fal' });
      assert.equal(result.provider, provider);
      assert.deepEqual([...result.imageBytes], [1, 2, 3]);
      assert.equal(calls[before].url, `https://queue.fal.run/${edit}`);
      assert.deepEqual(JSON.parse(calls[before].init!.body as string).image_urls, ['https://images.example/pose.png', 'https://images.example/garment.png']);
      for (const referenceImageUrl of [null, 'https://images.example/identity.png']) {
        const start = calls.length;
        await generateSingleModelPhoto({ provider, imageConfig, prompt: 'A fashion model', falKey: 'test-fal', referenceImageUrl });
        assert.equal(calls[start].url, `https://queue.fal.run/${referenceImageUrl ? edit : generate}`);
        const body = JSON.parse(calls[start].init!.body as string);
        assert.equal(body.prompt, 'A fashion model');
        assert.equal(body.num_images, 1);
        assert.equal(body.image_size, 'portrait_4_3');
        assert.deepEqual(body.image_urls, referenceImageUrl ? [referenceImageUrl] : undefined);
        assert.equal((calls[start].init!.headers as Record<string, string>).Authorization, 'Key test-fal');
      }
    }
    const config = createDefaultProviderImageConfig('fal-flux-2-edit');
    const count = calls.length;
    await assert.rejects(generateWithProvider('fal-flux-2-edit', { imageConfig: config, prompt: 'test', poseImageUrl: '', garmentImageUrl: '', referenceImageUrls: Array(5).fill('https://example.com/ref.png'), signal: AbortSignal.timeout(1000) }, { falKey: 'test-fal' }), /máximo 4/);
    await assert.rejects(generateSingleModelPhoto({ provider: 'openai-dalle', prompt: 'test', imageConfig: createDefaultProviderImageConfig('openai-gpt-image-1.5'), falKey: 'test-fal' }), /no reconocido/);
    assert.equal(calls.length, count);
  } finally { globalThis.fetch = originalFetch; }
});

test('automation accepts all new models, overrides preset provider and rejects direct OpenAI', () => {
  const input = { source: 'manual', jobType: 'product', clientId: 'client', externalId: 'unique', inputImages: [{ itemId: 'item', fileName: 'photo.jpg', storagePath: 'garments/drafts/user/draft/photo.jpg' }] };
  for (const [provider] of endpoints) {
    const validated = validateAutomationInput({ ...input, provider }, 'user');
    assert.equal(validated.provider, provider);
    assert.equal(resolveAutomationPreset(validated, { automation: { presets: { generic_product: { provider: 'fal-banana-pro' } } } } as any).config.provider, provider);
  }
  assert.throws(() => validateAutomationInput({ ...input, provider: 'openai-gpt-image-1.5' }, 'user'), /fal.ai/);
});
