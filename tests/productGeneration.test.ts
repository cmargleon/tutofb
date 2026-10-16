import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildProductPrompt, buildProductSceneInstructions, createDefaultProductScenes, PRODUCT_IDENTITY_RULES } = require('../shared/src/productGeneration.ts') as typeof import('../shared/src/productGeneration');
const { createInitialGenerateWizardState, getGenerateWizardTotalJobs, getGenerateWizardLastAccessibleStep, isGenerateWizardStepComplete } = require('../src/features/generate/wizard/state.ts') as typeof import('../src/features/generate/wizard/state');
const { validateProductGenerationInput } = require('../functions/lib/functions/src/callables/createProductGenerationBatch.helpers.js') as typeof import('../functions/src/callables/createProductGenerationBatch.helpers');
const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js') as typeof import('../functions/src/callables/regenerateJob.helpers');
const input = () => ({
  requestId: 'request-1', clientId: 'client-1', provider: 'fal-seedream' as const, prompt: 'Warm soft light',
  items: [{ id: 'sku', name: 'Mug', referencePaths: ['garments/drafts/user/draft/sku/front.jpg'] }], scenes: createDefaultProductScenes(),
});

test('objects require a client and scenes but no human model, poses or spreadsheet', () => {
  const state = { ...createInitialGenerateWizardState(), generationKind: 'product' as const, selectedClientId: 'client', outputMode: 'photos_only' as const };
  assert.equal(isGenerateWizardStepComplete(state, 1), true);
  assert.equal(isGenerateWizardStepComplete(state, 2), false);
  assert.equal(isGenerateWizardStepComplete(state, 3), true);
  assert.equal(isGenerateWizardStepComplete({ ...state, productScenes: [] }, 3), false);
  assert.equal(isGenerateWizardStepComplete({ ...state, productScenes: [{ type: 'hero', prompt: ' ' }] }, 3), false);
  assert.equal(getGenerateWizardLastAccessibleStep(state), 2);
  const items = [1, 2].map((id) => ({ id: String(id) })) as typeof state.garments;
  assert.equal(getGenerateWizardTotalJobs({ ...state, garments: items }, 0), 12);
  assert.equal(getGenerateWizardTotalJobs({ ...state, garments: items, productScenes: state.productScenes.slice(0, 1) }, 0), 2);
});
test('garment flow still requires a model and a spreadsheet when selected', () => {
  const state = { ...createInitialGenerateWizardState(), generationKind: 'garment' as const, selectedClientId: 'client' };
  assert.equal(isGenerateWizardStepComplete({ ...state, outputMode: 'photos_only' }, 1), false);
  assert.equal(isGenerateWizardStepComplete({ ...state, selectedModelId: 'model' }, 1), false);
  assert.equal(isGenerateWizardStepComplete({ ...state, selectedModelId: 'model', outputMode: 'photos_only' }, 1), true);
  assert.equal(isGenerateWizardStepComplete({ ...state, selectedModelId: 'model', selectedSpreadsheetTemplateId: 'template' }, 1), true);
  assert.equal(isGenerateWizardStepComplete({ ...state, generationKind: null, selectedModelId: 'model', outputMode: 'photos_only' }, 1), false);
  assert.equal(getGenerateWizardTotalJobs(state, 7), 7);
});
test('product inputs validate image ownership, grouping, unique scenes and bounded job counts', () => {
  assert.equal(validateProductGenerationInput(input(), 'user', 100).scenes.length, 6);
  assert.throws(() => validateProductGenerationInput(input(), 'other', 100), { code: 'permission-denied' });
  assert.throws(() => validateProductGenerationInput(input(), 'user', 5), { code: 'out-of-range' });
  for (const patch of [
    { requestId: '../escape' }, { clientId: 'bad/client' }, { provider: 'unknown' }, { items: [] }, { scenes: [] },
    { scenes: [{ type: 'unknown', prompt: 'scene' }] }, { scenes: [{ type: 'hero', prompt: ' ' }] },
    { scenes: [input().scenes[0], input().scenes[0]] }, { items: [input().items[0], input().items[0]] },
    { prompt: 'x'.repeat(8001) }, { scenes: [{ type: 'clean', prompt: 'x'.repeat(4001) }] },
    { imageConfig: { provider: 'fal-banana-pro', aspectRatio: '1:1', resolution: '1K' } }, { aspectRatio: 'invalid' },
    { items: [{ ...input().items[0], referencePaths: Array(5).fill(input().items[0].referencePaths[0]) }] },
  ]) assert.throws(() => validateProductGenerationInput({ ...input(), ...patch }, 'user', 100));
  const images = Array.from({ length: 11 }, (_, i) => ({ id: `sku-${i}`, name: 'Mug', referencePaths: Array(4).fill(input().items[0].referencePaths[0]) }));
  assert.throws(() => validateProductGenerationInput({ ...input(), items: images }, 'user', 100));
  assert.equal(validateProductGenerationInput({ ...input(), prompt: '' }, 'user', 100).prompt, '');
});
test('default product series keeps four lifestyle scenes and adds two scenes of people using the product', () => {
  const scenes = createDefaultProductScenes();
  const lifestyle = scenes.filter((scene) => !scene.type.startsWith('human_use_'));
  const humanUse = scenes.filter((scene) => scene.type.startsWith('human_use_'));
  assert.equal(lifestyle.length, 4);
  assert.equal(humanUse.length, 2);
  for (const scene of lifestyle) assert.match(scene.prompt, /No people/);
  for (const type of ['clean', 'hero']) {
    assert.match(lifestyle.find((scene) => scene.type === type)!.prompt, /not a plain white seamless or studio background/);
  }
  for (const scene of humanUse) {
    const prompt = buildProductPrompt('', scene.prompt);
    assert.match(prompt, /exact referenced product/);
    assert.match(prompt, /person naturally using/i);
    assert.match(prompt, /relatively neutral, uncluttered background/);
  }
});
test('scene instructions survive prompt composition and product regeneration without try-on instructions', () => {
  const instructions = buildProductSceneInstructions(' Soft light ', ' On a wooden table ');
  assert.equal(instructions, 'Soft light\nOn a wooden table');
  assert.equal(buildProductPrompt(' Soft light ', ' On a wooden table '), `${PRODUCT_IDENTITY_RULES}\n${instructions}`);
  const job = { generationKind: 'product', productScene: 'clean', productReferencePaths: input().items[0].referencePaths } as any;
  const patch = buildRegenerateJobPatch(job, 'fal-seedream', instructions);
  assert.equal(patch.requestedPromptBase, instructions);
  assert.equal(patch.finalPrompt, buildProductPrompt('', instructions));
  assert.doesNotMatch(patch.finalPrompt, /try.on|IMAGE A|IMAGE B/i);
  const edited = createDefaultProductScenes(); edited[0].prompt = 'Custom';
  assert.notEqual(createDefaultProductScenes()[0].prompt, 'Custom');
});
