import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ADDITIONAL_SYSTEM_PROMPT_FIELDS, normalizeAdditionalSystemPrompts } = require('../shared/src/systemPrompts') as typeof import('../shared/src/systemPrompts');
const { seedTryOnPrompt, composeApprovedTryOnPrompt } = require('../shared/src/approvedTryOnPrompt') as typeof import('../shared/src/approvedTryOnPrompt');
const { DEFAULT_TRY_ON_PROMPT, buildModelIdentityPromptBlock } = require('../shared/src/domain') as typeof import('../shared/src/domain');
const { createDefaultProductScenes } = require('../shared/src/productGeneration') as typeof import('../shared/src/productGeneration');
const { sanitizeSystemConfig, assertValidAdditionalSystemPrompts } = require('../functions/lib/functions/src/admin/systemConfig.js') as typeof import('../functions/src/admin/systemConfig');

test('global prompt overrides survive backend normalization and populate the approved garment prompt', () => {
  const config = sanitizeSystemConfig({
    systemPromptIdentity: 'Keep the same model.', systemPromptInternalLabels: 'Remove inside labels.',
    systemPromptAccessories: 'Preserve the bag hardware.', systemPromptCarryAccessory: 'Carry the same bag.',
    systemPromptProduct: 'Warm lighting.', systemProductScenePrompts: { clean: 'On a table.', human_use_2: 'In use outdoors.' },
  });
  const reloaded = sanitizeSystemConfig(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(reloaded, config);
  const seeded = seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT, { sex: '', age: '', skin: '', hairColor: 'black', hairLength: '', build: '' }, reloaded);
  assert.equal(seeded.blocks.identity, buildModelIdentityPromptBlock({ sex: '', age: '', skin: '', hairColor: 'black', hairLength: '', build: '' }, 'Keep the same model.'));
  const approved = composeApprovedTryOnPrompt(seeded.general, seeded.blocks, 'carry_accessory');
  for (const text of ['Keep the same model.', 'Hair color anchor: black', 'Remove inside labels.', 'Preserve the bag hardware.', 'Carry the same bag.']) assert.ok(approved.includes(text));
  assert.doesNotMatch(approved, /IDENTITY PRESERVATION RULES|INTERNAL GARMENT DETAILS|CARRY ACCESSORY RULES|CASE D/);
  seeded.blocks.identity = 'Local identity edit';
  assert.ok(composeApprovedTryOnPrompt(seeded.general, seeded.blocks, 'carry_accessory').startsWith('Local identity edit'));
  assert.equal(config.systemPromptIdentity, 'Keep the same model.');
  const scenes = createDefaultProductScenes(reloaded);
  assert.equal(scenes[0].prompt, 'On a table.');
  assert.equal(scenes.find((scene) => scene.type === 'human_use_2')!.prompt, 'In use outdoors.');
  assert.equal(scenes[1].prompt, createDefaultProductScenes()[1].prompt);
  scenes[0].prompt = 'Local scene edit';
  assert.equal(createDefaultProductScenes(reloaded)[0].prompt, 'On a table.');
});

test('old config documents and cleared overrides retain internal prompt defaults', () => {
  const defaults = normalizeAdditionalSystemPrompts();
  for (const { key, defaultValue } of ADDITIONAL_SYSTEM_PROMPT_FIELDS) {
    assert.equal(defaults[key], null);
    for (const value of [null, '', '  ', defaultValue]) {
      assert.equal(sanitizeSystemConfig({ [key]: value })[key], null);
    }
  }
  assert.deepEqual(seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT, null, sanitizeSystemConfig({})), seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT));
  const defaultsByScene = Object.fromEntries(createDefaultProductScenes().map(({ type, prompt }) => [type, prompt]));
  assert.equal(sanitizeSystemConfig({ systemProductScenePrompts: defaultsByScene }).systemProductScenePrompts, null);
  assert.deepEqual(createDefaultProductScenes(sanitizeSystemConfig({ systemProductScenePrompts: { clean: ' ' } })), createDefaultProductScenes());
});

test('configuration rejects unusable prompt types, control characters and scene or product limits before saving', () => {
  assert.doesNotThrow(() => assertValidAdditionalSystemPrompts({ systemProductScenePrompts: null, systemPromptIdentity: null }));
  assert.doesNotThrow(() => assertValidAdditionalSystemPrompts({ systemPromptProduct: 'p'.repeat(8000), systemProductScenePrompts: { clean: 's'.repeat(4000) } }));
  for (const patch of [
    { systemPromptProduct: 'x'.repeat(8001) }, { systemPromptIdentity: 'x'.repeat(30001) },
    { systemPromptAccessories: 1 }, { systemPromptInternalLabels: 'invalid\u0000text' },
    { systemProductScenePrompts: [] }, { systemProductScenePrompts: 'bad' },
    { systemProductScenePrompts: { clean: 'x'.repeat(4001) } }, { systemProductScenePrompts: { unknown: 'scene' } },
    { systemProductScenePrompts: { clean: false } },
  ]) assert.throws(() => assertValidAdditionalSystemPrompts(patch as any), { code: 'invalid-argument' });
});
