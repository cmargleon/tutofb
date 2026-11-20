import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ModelMarketplaceRules, PhotoBaseObservation, ModelBaseSpec } from '../shared/src/types';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { MODEL_NEUTRAL_TONES, MODEL_BACKGROUNDS, modelBackgroundVerification, MODEL_DRESSING_BACKGROUND } = require('./lib/shared/src/modelBackgrounds.js') as typeof import('../shared/src/modelBackgrounds');
const { defaultModelMarketplaceRule, validateModelMarketplaceRule } = require('./lib/shared/src/modelMarketplaceRules.js') as typeof import('../shared/src/modelMarketplaceRules');
const { MODEL_BASE_FILLER_OUTFIT, modelBaseSpec, buildModelBasePrompt, sameBaseSpec, baseObservationIssues, compatibleBaseApproval } = require('./lib/shared/src/modelPhotoSets.js') as typeof import('../shared/src/modelPhotoSets');
const { selectReviewPrompt } = require('./lib/functions/src/review/geminiImageReview.prompts.js');

function observation(spec: ModelBaseSpec): PhotoBaseObservation {
  return { pose: spec.shot, orientation: 'front', posture: 'standing', framing: spec.framing, background: spec.background,
    ...(spec.backgroundTone ? { backgroundTone: spec.backgroundTone, backgroundMatches: true, backgroundEvidence: 'Visible seamless light gray backdrop and soft shadows.' } : {}),
    faceVisible: spec.faceVisible, lookingAtCamera: true, mainPoseCompliant: true, identityCoherent: true, audience: spec.audience,
    width: 300, height: 400, garmentVisible: true, accessories: false, performer: 'synthetic', verified: true, evidence: 'fixture', whiteRgbVerified: true };
}
function configured() {
  const rule = defaultModelMarketplaceRule('shein');
  rule.main = { ...rule.main, background: 'neutral', backgroundTone: 'light_gray' };
  const rules: ModelMarketplaceRules = { shein: { ...rule, revision: 1 } };
  return { rule, rules, spec: modelBaseSpec('shein', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', rules) };
}
test('every neutral tone has one prompt shared by base generation and verification; filler clothing is the shared placeholder', () => {
  const { rule, rules } = configured();
  for (const tone of MODEL_NEUTRAL_TONES) {
    rule.main.backgroundTone = tone;
    rules.shein = { ...rule, revision: 1 };
    assert.deepEqual(validateModelMarketplaceRule(rule), rule);
    const spec = modelBaseSpec('shein', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', rules);
    const prompt = buildModelBasePrompt(spec);
    assert.ok(prompt.includes('Ignore and completely replace the identity reference background, even if it is white.'));
    assert.ok(prompt.includes(MODEL_BACKGROUNDS[tone].prompt));
    assert.ok(modelBackgroundVerification(spec).includes(MODEL_BACKGROUNDS[tone].prompt));
    assert.ok(prompt.includes(MODEL_BASE_FILLER_OUTFIT));
  }
  for (const background of ['white', 'client'] as const) assert.throws(() => validateModelMarketplaceRule({ ...rule, main: { ...rule.main, background } }));
  assert.throws(() => validateModelMarketplaceRule({ ...rule, main: { ...rule.main, backgroundTone: 'pink' } }));
});
test('configured light gray rejects white, wrong tone, missing evidence and uncertain match, and accepts correct tone', () => {
  const { spec } = configured();
  const o = observation(spec);
  assert.deepEqual(baseObservationIssues(spec, o), []);
  assert.ok(baseObservationIssues(spec, { ...o, background: 'white', backgroundTone: 'white' }).includes('Fondo requerido: gris claro neutro; observado: blanco.'));
  for (const patch of [{ backgroundTone: 'off_white' }, { backgroundTone: undefined }, { backgroundMatches: false }, { backgroundEvidence: '' }])
    assert.ok(baseObservationIssues(spec, { ...o, ...patch } as PhotoBaseObservation).some(i => i.startsWith('Fondo requerido:')));
});
test('tone changes invalidate only the edited channel; historical white and generic neutral approvals remain valid', () => {
  const { spec, rules } = configured();
  const other = modelBaseSpec('amazon', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', rules);
  const approval = { spec, poseId: 'base', storagePath: 'base.png', verifierVersion: 'model-base-verifier-v1', observation: observation(spec) } as any;
  const base = { id: 'base', storagePath: 'base.png', approvals: [approval] };
  assert.ok(compatibleBaseApproval(base, spec));
  rules.shein!.main.backgroundTone = 'medium_gray';
  const next = modelBaseSpec('shein', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', rules);
  assert.equal(sameBaseSpec(spec, next), false); // even before revision increment
  assert.equal(compatibleBaseApproval(base, next), undefined);
  assert.equal(sameBaseSpec(next, { ...spec, backgroundTone: undefined }), false);
  rules.shein!.revision++;
  assert.equal(sameBaseSpec(other, modelBaseSpec('amazon', 'ordinary', 'adult', 'upper_body', 'front', {}, '3:4', rules)), true);
  for (const channel of ['amazon', 'shein'] as const) {
    const old = modelBaseSpec(channel, 'ordinary', 'adult', 'upper_body', 'front', {});
    const legacyRule = defaultModelMarketplaceRule(channel); legacyRule.main.background = old.background;
    assert.deepEqual(validateModelMarketplaceRule(legacyRule), legacyRule);
    assert.deepEqual(baseObservationIssues(old, observation(old)), []);
    assert.ok(compatibleBaseApproval({ ...base, approvals: [{ ...approval, spec: old, observation: observation(old) }] }, old));
    if (old.background === 'white') assert.ok(baseObservationIssues(old, { ...observation(old), whiteRgbVerified: false }).some(i => i.includes('perímetro')));
  }
});

test('dressing and final review use the approved base tone instead of identity or garment backgrounds', () => {
  const { buildMarketplacePhotoPlan, manualPhotoAttribute: a } = require('./lib/shared/src/marketplacePhotoPlan.js');
  const { spec, rules } = configured();
  const input = { clientId: 'test', provider: 'fal-gpt-image-2.5-flare', imageConfig: {}, aspectRatio: '3:4', modelMarketplaceRules: rules,
    marketplaces: { shein: { enabled: true } }, articles: [{ itemId: 'shirt', productId: 'shirt', variantId: 'blue', name: 'shirt', kind: 'garment',
      attributes: { category: a('ordinary'), audience: a('adult'), bodyArea: a('upper_body'), packaging: a('unit'), transparency: a(false), color: a('blue'), components: a('shirt') },
      references: [{ id: 'front', storagePath: 'draft/front.png', view: 'front' }] }],
    bases: [{ id: 'base', storagePath: 'base.png', approvals: [{ spec, modelId: 'model', poseId: 'base', storagePath: 'base.png', sha256: 'base-sha', verifierVersion: 'model-base-verifier-v1', observation: observation(spec) }] }] };
  const plan = buildMarketplacePhotoPlan(input);
  assert.equal(plan.tasks.length, 1);
  const task = plan.tasks[0];
  assert.equal(task.baseSpec.backgroundTone, 'light_gray');
  assert.ok(task.instructions.includes(MODEL_DRESSING_BACKGROUND));
  assert.ok(task.instructions.includes(MODEL_BACKGROUNDS.light_gray.prompt));
  const review = selectReviewPrompt({ photoTask: task, finalPrompt: task.instructions });
  assert.ok(review.includes(MODEL_DRESSING_BACKGROUND));
  assert.ok(review.includes(modelBackgroundVerification(spec, 'review')));
  assert.ok(review.includes('Reject a result that copies the identity or garment reference background'));
});
