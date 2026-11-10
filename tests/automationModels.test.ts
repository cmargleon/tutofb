import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { AutomationModelOption, Client, Model } from '../shared/src/types';

const require = createRequire(import.meta.url);
const { getClientGenderModelDefaults } = require('../functions/lib/shared/src/automationModels.js') as typeof import('../shared/src/automationModels');
const { resolveAutomationModelOptions, selectAutomationModel } = require('../functions/lib/functions/src/automation/models.js') as typeof import('../functions/src/automation/models');
const model = (id: string, sex: string | null, patch: Partial<Model> = {}): Model => ({
  id, clientId: 'client', status: 'active', active: true, name: id,
  identityTraits: { sex, age: null, skin: null, hairColor: null, hairLength: null, build: null },
  poses: [{ id: `${id}-front`, active: true }], ...patch,
} as Model);
const client = (automation: Client['automation'] = {}): Client => ({ automation } as Client);

test('unique active models of each gender are inferred within the client; explicit defaults win over multiple candidates', () => {
  const models = [model('man', 'male'), model('woman', 'female'), model('foreign', 'female', { clientId: 'other' }), model('archived', 'male', { status: 'archived' }), model('inactive', 'female', { active: false })];
  assert.deepEqual(getClientGenderModelDefaults('client', {}, models), { defaultMaleModelId: 'man', defaultFemaleModelId: 'woman' });
  models.push(model('second-woman', 'female'));
  assert.deepEqual(getClientGenderModelDefaults('client', {}, models), { defaultMaleModelId: 'man' });
  assert.deepEqual(getClientGenderModelDefaults('client', { defaultFemaleModelId: 'second-woman' }, models), { defaultMaleModelId: 'man', defaultFemaleModelId: 'second-woman' });
});

test('gender defaults take priority over legacy fallback; an explicit model overrides gender selection', () => {
  const models = [model('man', 'male'), model('woman', 'female'), model('legacy', null)];
  const options = resolveAutomationModelOptions('client', client({ defaultModelId: 'legacy' }), models);
  assert.deepEqual(options.map(option => option.modelId), ['man', 'woman']);
  assert.equal(resolveAutomationModelOptions('client', client(), models, 'legacy')[0].modelId, 'legacy');
  assert.equal(resolveAutomationModelOptions('client', client({ defaultModelId: 'legacy' }), [models[2]])[0].modelId, 'legacy');
  assert.throws(() => resolveAutomationModelOptions('client', client(), []), /Configura un modelo/);
});

test('foreign, archived, inactive, mismatched and unavailable-pose defaults cannot be used', () => {
  for (const candidate of [model('chosen', 'female', { clientId: 'other' }), model('chosen', 'female', { status: 'archived' }), model('chosen', 'female', { active: false }), model('chosen', 'male')]) {
    assert.throws(() => resolveAutomationModelOptions('client', client({ defaultFemaleModelId: 'chosen' }), [candidate]));
  }
  assert.throws(() => resolveAutomationModelOptions('client', client({ defaultFemaleModelId: 'missing' }), [model('woman', 'female')]));
  assert.throws(() => resolveAutomationModelOptions('client', client(), [model('woman', 'female', { poses: [{ id: 'inactive', active: false }] } as Partial<Model>)]), /poses activas/);
});

const options: AutomationModelOption[] = [
  { gender: 'male', modelId: 'man', poseIds: ['man-front'] },
  { gender: 'female', modelId: 'woman', poseIds: ['woman-front'] },
];
test('selects the corresponding gender, and distinguishes unisex from insufficient evidence', () => {
  assert.equal(selectAutomationModel(options, 'male', 0.99, 'item')?.modelId, 'man');
  assert.equal(selectAutomationModel(options, 'female', 0.99, 'item')?.modelId, 'woman');
  assert.equal(selectAutomationModel(options, null, 1, 'item'), null);
  assert.equal(selectAutomationModel(options, 'unisex', 0.5, 'item'), null);
  assert.equal(selectAutomationModel(options, 'male', 0.4, 'item'), null);
  const selected = selectAutomationModel(options, 'unisex', 0.99, 'order:item')!;
  assert.equal(selectAutomationModel([...options].reverse(), 'unisex', 0.99, 'order:item')?.modelId, selected.modelId);
  assert.deepEqual(new Set(Array.from({ length: 50 }, (_, i) => selectAutomationModel(options, 'unisex', 0.99, `item-${i}`)?.modelId)), new Set(['man', 'woman']));
});

test('a single male or female default is used for every garment, including unknown gender', () => {
  for (const option of options) for (const gender of ['male', 'female', 'unisex', null] as const) {
    assert.equal(selectAutomationModel([option], gender, null, 'item')?.modelId, option.modelId);
  }
  assert.equal(selectAutomationModel([], 'male', 1, 'item'), null);
  const remaining = resolveAutomationModelOptions('client', client({ defaultMaleModelId: 'man', defaultFemaleModelId: 'woman' }), [model('man', 'male', { active: false }), model('woman', 'female')]);
  assert.equal(remaining.length, 1);
  assert.equal(selectAutomationModel(remaining, 'male', 0.99, 'item')?.modelId, 'woman');
});

test('uses the configured gender threshold and retains 0.65 when it is omitted', () => {
  assert.equal(selectAutomationModel(options, 'male', 0.7, 'item', 0.8), null);
  assert.equal(selectAutomationModel(options, 'male', 0.8, 'item', 0.8)?.modelId, 'man');
  assert.equal(selectAutomationModel(options, 'male', 0.7, 'item')?.modelId, 'man');
  assert.equal(selectAutomationModel(options, 'male', 0.64, 'item'), null);
  assert.equal(selectAutomationModel(options, 'male', 0.65, 'item')?.modelId, 'man');
});

test('Gemini is asked for garment gender with the original references, and objects never retain a gender', async () => {
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-automation-model-unit', storageBucket: 'demo-automation-model-unit.appspot.com' });
  const { classifyGarmentWithGemini } = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js');
  for (const gender of ['male', 'female', 'unisex', null, 'invalid']) for (const itemKind of ['garment', 'product']) {
    const result = await classifyGarmentWithGemini({
      apiKey: 'unused', model: 'test', categories: [], fallbackCategoryId: null,
      garment: { garmentId: 'shirt', garmentName: 'reference', photos: [{ id: 'photo', fileName: 'ref.jpg', storagePath: 'unused', sourceIndex: 0 }] },
      organizer: {
        readImage: async () => ({ bytes: Buffer.from('reference'), mimeType: 'image/jpeg' }),
        generate: async (body: any) => {
          const prompt = body.contents[0].parts[0].text;
          assert.match(prompt, /garmentGender male/); assert.match(prompt, /Unisex no significa incertidumbre/);
          assert.equal(body.contents[0].parts.length, 2);
          assert.ok(body.generationConfig.responseJsonSchema.required.includes('garmentGender'));
          return { candidates: [{ content: { parts: [{ text: JSON.stringify({ itemKind, itemKindConfidence: 0.99,
            garmentGender: gender, garmentGenderConfidence: 0.9, garmentGenderReasoning: 'Corte visible', bodyArea: 'upper_body',
            photos: [{ photoId: 'photo', view: 'front', confidence: 0.99 }] }) }] } }] };
        },
      },
    });
    assert.equal(result.garmentGender, itemKind === 'garment' && gender !== 'invalid' ? gender : null);
    if (itemKind === 'product') assert.equal(result.garmentGenderConfidence, null);
  }
});
