import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ModelMarketplaceRules, PhotoPlanInput } from '../shared/src/types';
import { approvedBasesForInput } from './support/modelSetFixtures';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const rules = require('./lib/shared/src/modelMarketplaceRules.js') as typeof import('../shared/src/modelMarketplaceRules');
const sets = require('./lib/shared/src/modelPhotoSets.js') as typeof import('../shared/src/modelPhotoSets');
const { MODEL_POSE_RECIPES_BY_ID } = require('./lib/shared/src/modelPoseRecipes.js') as typeof import('../shared/src/modelPoseRecipes');
const { createCommercialProviderImageConfig } = require('./lib/shared/src/commercialPhoto.js');
const { buildMarketplacePhotoPlan, manualPhotoAttribute: a } = require('./lib/shared/src/marketplacePhotoPlan.js');

test('rules preserve current marketplace defaults until saved; strict validation rejects malformed settings', () => {
  for (const channel of ['amazon', 'shein', 'mercado-libre', 'tiktok-shop'] as const) {
    const rule = rules.defaultModelMarketplaceRule(channel);
    assert.deepEqual(rules.validateModelMarketplaceRule(rule), rule);
    assert.deepEqual(rule.allowedPoseRecipeIds, []);
    assert.equal(rule.aspectRatio, channel === 'tiktok-shop' ? '1:1' : 'client');
    assert.equal(rule.main.standingFront, channel === 'amazon');
    assert.equal(sets.modelBaseSpec(channel, 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4').rulesRevision, undefined);
  }
  const base = rules.defaultModelMarketplaceRule('amazon');
  for (const patch of [{ aspectRatio: '16:9' }, { shots: ['commercial_back'] }, { shots: ['front', 'front'] }, { allowedPoseRecipeIds: ['forged'] }, { unexpected: true }, { main: { ...base.main, face: 'hidden' } }, { validation: { ...base.validation, pureWhite: 'false' } }])
    assert.throws(() => rules.validateModelMarketplaceRule({ ...base, ...patch }));
});

test('configured format, background, framing, gaze and approval criteria affect the same frozen spec', () => {
  const rule = rules.defaultModelMarketplaceRule('amazon');
  rule.aspectRatio = '4:3'; rule.main.background = 'neutral'; rule.main.framing = 'lower_body'; rule.main.face = 'hidden'; rule.main.standingFront = false;
  rule.main.lookingAtCamera = false;
  const config: ModelMarketplaceRules = { amazon: { ...rule, revision: 3 } };
  const legacy = sets.modelBaseSpec('amazon', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4');
  const spec = sets.modelBaseSpec('amazon', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', config);
  assert.deepEqual([spec.aspectRatio, spec.background, spec.framing, spec.faceVisible, spec.rulesRevision], ['4:3', 'neutral', 'lower_body', false, 3]);
  assert.equal(sets.sameBaseSpec(legacy, spec), false);
  const prompt = sets.buildModelBasePrompt(spec);
  assert.match(prompt, /4:3/); assert.match(prompt, /No face or head in frame/); assert.match(prompt, /neutral light studio/);
  const observation = { pose: 'front', posture: 'standing', framing: 'lower_body', background: 'neutral', audience: 'adult', faceVisible: false,
    lookingAtCamera: false, mainPoseCompliant: false, identityCoherent: true, verified: true, width: 1600, height: 1200, garmentVisible: true, accessories: false, performer: 'synthetic' } as const;
  assert.deepEqual(sets.baseObservationIssues(spec, observation as any), []);
  assert.ok(sets.baseObservationIssues(spec, { ...observation, identityCoherent: false } as any).length);
  assert.ok(sets.baseObservationIssues(spec, { ...observation, width: 1200 } as any).length);
  assert.ok(sets.baseObservationIssues(spec, { ...observation, garmentVisible: false } as any).length);
  assert.deepEqual(sets.baseObservationIssues({ ...spec, validation: { ...spec.validation!, garmentVisible: false } }, { ...observation, garmentVisible: false } as any), []);
  const clone = JSON.parse(JSON.stringify(spec));
  assert.equal(sets.sameBaseSpec(spec, clone), true);
  clone.validation = { pureWhite: true, noAccessories: true, garmentVisible: true };
  assert.equal(sets.sameBaseSpec(spec, clone), true);
});

test('concrete pose restrictions apply on server and alternative frontal poses use alternative appearance', () => {
  const rule = rules.defaultModelMarketplaceRule('shein');
  rule.main.background = 'white'; rule.alternative.background = 'neutral';
  rule.allowedPoseRecipeIds = rules.MODEL_RULE_POSES.map(pose => pose.id);
  rule.shots = ['front', 'front_three_quarter'];
  const config: ModelMarketplaceRules = { shein: { ...rule, revision: 1 } };
  const pose = MODEL_POSE_RECIPES_BY_ID.get('full-front-diagonal')!;
  const result = sets.concreteModelBaseSpec(pose, 'shein', 'ordinary', 'adult', {}, '3:4', config);
  assert.ok(result.spec); assert.equal(result.spec.role, 'alternative'); assert.equal(result.spec.background, 'neutral');
  const back = rules.MODEL_RULE_POSES.find(p => p.promptProfile.orientation.startsWith('back'))!;
  assert.match(sets.concreteModelBaseSpec(back, 'shein', 'ordinary', 'adult', {}, '3:4', config).reason!, /Vista deshabilitada/);
  config.shein!.allowedPoseRecipeIds = config.shein!.allowedPoseRecipeIds.filter(id => id !== pose.id);
  assert.match(sets.concreteModelBaseSpec(pose, 'shein', 'ordinary', 'adult', {}, '3:4', config).reason!, /Pose deshabilitada/);
});

test('downstream dressing uses configured bases and never accepts approvals from an earlier rule version', () => {
  const input: PhotoPlanInput = { clientId: 'test', provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4',
    marketplaces: { amazon: { enabled: true } }, articles: [{ itemId: 'shirt', productId: 'shirt', variantId: 'blue', name: 'shirt', kind: 'garment',
      attributes: { category: a('ordinary'), audience: a('adult'), bodyArea: a('upper_body'), packaging: a('unit'), transparency: a(false), color: a('blue'), components: a('shirt') },
      references: [{ id: 'front', storagePath: 'draft/front.png', view: 'front' }] }] };
  input.bases = approvedBasesForInput(input);
  const oldPlan = buildMarketplacePhotoPlan(input);
  assert.equal(oldPlan.tasks.length, 1);
  const rule = rules.defaultModelMarketplaceRule('amazon'); rule.aspectRatio = '1:1'; rule.main.background = 'neutral';
  input.modelMarketplaceRules = { amazon: { ...rule, revision: 1 } };
  assert.equal(buildMarketplacePhotoPlan(input).tasks.length, 0);
  const spec = sets.modelBaseSpec('amazon', 'ordinary', 'adult', 'upper_body', 'front', input.marketplaces, input.aspectRatio, input.modelMarketplaceRules);
  const base = structuredClone(oldPlan.tasks[0].base!);
  const approval = base.approvals![0];
  approval.spec = spec;
  approval.observation = { ...approval.observation, background: 'neutral', width: 1200, height: 1200 };
  input.bases = [base];
  const plan = buildMarketplacePhotoPlan(input);
  assert.equal(plan.tasks.length, 1); assert.equal(plan.tasks[0].aspectRatio, '1:1'); assert.equal(plan.tasks[0].background, 'neutral');
  input.modelMarketplaceRules.amazon!.revision = 2;
  assert.equal(buildMarketplacePhotoPlan(input).tasks.length, 0);
});

test('saving is admin-only, validates before writes, preserves other marketplaces and rejects stale editors', async t => {
  const firestore = require('./lib/functions/src/firebase/appFirestore.js');
  const { saveModelMarketplaceRule } = require('./lib/functions/src/models/marketplaceRules.js');
  let stored: any = { marketplaces: { shein: { ...rules.defaultModelMarketplaceRule('shein'), revision: 7 } } };
  const user = { role: 'admin', active: true, clientAccess: { mode: 'all' } };
  const ref = { get: async () => ({ get: (key: string) => stored[key] }) };
  t.mock.method(firestore, 'getAppFirestore', () => ({ doc: () => ref,
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => user }) }) }),
    runTransaction: (callback: any) => callback({ get: ref.get, set: (_: unknown, value: unknown) => { stored = value; } }),
  }));
  const data = { marketplaceId: 'amazon', expectedRevision: 0, rule: rules.defaultModelMarketplaceRule('amazon') };
  await assert.rejects(saveModelMarketplaceRule.run({ data, auth: null }), { code: 'unauthenticated' });
  user.role = 'operador';
  await assert.rejects(saveModelMarketplaceRule.run({ data, auth: { uid: 'operator' } }), { code: 'permission-denied' });
  user.role = 'admin';
  await assert.rejects(saveModelMarketplaceRule.run({ data: { ...data, rule: { ...data.rule, aspectRatio: 'invalid' } }, auth: { uid: 'admin' } }), { code: 'invalid-argument' });
  assert.equal(stored.marketplaces.amazon, undefined);
  const saved = await saveModelMarketplaceRule.run({ data, auth: { uid: 'admin' } });
  assert.equal(saved.rule.revision, 1); assert.equal(stored.marketplaces.shein.revision, 7); assert.equal(stored.updatedByUid, 'admin');
  await assert.rejects(saveModelMarketplaceRule.run({ data, auth: { uid: 'admin' } }), { code: 'aborted' });
  assert.equal(stored.marketplaces.amazon.revision, 1);
  await saveModelMarketplaceRule.run({ data: { ...data, expectedRevision: 1, rule: { ...data.rule, aspectRatio: '4:3' } }, auth: { uid: 'admin' } });
  assert.equal(stored.marketplaces.amazon.revision, 2); assert.equal(stored.marketplaces.amazon.aspectRatio, '4:3');
});


test('preselection merges saved poses only for selected destinations, deduplicates, and accepts clearing all variations', () => {
  const config: ModelMarketplaceRules = {
    amazon: { ...rules.defaultModelMarketplaceRule('amazon'), allowedPoseRecipeIds: ['full-front', 'full-three-quarter'], revision: 1 },
    shein: { ...rules.defaultModelMarketplaceRule('shein'), allowedPoseRecipeIds: ['full-three-quarter', 'back-full'], revision: 2 },
  };
  assert.deepEqual(rules.selectedModelMarketplacePoses(['amazon', 'shein'], config), ['full-front', 'full-three-quarter', 'back-full']);
  assert.deepEqual(rules.selectedModelMarketplacePoses(['shein'], config), ['full-three-quarter', 'back-full']);
  assert.deepEqual(rules.selectedModelMarketplacePoses(['tiktok-shop'], config), []);
  assert.deepEqual(rules.selectedModelMarketplacePoses([], config), []);
  const empty = rules.validateModelMarketplaceRule({ ...rules.defaultModelMarketplaceRule('amazon'), allowedPoseRecipeIds: [] });
  config.amazon = { ...empty, revision: 3 };
  assert.deepEqual(rules.selectedModelMarketplacePoses(['amazon'], config), []);
  assert.match(sets.concreteModelBaseSpec(MODEL_POSE_RECIPES_BY_ID.get('full-front')!, 'amazon', 'ordinary', 'adult', {}, '3:4', config).reason!, /deshabilitada/);
});
