import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { UploadedGarmentDraft } from '../src/features/generate/types';

const require = createRequire(import.meta.url);
const { createInitialGenerateWizardState, selectGenerateWizardProvider, getEffectiveItemKind, resolveWizardGenerationKind, resolveWizardMajorityKind } = require('../src/features/generate/wizard/state') as typeof import('../src/features/generate/wizard/state');
const item = (id: string, kind: 'garment' | 'product', photoCount = 1): UploadedGarmentDraft => ({
  id, name: id, analysisStatus: 'ready', itemKind: kind, itemKindConfidence: 0.95,
  originalPhotos: Array.from({ length: photoCount }, (_, i) => ({ id: String(i) })),
} as UploadedGarmentDraft);

test('selecting any available provider defaults to portrait framing and preserves quality and output format', () => {
  const { PROVIDER_VALUES } = require('../shared/src/domain') as typeof import('../shared/src/domain');
  const { resolveAspectRatioForImageConfig } = require('../shared/src/providerImageConfig') as typeof import('../shared/src/providerImageConfig');
  const state = createInitialGenerateWizardState();
  state.providerImageConfigs['fal-gpt-image-2.5-flare'] = {
    provider: 'fal-gpt-image-2.5-flare', imageSize: 'square_hd', quality: 'high', outputFormat: 'jpeg',
  };
  for (const provider of PROVIDER_VALUES) {
    const selected = selectGenerateWizardProvider(state, provider);
    assert.equal(resolveAspectRatioForImageConfig(selected.providerImageConfigs[provider]), '3:4');
  }
  const selected = selectGenerateWizardProvider(state, 'fal-gpt-image-2.5-flare');
  assert.deepEqual(selected.providerImageConfigs['fal-gpt-image-2.5-flare'], {
    provider: 'fal-gpt-image-2.5-flare', imageSize: 'portrait_4_3', quality: 'high', outputFormat: 'jpeg',
  });
  assert.equal((state.providerImageConfigs['fal-gpt-image-2.5-flare'] as any).imageSize, 'square_hd');
});

test('majority is measured by articles in either direction and never by reference count', () => {
  const garments = [item('shirt', 'garment'), item('pants', 'garment'), item('lamp', 'product', 4)];
  assert.equal(resolveWizardMajorityKind(garments), 'garment');
  assert.equal(resolveWizardGenerationKind(garments), null);
  assert.equal(resolveWizardGenerationKind(garments.filter((entry) => getEffectiveItemKind(entry) === 'garment')), 'garment');
  assert.equal(resolveWizardMajorityKind([item('shirt', 'garment', 4), item('lamp', 'product'), item('cup', 'product')]), 'product');
  assert.equal(resolveWizardMajorityKind([item('shirt', 'garment'), item('lamp', 'product')]), null);
  assert.equal(resolveWizardMajorityKind([]), null);
});

test('pending, failed, missing or low-confidence detection never authorizes automatic exclusions', () => {
  for (const patch of [{ analysisStatus: 'idle' }, { analysisStatus: 'preparing' }, { analysisStatus: 'failed' }, { itemKind: null }, { itemKindConfidence: 0.3 }]) {
    assert.equal(resolveWizardMajorityKind([item('shirt', 'garment'), { ...item('unknown', 'garment'), ...patch } as UploadedGarmentDraft]), null);
  }
  const uncertain = { ...item('uncertain', 'product'), itemKindConfidence: 0.3 };
  assert.equal(getEffectiveItemKind(uncertain), null);
  assert.equal(resolveWizardGenerationKind([{ ...uncertain, itemKindOverride: 'garment' }]), 'garment');
});

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-photo-generation', storageBucket: 'demo-photo-generation.appspot.com' });
// All I/O is replaced before loading the classifier; these tests cannot access Firebase or paid models.
const storage = admin.storage();
const originalBucket = storage.bucket;
storage.bucket = () => ({ file: () => ({ download: async () => [Buffer.from('test-image')] }) });
const classifier = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js') as typeof import('../functions/src/callables/classifyGarmentViewsWithGemini');
storage.bucket = originalBucket;
const usage = require('../functions/lib/functions/src/analytics/geminiUsage.js');
const { mergeGarmentClassificationResults } = require('../src/features/generate/wizard/hooks/garmentClassification') as typeof import('../src/features/generate/wizard/hooks/garmentClassification');

test('Gemini classifies garment/object and views in one request, including a single back photo', async () => {
  const original = usage.callGeminiGenerateContent;
  try {
    for (const kind of ['garment', 'product', 'invalid'] as const) {
      usage.callGeminiGenerateContent = async ({ body }: any) => {
        assert.ok(body.generationConfig.responseJsonSchema.required.includes('itemKind'));
        assert.equal(body.contents[0].parts.length, 2);
        assert.match(body.contents[0].parts[0].text, /No clasifiques por la presencia de una persona/);
        return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ itemKind: kind, itemKindConfidence: 0.97,
          itemKindReasoning: 'Artículo principal identificado', itemLabel: kind === 'garment' ? 'Camiseta' : 'Lámpara',
          bodyArea: kind === 'garment' ? 'upper_body' : null,
          photos: [{ photoId: 'photo', view: 'back', confidence: 0.98, reasoning: 'Vista trasera' }] }) }] } }] } };
      };
      const result = await classifier.classifyGarmentWithGemini({ apiKey: 'test-only', model: 'test-only', categories: [], fallbackCategoryId: null,
        garment: { garmentId: 'item', garmentName: 'image', photos: [{ id: 'photo', fileName: 'photo.jpg', storagePath: 'test/photo.jpg', sourceIndex: 0 }] } });
      assert.equal(result.itemKind, kind === 'invalid' ? null : kind);
      assert.equal(result.itemKindConfidence, 0.97);
      assert.equal(result.photos[0].view, 'back');
      assert.equal(result.garmentBodyArea, kind === 'garment' ? 'upper_body' : null);
      const original = { ...item('item', 'garment'), itemKindOverride: 'product' as const, originalPhotos: [{ id: 'photo', classification: { view: 'front' } }] } as UploadedGarmentDraft;
      const merged = mergeGarmentClassificationResults([original], { success: true, garments: [result] })[0];
      assert.equal(merged.itemKindOverride, 'product');
      assert.equal(merged.originalPhotos[0].classification.view, 'back');
      const categoriesOnly = mergeGarmentClassificationResults([original], { success: true, garments: [result] }, true)[0];
      assert.equal(categoriesOnly.originalPhotos, original.originalPhotos);
      assert.equal(categoriesOnly.itemKind, original.itemKind);
    }
  } finally { usage.callGeminiGenerateContent = original; }
});

test('automated objects use Flare and exactly the same six configured scenes and general prompt as the wizard', async () => {
  const batch = require('../functions/lib/functions/src/callables/createProductGenerationBatch.js');
  const system = require('../functions/lib/functions/src/admin/systemConfig.js');
  const pipelines = require('../functions/lib/functions/src/automation/pipelines.js');
  const { createDefaultProductGeneration } = require('../shared/src/productGeneration') as typeof import('../shared/src/productGeneration');
  const originalCreate = batch.createProductGenerationBatchCore;
  const originalConfig = system.getSystemConfigCached;
  const config = { systemPromptProduct: 'Global warm light', systemProductScenePrompts: { clean: 'Global table' } };
  let received: any;
  system.getSystemConfigCached = async () => config;
  batch.createProductGenerationBatchCore = async (request: any) => { received = request; return { batchId: 'test', createdJobs: 6 }; };
  try {
    await pipelines.dispatchProduct({ id: 'automation', clientId: 'client', createdByUid: 'user', leaseToken: 'test', inputImages: [
      { itemId: 'lamp', fileName: 'lamp.jpg', storagePath: 'test/lamp.jpg' }, { itemId: 'lamp', fileName: 'side.jpg', storagePath: 'test/side.jpg' },
    ] }, {}, {});
    assert.equal(received.provider, 'fal-gpt-image-2.5-flare');
    assert.equal(received.items.length, 1);
    assert.equal(received.items[0].referencePaths.length, 2);
    assert.equal(received.aspectRatio, '3:4');
    assert.deepEqual({ prompt: received.prompt, scenes: received.scenes }, createDefaultProductGeneration(config));
    assert.equal(received.scenes.length, 6);
    assert.equal(received.scenes.filter((scene: any) => scene.type.startsWith('human_use_')).length, 2);
    await pipelines.dispatchProduct({ id: 'automation', clientId: 'client', createdByUid: 'user', leaseToken: 'test', inputImages: [
      { itemId: 'lamp', fileName: 'lamp.jpg', storagePath: 'test/lamp.jpg' },
    ] }, {}, { aspectRatio: '16:9' });
    assert.equal(received.aspectRatio, '16:9');
  } finally { batch.createProductGenerationBatchCore = originalCreate; system.getSystemConfigCached = originalConfig; }
});
