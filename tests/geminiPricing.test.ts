import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const prices = require('../functions/lib/shared/src/constants/geminiPrices.js') as typeof import('../shared/src/constants/geminiPrices');
const gemini = require('../functions/lib/functions/src/analytics/geminiUsage.js');
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const automation = require('../functions/lib/functions/src/automation/budget.js');
const manglar = require('../functions/lib/functions/src/manglar/budget.js');
const organizer = require('../functions/lib/functions/src/organizer/vision.js');
const metadata = { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200, totalTokenCount: 1300 };
for (const [model, expected] of [
  ['gemini-3.1-flash-lite', .0007], ['gemini-3-flash-preview', .0014],
  ['gemini-3.8-flash', .001875], ['gemini-3.1-pro-preview', .0056],
  ['unknown-model', .0094], ['gemini-3.1-flash-lite-preview', .0094],
] as const) {
  test(`same billable tokens and cost across analytics, automation, Manglar and Organizer: ${model}`, async t => {
    const records: any[] = [], settlements: any[] = [], warnings: any[] = [];
    t.mock.method(firestore, 'getAppFirestore', () => ({ collection: () => ({ add: async (record: any) => records.push(record) }) }));
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ usageMetadata: metadata }), { status: 200 }));
    t.mock.method(console, 'warn', (...args: any[]) => warnings.push(args));
    t.mock.method(automation, 'reserveAutomationOperation', async () => 'operation');
    t.mock.method(automation, 'settleAutomationOperation', async (_id: string, _op: string, cost: number) => settlements.push(cost));
    t.mock.method(manglar, 'runManglarPaid', async (_hold: number, run: any, _id: any, cost: any) => {
      const result = await run(); settlements.push(cost(result)); return result;
    });
    for (const automated of [false, true]) {
      const result = await gemini.callGeminiGenerateContent({ apiKey: 'test', model, body: {}, context: {
        feature: 'pose_classification', ...(automated ? { automation: { id: 'a', key: 'b', kind: 'review' } } : {}),
      } });
      assert.equal(result.usage.estimatedCostUsd, expected);
      assert.equal(result.usage.thinkingTokens, 200);
      assert.equal(result.usage.outputTokens, 300);
      assert.equal(result.usage.totalTokens, 1300);
    }
    assert.equal(records.length, 2);
    assert.ok(records.every(r => r.model === model && r.estimatedCostUsd === expected && r.thinkingTokens === 200 && r.outputTokens === 300));
    assert.deepEqual(settlements, [expected, expected, expected]);
    assert.equal(gemini.recordedGeminiCostUsd(model, metadata), expected);
    assert.equal(organizer.usageCost(model, 1000, 100, 200) / 1e6, expected);
    const status = model === 'unknown-model' ? 'unknown_model' : model.endsWith('lite-preview') ? 'unverified' : 'verified';
    assert.equal(records[0].pricingStatus, status);
    assert.equal(warnings.length, status === 'verified' ? 0 : 2);
  });
}
test('Pro long-context threshold and announced 3.8 Flash rate change', () => {
  assert.equal(prices.geminiUsageCost('gemini-3.1-pro-preview', 200000, 100, 200), .4036);
  assert.equal(prices.geminiUsageCost('gemini-3.1-pro-preview', 200001, 100, 200), .805404);
  assert.equal(prices.geminiUsageCost('gemini-3.8-flash', 1000, 100, 200, new Date('2027-01-01T00:00:00Z')), .00375);
  assert.equal(prices.geminiUsageCost('gemini-3.8-flash', 1000, 100, 200, new Date('2026-12-31T23:59:59Z')), .001875);
});
test('unknown names including object prototype keys fall back safely; metadata stays auditable', () => {
  for (const model of ['constructor', '__proto__', 'gemini-new']) {
    assert.equal(prices.geminiModelRates(model, 10).pricingStatus, 'unknown_model');
    assert.equal(prices.geminiUsageCost(model, 1000, 100, 200), .0094);
  }
  assert.equal(organizer.MODEL_PRICES, prices.GEMINI_MODEL_PRICES);
  for (const rate of Object.values(prices.GEMINI_MODEL_PRICES)) {
    assert.equal(rate.sourceUrl, prices.GEMINI_PRICING_SOURCE);
    assert.equal(rate.checkedAt, '2026-11-20');
    assert.equal(rate.reasoning, rate.output);
  }
});
test('conservative reserve covers ordinary calls at the highest known rate', () => {
  assert.ok(prices.GEMINI_CONSERVATIVE_HOLD_USD >= prices.geminiUsageCost('unknown', 32768, 8192, 65536));
  assert.ok(prices.GEMINI_CONSERVATIVE_HOLD_USD > .05);
  assert.equal(gemini.recordedGeminiCostUsd('unknown', {}), null);
  assert.equal(gemini.recordedGeminiCostUsd('unknown', { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: NaN }), null);
});

test('Manglar releases only the difference between its reserve and recorded Gemini cost', async t => {
  const access = require('../functions/lib/functions/src/manglar/access.js');
  t.mock.method(access, 'loadManglarUser', async () => ({ role: 'admin' }));
  t.mock.method(access, 'loadManglarAccess', async () => ({ enabled: true, version: 1 }));
  const writes: any[] = [];
  const operation = { ownerUid: 'u', accessVersion: 1, role: 'admin', state: 'running', allowEstimatedCosts: true, committedUsd: 0, budgetUsd: 10, connectionId: 'c' };
  const payment: any = { update: async (patch: any) => writes.push(['payment', patch]) };
  const ref: any = { get: async () => ({ data: () => operation }), collection: () => ({ doc: () => payment }) };
  t.mock.method(firestore, 'getAppFirestore', () => ({
    collection: (name: string) => ({ doc: () => name === 'manglarOperations' ? ref : {} }),
    runTransaction: async (run: any) => run({
      getAll: async () => [{ data: () => operation }, { data: () => ({ active: true, expiresAt: { toMillis: () => Date.now() + 10000 } }) }],
      get: async () => ({ data: () => ({ state: 'reserved' }) }),
      create: () => {}, update: (target: any, patch: any) => writes.push([target === ref ? 'operation' : 'payment', patch]),
    }),
  }));
  const actual = gemini.recordedGeminiCostUsd('gemini-3.8-flash', metadata);
  await manglar.runManglarPaid(prices.GEMINI_CONSERVATIVE_HOLD_USD, async () => actual, 'op', (cost: number) => cost);
  const recorded = writes.find(([target, patch]) => target === 'payment' && patch.state === 'recorded');
  assert.equal(recorded[1].recordedUsd, actual);
  const { FieldValue } = require('../functions/node_modules/firebase-admin').firestore;
  assert.deepEqual(writes.at(-1)[1].committedUsd, FieldValue.increment(actual - prices.GEMINI_CONSERVATIVE_HOLD_USD));
});
