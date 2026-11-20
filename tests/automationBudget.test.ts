import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { automationBudgetBreakdown, remainingAutomationBudget } = require('../shared/src/automationPolicy');
const { getProviderCostUsd } = require('../shared/src/constants/providerCosts');
const { FieldValue } = require('../functions/node_modules/firebase-admin').firestore;
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const { settleAutomationOperation } = require('../functions/lib/functions/src/automation/budget.js');
const { estimateGenerationHold } = require('../functions/lib/functions/src/costs/generationEstimates.js');
const { recordedGeminiCostUsd } = require('../functions/lib/functions/src/analytics/geminiUsage.js');

for (const recorded of [0.03, 0, null, 0.6]) {
  test(`settlement of a 0.50 hold with recorded=${recorded}`, async t => {
    const writes: any[] = [];
    const ref: any = { collection: () => ({ doc: () => ({}) }) };
    t.mock.method(firestore, 'getAppFirestore', () => ({
      collection: () => ({ doc: () => ref }),
      runTransaction: async (run: any) => run({
        get: async () => ({ data: () => ({ state: 'reserved', holdUsd: 0.5 }) }),
        update: (_ref: any, patch: any) => writes.push(patch),
      }),
    }));
    await settleAutomationOperation('automation', 'operation', recorded);
    assert.equal(writes[0].state, recorded === null ? 'uncertain' : 'recorded');
    assert.equal(writes[0].committedUsd, recorded ?? 0.5);
    assert.deepEqual(writes[1]['budget.reservedUsd'], FieldValue.increment(-0.5));
    assert.deepEqual(writes[1]['budget.spentUsd'], FieldValue.increment(recorded ?? 0.5));
    assert.deepEqual(writes[1]['budget.uncertainUsd'], FieldValue.increment(recorded === null ? 0.5 : 0));
  });
}

test('settled and pending operations are never settled again', async t => {
  let state = 'uncertain';
  t.mock.method(firestore, 'getAppFirestore', () => ({
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
    runTransaction: async (run: any) => run({
      get: async () => ({ data: () => ({ state, holdUsd: 0.5 }) }),
      update: () => assert.fail('Already settled or unapproved operation was charged'),
    }),
  }));
  for (state of ['uncertain', 'recorded', 'pending']) await settleAutomationOperation('a', 'op', 0);
});

test('invalid recorded costs cannot release a hold', async () => {
  for (const value of [-1, NaN, Infinity]) await assert.rejects(settleAutomationOperation('a', 'op', value), { code: 'invalid-argument' });
});

test('missing Gemini usage is unknown; real usage includes thinking tokens', () => {
  for (const metadata of [undefined, {}, { totalTokenCount: 30 }, { promptTokenCount: 10 }, { promptTokenCount: NaN, candidatesTokenCount: 0 }]) {
    assert.equal(recordedGeminiCostUsd('gemini-3.1-flash-lite', metadata), null);
  }
  assert.equal(recordedGeminiCostUsd('gemini-3.1-flash-lite', { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 100 }), 0.00055);
  assert.equal(recordedGeminiCostUsd('gemini-3.1-flash-lite', { promptTokenCount: 0, candidatesTokenCount: 0 }), 0);
});

test('holds follow config, references and margin instead of a fixed 0.50 minimum', () => {
  const config = { provider: 'fal-gpt-image-2.5-flare', imageSize: 'portrait_4_3', quality: 'medium', outputFormat: 'png' } as const;
  const estimate = getProviderCostUsd(config.provider, config, 2);
  assert.equal(estimateGenerationHold(config.provider, config, 2).holdUsd, Math.ceil(estimate * 2 * 1e6) / 1e6);
  assert.ok(estimateGenerationHold(config.provider, config, 2).holdUsd < 0.5);
  assert.ok(estimateGenerationHold(config.provider, config, 4).holdUsd > estimateGenerationHold(config.provider, config, 2).holdUsd);
  const unknown = { ...config, quality: 'max' } as const;
  assert.equal(estimateGenerationHold(unknown.provider, unknown, 2).holdUsd, Math.ceil(getProviderCostUsd(unknown.provider, unknown, 2) * 4 * 1e6) / 1e6);
  const fixed = { provider: 'fal-banana-pro', resolution: '4K' } as const;
  assert.equal(estimateGenerationHold(fixed.provider, fixed, 2).holdUsd, 0.3);
});

test('UI/MCP breakdown includes pending holds and separates historical surplus from uncertain billing', () => {
  const budget = { limitUsd: 3, spentUsd: 1, recordedUsd: 0.2, uncertainUsd: 0.5, reservedUsd: 0.1, pendingUsd: 0.05, providerConfirmedUsd: null };
  assert.deepEqual(automationBudgetBreakdown(budget), { recordedUsd: 0.2, uncertainUsd: 0.5, reservedUsd: 0.15, historicalRetainedUsd: 0.3 });
  assert.equal(remainingAutomationBudget(budget), 1.85);
  assert.equal(automationBudgetBreakdown({ ...budget, uncertainUsd: undefined }).historicalRetainedUsd, 0.8);
});
