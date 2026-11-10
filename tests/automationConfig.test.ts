import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AUTOMATION_RULES, resolveAutomationRules, resolveAutomationPresetName, resolveEffectiveAutomationConfig, validateAutomationRules } from '../shared/src/automationConfig';
import { DEFAULT_AUTOMATION_BUDGET } from '../shared/src/automationPolicy';
import type { ClientAutomationConfig, Model } from '../shared/src/types';

test('automation decision rules inherit each missing field without changing legacy defaults', () => {
  assert.deepEqual(resolveAutomationRules(), { garmentGenderMinConfidence: 0.65, classificationMinConfidence: 0.65 });
  assert.deepEqual(resolveAutomationRules({ garmentGenderMinConfidence: 0.75 }), { garmentGenderMinConfidence: 0.75, classificationMinConfidence: 0.65 });
  assert.deepEqual(resolveAutomationRules({ garmentGenderMinConfidence: 0.75, classificationMinConfidence: 0.8 }, { garmentGenderMinConfidence: 0.9 }), {
    garmentGenderMinConfidence: 0.9, classificationMinConfidence: 0.8,
  });
});

test('decision rule validation accepts optional fields and inclusive limits, rejects non-finite and out-of-range values', () => {
  assert.deepEqual(validateAutomationRules({}), {});
  assert.deepEqual(validateAutomationRules({ garmentGenderMinConfidence: undefined, classificationMinConfidence: 0.65 }), { classificationMinConfidence: 0.65 });
  for (const key of Object.keys(DEFAULT_AUTOMATION_RULES)) {
    for (const value of [0.5, 0.65, 0.95]) assert.deepEqual(validateAutomationRules({ [key]: value }), { [key]: value });
    for (const value of [0.49, 0.951, 0, 1, Infinity, -Infinity, NaN, '0.8', null, true]) {
      assert.throws(() => validateAutomationRules({ [key]: value }), /debe ser un número finito entre 0.5 y 0.95/);
    }
  }
  for (const value of [null, [], 3, 'rules']) assert.throws(() => validateAutomationRules(value as any), /deben ser un objeto/);
});

test('effective configuration explains the source of every default, system value and client override', () => {
  const defaults = resolveEffectiveAutomationConfig({ client: { id: 'client' } });
  for (const [key, entry] of Object.entries(defaults)) if (key !== 'issues') assert.equal((entry as any).source, 'predeterminado', key);
  assert.equal(defaults.budgetUsd.value, 10);
  assert.equal(defaults.maxReviewAttempts.value, 3);
  assert.equal(defaults.maxOperationalRetries.value, 2);
  assert.equal(defaults.garmentGenderMinConfidence.value, 0.65);
  assert.equal(defaults.classificationMinConfidence.value, 0.65);
  assert.deepEqual(defaults.issues, []);
  const system = { automationBudget: { ...DEFAULT_AUTOMATION_BUDGET, defaultBudgetUsd: 7, maxReviewAttempts: 4, maxOperationalRetries: 3 },
    automationRules: { garmentGenderMinConfidence: 0.8, classificationMinConfidence: 0.75 }, organizerAutoGenerationEnabled: true };
  const inherited = resolveEffectiveAutomationConfig({ system, client: {} });
  for (const key of ['budgetUsd', 'maxReviewAttempts', 'maxOperationalRetries', 'garmentGenderMinConfidence', 'classificationMinConfidence', 'organizerGenerationEnabled'] as const) assert.equal(inherited[key].source, 'sistema', key);
  const automation: ClientAutomationConfig = { defaultBudgetUsd: 5, maxReviewAttempts: 2, maxOperationalRetries: 0,
    defaultPreset: 'custom', presets: { custom: {} }, defaultMaleModelId: 'male', defaultFemaleModelId: 'female',
    rules: { garmentGenderMinConfidence: 0.9, classificationMinConfidence: 0.85 }, organizerGeneration: { enabled: true, preset: 'standard' } };
  const overridden = resolveEffectiveAutomationConfig({ system, client: { id: 'client', automation } });
  for (const [key, entry] of Object.entries(overridden)) if (key !== 'issues') assert.equal((entry as any).source, 'cliente', key);
  assert.deepEqual(overridden.budgetUsd, { value: 5, source: 'cliente' });
  assert.deepEqual(overridden.maxOperationalRetries, { value: 0, source: 'cliente' });
  assert.deepEqual(overridden.defaultPreset, { value: 'custom', source: 'cliente' });
  assert.deepEqual(overridden.organizerGenerationPreset, { value: 'standard', source: 'cliente' });
  assert.deepEqual(overridden.issues, []);
});

test('effective model defaults reuse client-scoped automatic gender choices and explicit preset model priority', () => {
  const models = [{ id: 'man', clientId: 'client', identityTraits: { sex: 'male' } }, { id: 'woman', clientId: 'client', identityTraits: { sex: 'female' } },
    { id: 'foreign', clientId: 'other', identityTraits: { sex: 'male' } }] as Model[];
  const inferred = resolveEffectiveAutomationConfig({ client: { id: 'client' }, models });
  assert.deepEqual(inferred.maleModelId, { value: 'man', source: 'predeterminado' });
  assert.deepEqual(inferred.femaleModelId, { value: 'woman', source: 'predeterminado' });
  const fallback = resolveEffectiveAutomationConfig({ client: { id: 'client', automation: { defaultModelId: 'fallback' } }, models });
  assert.deepEqual(fallback.maleModelId, inferred.maleModelId);
  assert.deepEqual(fallback.femaleModelId, inferred.femaleModelId);
  const explicit = resolveEffectiveAutomationConfig({ client: { id: 'client', automation: { defaultModelId: 'fallback', defaultPreset: 'custom', presets: { custom: { modelId: 'chosen' } } } }, models });
  assert.deepEqual(explicit.maleModelId, { value: 'chosen', source: 'cliente' });
  assert.deepEqual(explicit.femaleModelId, { value: 'chosen', source: 'cliente' });
  const standard = resolveEffectiveAutomationConfig({ client: { id: 'client', automation: { presets: { standard: { modelId: 'chosen' } } } }, models });
  assert.equal(standard.maleModelId.value, 'chosen');
  const organizer = resolveEffectiveAutomationConfig({ client: { id: 'client', automation: { defaultPreset: 'custom', organizerGeneration: { preset: 'organizer' },
    presets: { custom: { modelId: 'default-model' }, organizer: { modelId: 'organizer-model' } } } }, models });
  assert.deepEqual(organizer.maleModelId, { value: 'organizer-model', source: 'cliente' });
});

test('preset resolution retains request, client and job type precedence, including Organizer inheritance', () => {
  assert.equal(resolveAutomationPresetName({ jobType: 'garment' }), 'standard');
  assert.equal(resolveAutomationPresetName({ jobType: 'product' }), 'generic_product');
  assert.equal(resolveAutomationPresetName({ jobType: 'product' }, { defaultPreset: 'custom' }), 'custom');
  assert.equal(resolveAutomationPresetName({ jobType: 'product', preset: 'requested' }, { defaultPreset: 'custom' }), 'requested');
  const config = resolveEffectiveAutomationConfig({ client: { automation: { defaultPreset: 'custom', presets: { custom: {} } } } });
  assert.deepEqual(config.organizerGenerationPreset, { value: 'custom', source: 'cliente' });
});

test('Organizer generation requires both switches, defaults to current behavior and respects disabled clients', () => {
  for (const global of [undefined, true, false]) for (const enabled of [undefined, true, false]) {
    const result = resolveEffectiveAutomationConfig({ system: { organizerAutoGenerationEnabled: global }, client: { automation: { organizerGeneration: { enabled } } } });
    assert.equal(result.organizerGenerationEnabled.value, global !== false && enabled !== false, `${global}/${enabled}`);
    assert.equal(result.organizerGenerationEnabled.source, global === false ? 'sistema' : enabled !== undefined ? 'cliente' : global !== undefined ? 'sistema' : 'predeterminado');
  }
  for (const client of [{ automation: { enabled: false } }, { status: 'archived' as const }]) {
    assert.equal(resolveEffectiveAutomationConfig({ client }).organizerGenerationEnabled.value, false);
  }
});

test('invalid policy and unavailable presets become visible issues without breaking the draft summary', () => {
  for (const automation of [{ enabled: false }, { defaultBudgetUsd: 200 }, { maxReviewAttempts: 8 }, { maxOperationalRetries: 9 }]) {
    const result = resolveEffectiveAutomationConfig({ client: { automation } });
    assert.ok(result.issues.length);
    assert.ok(result.defaultPreset.value);
    assert.equal(result.classificationMinConfidence.value, 0.65);
  }
  const result = resolveEffectiveAutomationConfig({ client: { automation: { organizerGeneration: { preset: 'deleted' } } } });
  assert.match(result.issues.join(' '), /Cliente → Automatizaciones/);
});
