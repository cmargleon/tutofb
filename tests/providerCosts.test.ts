import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { Provider, ProviderImageConfig } from '../shared/src/types';
const require = createRequire(import.meta.url);
const { getProviderCostEstimate: estimate, getProviderCostUsd, getModelPhotoProviderCostUsd, PROVIDER_PRICING_SOURCES } = require('../functions/lib/shared/src/constants/providerCosts.js') as typeof import('../shared/src/constants/providerCosts');
const { createDefaultProviderImageConfig } = require('../functions/lib/shared/src/providerImageConfig.js') as typeof import('../shared/src/providerImageConfig');
const { PROVIDER_VALUES, MODEL_PHOTO_PROVIDER_HINTS } = require('../functions/lib/shared/src/domain.js') as typeof import('../shared/src/domain');
const { estimateGenerationHold, GEMINI_OPERATION_HOLD_USD } = require('../functions/lib/functions/src/costs/generationEstimates.js') as typeof import('../functions/src/costs/generationEstimates');

test('backend holds preserve rate classification, reference handling and historical configs', () => {
  const fixedProviders: Record<Provider, boolean> = {
    'fal-seedream': true, 'fal-banana-pro': true, 'fal-nano-banana-2': true,
    'fal-seedream-5': true, 'fal-seedream-5-flash': true,
    'openai-gpt-image-1.5': false, 'fal-gpt-image-2': false,
    'fal-gpt-image-2.5-flare': false, 'fal-gpt-image-2.5-sunburst': false,
    'fal-seedream-5-pro': false, 'fal-flux-2-edit': false,
  };
  for (const provider of PROVIDER_VALUES) {
    // Persisted configs may be absent or still belong to a previous provider.
    const configs = [createDefaultProviderImageConfig(provider), undefined, null,
      createDefaultProviderImageConfig(provider === 'fal-seedream' ? 'fal-gpt-image-2' : 'fal-seedream')];
    for (const config of configs) {
      for (const references of [0, 1, 2, 5, 20, 2.9, -1, NaN, Infinity]) {
        const estimateUsd = getProviderCostUsd(provider, config, references);
        const fixed = fixedProviders[provider];
        assert.deepEqual(estimateGenerationHold(provider, config as ProviderImageConfig, references), {
          estimateUsd, holdUsd: fixed ? estimateUsd : Math.max(0.5, estimateUsd * 4), fixed,
        }, `${provider}, ${JSON.stringify(config)}, references=${references}`);
      }
    }
  }
  assert.equal(GEMINI_OPERATION_HOLD_USD, 0.05);
});

test('backend holds retain exact estimates, rounding, minimum and multiplier for nondefault options', () => {
  const cases: Array<[ProviderImageConfig, number, number, number, boolean]> = [
    [{ provider: 'fal-banana-pro', resolution: '4K', aspectRatio: '3:4' }, 5, .3, .3, true],
    [{ provider: 'fal-nano-banana-2', resolution: '0.5K', aspectRatio: '3:4' }, 0, .06, .06, true],
    [{ provider: 'openai-gpt-image-1.5', size: '1024x1536', quality: 'high' }, 0, .25, 1, false],
    [{ provider: 'fal-gpt-image-2', imageSize: { width: 1297, height: 733 }, quality: 'high', outputFormat: 'png' }, 15, .19694, .78776, false],
    [{ provider: 'fal-gpt-image-2.5-flare', imageSize: 'auto', quality: 'auto', outputFormat: 'png' }, 2, .1168, .5, false],
    [{ provider: 'fal-gpt-image-2.5-sunburst', imageSize: 'square_hd', quality: 'max', outputFormat: 'webp' }, 1, .0611, .5, false],
    [{ provider: 'fal-seedream-5-pro', imageSize: 'auto_2K' }, 2, .1395, .558, false],
    [{ provider: 'fal-flux-2-edit', imageSize: { width: 2049, height: 2048 } }, 10, .18, .72, false],
  ];
  for (const [config, references, estimateUsd, holdUsd, fixed] of cases) {
    assert.deepEqual(estimateGenerationHold(config.provider, config, references), { estimateUsd, holdUsd, fixed });
  }
});

test('backend estimation imports without loading or initializing Firebase', () => {
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(id, ...args) {
      assert.ok(!id.includes('firebase'), 'Estimation must not load Firebase: ' + id);
      return load.call(this, id, ...args);
    };
    const costs = require(${JSON.stringify(require.resolve('../functions/lib/functions/src/costs/generationEstimates.js'))});
    assert.deepEqual(costs.estimateGenerationHold('fal-seedream', { provider: 'fal-seedream', imageSize: 'auto_2K' }, 2),
      { estimateUsd: .04, holdUsd: .04, fixed: true });
    assert.equal(costs.GEMINI_OPERATION_HOLD_USD, .05);
  `], { stdio: 'pipe' });
});

test('automation budget keeps compatible estimate exports', () => {
  const legacy = require('../functions/lib/functions/src/automation/budget.js');
  assert.equal(legacy.estimateGenerationHold, estimateGenerationHold);
  assert.equal(legacy.GEMINI_OPERATION_HOLD_USD, GEMINI_OPERATION_HOLD_USD);
});

test('resolution based prices match the published Banana rate cards', () => {
  for (const [resolution, usd] of [['0.5K', .06], ['1K', .08], ['2K', .12], ['4K', .16]] as const) {
    assert.equal(getProviderCostUsd('fal-nano-banana-2', { provider: 'fal-nano-banana-2', resolution, aspectRatio: '3:4' }), usd);
  }
  for (const [resolution, usd] of [['1K', .15], ['2K', .15], ['4K', .3]] as const) {
    assert.equal(getProviderCostUsd('fal-banana-pro', { provider: 'fal-banana-pro', resolution, aspectRatio: '3:4' }), usd);
  }
});

test('GPT canonical prices, rotations, references and per-image custom estimates', () => {
  for (const [provider, medium, high] of [['fal-gpt-image-2', .037, .401], ['fal-gpt-image-2.5-flare', .0091, .1002], ['fal-gpt-image-2.5-sunburst', .0091, .1002]] as const) {
    const config = { provider, imageSize: 'portrait_4_3', quality: 'medium', outputFormat: 'png' } as const;
    assert.equal(getProviderCostUsd(provider, config, 0), medium);
    assert.equal(getProviderCostUsd(provider, { ...config, imageSize: 'landscape_4_3' }, 0), medium);
    assert.equal(getProviderCostUsd(provider, config, 2), Math.round((medium + .0166) * 1e6) / 1e6);
    assert.equal(getProviderCostUsd(provider, { ...config, quality: 'high', imageSize: { width: 3840, height: 2160 } }, 0), high);
    assert.equal(getProviderCostUsd(provider, { ...config, outputFormat: 'webp' }, 0), medium);
    const custom = estimate(provider, { ...config, imageSize: { width: 2048, height: 2048 } }, 0);
    assert.match(custom.note, /aproximación por área/);
    assert.ok(custom.estimatedUsd > medium);
  }
});

test('automatic choices show ranges and unpublished quality prices have no false ceiling', () => {
  const config = { provider: 'fal-gpt-image-2.5-flare', imageSize: 'auto', quality: 'auto', outputFormat: 'png' } as const;
  const auto = estimate(config.provider, config, 0);
  assert.equal(auto.minUsd, .0041);
  assert.equal(auto.maxUsd, .1002);
  for (const quality of ['xhigh', 'max'] as const) {
    for (const imageSize of ['auto', 'square_hd'] as const) {
      const value = estimate(config.provider, { ...config, quality, imageSize }, 0);
      assert.equal(value.maxUsd, null);
      assert.ok(value.minUsd > 0);
    }
  }
});

test('Seedream Pro area boundary and reference surcharges; flat Lite and Flash prices', () => {
  const config = { provider: 'fal-seedream-5-pro', imageSize: { width: 1536, height: 1536 } } as const;
  assert.equal(getProviderCostUsd(config.provider, config, 0), .0675);
  assert.equal(getProviderCostUsd(config.provider, config, 1), .0675);
  assert.equal(getProviderCostUsd(config.provider, config, 3), .0765);
  assert.equal(getProviderCostUsd(config.provider, { ...config, imageSize: { width: 1537, height: 1536 } }, 2), .1395);
  assert.equal(getProviderCostUsd(config.provider, { ...config, imageSize: 'auto_2K' }, 0), .135);
  assert.equal(getProviderCostUsd('fal-seedream-5', { provider: 'fal-seedream-5', imageSize: 'auto_3K' }), .035);
  assert.equal(getProviderCostUsd('fal-seedream-5-flash', { provider: 'fal-seedream-5-flash', imageSize: 'auto_2K' }, 10), .027);
});

test('FLUX resolves preset dimensions and input MP without charging square HD twice', () => {
  const config = { provider: 'fal-flux-2-edit', imageSize: 'square_hd' } as const;
  assert.equal(getProviderCostUsd(config.provider, config, 0), .012);
  assert.equal(getProviderCostUsd(config.provider, config, 1), .024);
  assert.equal(getProviderCostUsd(config.provider, config, 2), .036);
  assert.equal(getProviderCostUsd(config.provider, { ...config, imageSize: { width: 2048, height: 2048 } }, 2), .072);
});

test('UI and backend share the same price calculation and source catalog', () => {
  for (const provider of PROVIDER_VALUES) {
    const config = createDefaultProviderImageConfig(provider);
    const modelProvider = provider === 'fal-seedream' ? 'fal-seedream-v4.5' : provider === 'openai-gpt-image-1.5' ? 'openai-dalle' : provider;
    assert.equal(getProviderCostUsd(provider, config, 1), getModelPhotoProviderCostUsd(modelProvider, config, 1));
    assert.equal(getProviderCostUsd(provider, config, 1), estimate(provider, config, 1).estimatedUsd);
    assert.match(PROVIDER_PRICING_SOURCES[provider], /^https:\/\/fal.ai\//);
    assert.notEqual(MODEL_PHOTO_PROVIDER_HINTS[modelProvider], 'Generación mediante fal.ai');
  }
});
