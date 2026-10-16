import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const domain = require('../functions/lib/functions/src/automation/domain.js') as typeof import('../functions/src/automation/domain');
const { resolveAutomationPreset, PRODUCT_PRESETS } = require('../functions/lib/functions/src/automation/presets.js') as typeof import('../functions/src/automation/presets');
const { assertImportUrl } = require('../functions/lib/functions/src/automation/imports.js') as typeof import('../functions/src/automation/imports');
const payload = { source: 'api', externalId: 'order-1', clientId: 'client-1', jobType: 'garment', inputImages: [{ itemId: 'sku-1', fileName: 'front.jpg', storagePath: 'garments/drafts/user/draft/sku/front.jpg' }] };

test('automation validates payload and storage ownership', () => {
  assert.equal(domain.validateAutomationInput(payload, 'user').externalId, 'order-1');
  for (const patch of [{ source: 'public' }, { jobType: 'unknown' }, { externalId: '' }, { clientId: '../client' }, { inputImages: [] }, { inputImages: 'bad' }, { metadata: [] }]) {
    assert.throws(() => domain.validateAutomationInput({ ...payload, ...patch }, 'user'));
  }
  assert.throws(() => domain.validateAutomationInput(payload, 'other'), { code: 'permission-denied' });
  assert.throws(() => domain.validateAutomationInput({ ...payload, inputImages: Array.from({ length: 5 }, () => payload.inputImages[0]) }, 'user'));
});
test('independent external and gmail idempotency keys survive source changes', () => {
  const both = domain.automationKeys({ externalId: 'same', gmailMessageId: 'mail' });
  assert.equal(both.length, 2);
  assert.equal(both[0], domain.automationKeys({ externalId: 'same' })[0]);
  assert.equal(both[1], domain.automationKeys({ externalId: 'different', gmailMessageId: 'mail' })[1]);
  assert.notEqual(both[0], domain.automationKeys({ externalId: 'mail' })[0]);
});
test('garment model precedence and explicit missing model attention', () => {
  const client = { automation: { defaultModelId: 'default', presets: { standard: { modelId: 'preset' } } } } as any;
  assert.equal(resolveAutomationPreset({ ...payload, modelId: 'explicit' } as any, client).modelId, 'explicit');
  assert.equal(resolveAutomationPreset(payload as any, client).modelId, 'preset');
  assert.equal(resolveAutomationPreset(payload as any, { automation: { defaultModelId: 'default' } } as any).modelId, 'default');
  assert.throws(() => resolveAutomationPreset(payload as any, {} as any), /modelId/);
  assert.throws(() => resolveAutomationPreset({ ...payload, preset: 'missing' } as any, client), /Preset/);
});
test('product preset has bounded review and four identity-preserving scenes', () => {
  const result = resolveAutomationPreset({ ...payload, jobType: 'product' } as any, {} as any);
  assert.equal(result.name, 'generic_product');
  assert.equal(PRODUCT_PRESETS.generic_product.scenes.length, 4);
  assert.equal(PRODUCT_PRESETS.generic_product.maxReviewAttempts, 3);
});
test('automation defaults to Seedream 5 Pro and preserves explicit provider and client presets', () => {
  for (const jobType of ['garment', 'product']) {
    const request = { ...payload, jobType, modelId: 'model' } as any;
    const name = jobType === 'product' ? 'generic_product' : 'standard';
    assert.equal(resolveAutomationPreset(request, {} as any).config.provider, 'fal-seedream-5-pro');
    const client = { automation: { presets: { [name]: { provider: 'fal-banana-pro' } } } } as any;
    assert.equal(resolveAutomationPreset(request, client).config.provider, 'fal-banana-pro');
    assert.equal(resolveAutomationPreset({ ...request, provider: 'fal-nano-banana-2' }, client).config.provider, 'fal-nano-banana-2');
  }
});
test('automation status transitions, retry/review, failure and successful completion', () => {
  const summarize = (jobs: any[]) => domain.summarizeAutomation(jobs);
  assert.equal(summarize([{ status: 'pending' }]).status, 'processing');
  assert.equal(summarize([{ status: 'processing', currentOutput: {} }]).status, 'review');
  assert.equal(summarize([{ status: 'failed' }]).status, 'needs_attention');
  assert.equal(summarize([{ status: 'completed' }]).status, 'completed');
  const output = summarize([{ id: 'j1', status: 'completed', productScene: 'hero', currentOutput: { resultImagePath: 'generated/path.jpg', autoReview: { verdict: 'approved' } } }, { status: 'failed', currentOutput: { resultImagePath: 'rejected' } }]);
  assert.equal(output.progress.completed, 1);
  assert.equal(output.progress.failed, 1);
  assert.equal(output.outputImages.length, 1);
  assert.equal(output.outputImages[0].type, 'hero');
});
test('import URLs require explicit HTTPS host allowlist and no credentials', () => {
  assert.throws(() => assertImportUrl('https://example.com/input.jpg', []));
  assert.throws(() => assertImportUrl('http://example.com/input.jpg', ['example.com']));
  assert.throws(() => assertImportUrl('https://user:pass@example.com/input.jpg', ['example.com']));
  assert.throws(() => assertImportUrl('https://example.com:8080/input.jpg', ['example.com']));
  assert.equal(assertImportUrl('https://example.com/input.jpg', ['example.com']).hostname, 'example.com');
});
test('job reads are restricted to owner or admin', () => {
  assert.equal(domain.canReadAutomation({ createdByUid: 'a' }, 'b', 'operador'), false);
  assert.equal(domain.canReadAutomation({ createdByUid: 'a' }, 'a', 'operador'), true);
  assert.equal(domain.canReadAutomation({ createdByUid: 'a' }, 'b', 'admin'), true);
});


test('API polling policy is age based, bounded, and stops for all terminal states', () => {
  const { automationPolling } = require('../functions/lib/functions/src/automation/polling.js');
  const job = { status: 'processing', createdAt: { toMillis: () => 1000 } };
  assert.equal(automationPolling(job, 1000).pollAfterSeconds, 20);
  assert.equal(automationPolling(job, 300_999).pollAfterSeconds, 20);
  assert.equal(automationPolling(job, 301_000).pollAfterSeconds, 60);
  assert.equal(automationPolling(job, 1800_000).pollAfterSeconds, 1);
  assert.equal(automationPolling(job, 1801_000).pollingTimedOut, true);
  for (const status of ['completed', 'failed', 'needs_attention']) {
    const response = automationPolling({ ...job, status }, 1802_000);
    assert.equal(response.pollAfterSeconds, 0); assert.equal(response.pollingTimedOut, false);
  }
});
