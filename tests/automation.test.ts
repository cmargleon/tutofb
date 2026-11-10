import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const domain = require('../functions/lib/functions/src/automation/domain.js') as typeof import('../functions/src/automation/domain');
const { resolveAutomationPreset, PRODUCT_PRESETS } = require('../functions/lib/functions/src/automation/presets.js') as typeof import('../functions/src/automation/presets');
const { resolveAutomationPoseIds } = require('../functions/lib/functions/src/automation/presets.js') as typeof import('../functions/src/automation/presets');
const { assertImportUrl } = require('../functions/lib/functions/src/automation/imports.js') as typeof import('../functions/src/automation/imports');
const payload = { source: 'api', externalId: 'order-1', clientId: 'client-1', jobType: 'garment', inputImages: [{ itemId: 'sku-1', fileName: 'front.jpg', storagePath: 'garments/drafts/user/draft/sku/front.jpg' }] };

test('automation excludes inactive poses from defaults and presets without replacing explicit selections', () => {
  const model = { poses: [
    { id: 'legacy' }, { id: 'active', active: true }, { id: 'inactive', active: false },
  ] } as any;
  assert.deepEqual(resolveAutomationPoseIds(model), ['legacy', 'active']);
  assert.deepEqual(resolveAutomationPoseIds(model, ['inactive', 'active']), ['active']);
  assert.throws(() => resolveAutomationPoseIds(model, ['inactive']), /No hay poses activas/);
  assert.throws(() => resolveAutomationPoseIds(model, ['missing']), /no disponibles/);
  assert.throws(() => resolveAutomationPoseIds({ poses: [] }), /No hay poses activas/);
  model.poses[1].active = false;
  assert.throws(() => resolveAutomationPoseIds(model, ['active']), /No hay poses activas/);
});

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
  assert.equal(resolveAutomationPreset(payload as any, {} as any).modelId, null, 'Model selection can wait for client gender defaults');
  assert.throws(() => resolveAutomationPreset({ ...payload, preset: 'missing' } as any, client), /Preset/);
});
test('product preset has bounded review and shares the six scenes used by the object wizard', () => {
  const result = resolveAutomationPreset({ ...payload, jobType: 'product' } as any, {} as any);
  assert.equal(result.name, 'generic_product');
  assert.equal(PRODUCT_PRESETS.generic_product.scenes.length, 6);
  const { createDefaultProductScenes } = require('../shared/src/productGeneration.ts');
  assert.deepEqual(PRODUCT_PRESETS.generic_product.scenes.map(({ type, prompt }) => ({ type, prompt })), createDefaultProductScenes());
  assert.equal(PRODUCT_PRESETS.generic_product.maxReviewAttempts, 3);
});
test('automation defaults to GPT Image 2.5 Flare and preserves explicit provider and client presets', () => {
  for (const jobType of ['garment', 'product']) {
    const request = { ...payload, jobType, modelId: 'model' } as any;
    const name = jobType === 'product' ? 'generic_product' : 'standard';
    assert.equal(resolveAutomationPreset(request, {} as any).config.provider, 'fal-gpt-image-2.5-flare');
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

test('dispatch snapshots use configured classification/gender rules while older jobs keep 0.65', async t => {
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.apps.length ? null : admin.initializeApp({ projectId: 'demo-automation-rules', storageBucket: 'demo-automation-rules.appspot.com' });
  const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
  const classifier = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js');
  const system = require('../functions/lib/functions/src/admin/systemConfig.js');
  const batches = require('../functions/lib/functions/src/callables/createGenerationBatch.js');
  const { dispatchGarment } = require('../functions/lib/functions/src/automation/pipelines.js');
  const models = ['male', 'female'].map(id => ({ id, clientId: 'client', poses: [{ id: 'front', aiClassification: {
    usableForGarmentViews: ['front'], orientationGroup: 'front', framing: 'full_body', bodyFocus: 'full_body',
  } }] }));
  const options = models.map(model => ({ modelId: model.id, gender: model.id, poseIds: ['front'] }));
  let items: any[] = [];
  let created = 0;
  let confidence = 0.7;
  t.mock.method(firestore, 'getAppFirestore', () => ({
    collection: () => ({ doc: () => ({ update: async () => {} }) }),
    getAll: async () => models.map(model => ({ data: () => model })),
    runTransaction: async (work: any) => work({ get: async () => ({ data: () => ({ leaseToken: 'lease', status: 'importing' }) }), update: (_ref: any, patch: any) => { items = structuredClone(patch.items); } }),
  }));
  t.mock.method(classifier, 'classifyGarmentWithGemini', async ({ garment }: any) => ({
    itemKind: 'garment', itemKindConfidence: confidence, garmentBodyArea: 'full_body', garmentGender: 'male', garmentGenderConfidence: confidence,
    photos: garment.photos.map((photo: any) => ({ ...photo, view: 'front', confidence, classifiedBy: 'gemini' })),
  }));
  t.mock.method(system, 'getSystemConfigCached', async () => system.sanitizeSystemConfig({}));
  t.mock.method(batches, 'createGenerationBatchesCore', async () => { created++; });
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'unit-only';
  const invoke = (effectiveRules?: any) => dispatchGarment({ id: 'automation', clientId: 'client', createdByUid: 'user', leaseToken: 'lease', retryCount: 0,
    inputImages: [{ itemId: 'shirt', fileName: 'shirt.jpg', storagePath: 'garments/shirt.jpg' }], ...(effectiveRules ? { effectiveRules } : {}),
  }, { automation: { rules: { classificationMinConfidence: 0.95, garmentGenderMinConfidence: 0.95 } } }, {}, options);
  try {
    await invoke();
    assert.equal(created, 1, 'Un trabajo antiguo ignora cambios posteriores y conserva 0.65');
    assert.equal(items[0].status, 'processing');
    await invoke({ classificationMinConfidence: 0.8, garmentGenderMinConfidence: 0.65 });
    assert.equal(created, 1);
    assert.equal(items[0].issue.code, 'classification-required');
    await invoke({ classificationMinConfidence: 0.65, garmentGenderMinConfidence: 0.8 });
    assert.equal(created, 1);
    assert.equal(items[0].issue.code, 'garment-gender-required');
    confidence = 0.6;
    await invoke();
    assert.equal(created, 1);
    assert.equal(items[0].issue.code, 'classification-required');
    await invoke({ classificationMinConfidence: 0.5, garmentGenderMinConfidence: 0.5 });
    assert.equal(created, 2);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (app) await app.delete();
  }
});

test('plans and directly created jobs freeze resolved rules; old plans retain the original defaults', async t => {
  const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
  const access = require('../functions/lib/functions/src/auth/clientAccess.js');
  const { prepareAutomationPlan } = require('../functions/lib/functions/src/automation/plans.js');
  const { createAutomation } = require('../functions/lib/functions/src/automation/persistence.js');
  const data = new Map<string, any>([
    ['clients/client-1', { name: 'Cliente', status: 'active', automation: { rules: { garmentGenderMinConfidence: 0.8 } } }],
    ['system_config/main', { batchMaxJobs: 100, automationRules: { garmentGenderMinConfidence: 0.7, classificationMinConfidence: 0.75 } }],
  ]);
  let serial = 0;
  const reference = (path: string) => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ exists: data.has(path), id: path.split('/').at(-1), ref: reference(path), data: () => data.get(path) });
  const db = {
    collection: (name: string) => ({ doc: (id = `auto-${++serial}`) => reference(`${name}/${id}`) }),
    runTransaction: async (work: any) => work({
      get: async (ref: any) => snapshot(ref.path), getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
      create: (ref: any, value: any) => data.set(ref.path, structuredClone(value)),
      update: (ref: any, value: any) => data.set(ref.path, { ...data.get(ref.path), ...value }),
    }),
  };
  t.mock.method(firestore, 'getAppFirestore', () => db);
  t.mock.method(access, 'assertHumanClientAccess', async () => {});
  const request = { ...payload, jobType: 'product', allowEstimatedCosts: true };
  const plan = await prepareAutomationPlan(request, 'user', 'admin');
  assert.deepEqual(plan.effectiveRules, { garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.75 });
  data.set('clients/client-1', { name: 'Cliente', status: 'active', automation: { rules: { garmentGenderMinConfidence: 0.9, classificationMinConfidence: 0.85 } } });
  const planned = await createAutomation(plan.request, 'user', 'admin', plan);
  assert.deepEqual(data.get(`automationJobs/${planned.jobId}`).effectiveRules, plan.effectiveRules);
  const direct = await createAutomation({ ...request, externalId: 'direct-rules' }, 'user', 'admin');
  assert.deepEqual(data.get(`automationJobs/${direct.jobId}`).effectiveRules, { garmentGenderMinConfidence: 0.9, classificationMinConfidence: 0.85 });
  const { effectiveRules: _rules, ...legacyPlan } = plan;
  const legacy = await createAutomation({ ...request, externalId: 'legacy-plan' }, 'user', 'admin', legacyPlan);
  assert.deepEqual(data.get(`automationJobs/${legacy.jobId}`).effectiveRules, { garmentGenderMinConfidence: 0.65, classificationMinConfidence: 0.65 });
});
