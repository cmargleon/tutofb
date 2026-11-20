import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { ModelBaseSpec, PhotoBaseObservation, PhotoPlanInput } from '../shared/src/types';
import { approvedBasesForInput } from './support/modelSetFixtures';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sets = require('./lib/shared/src/modelPhotoSets.js') as typeof import('../shared/src/modelPhotoSets');
const { buildMarketplacePhotoPlan, manualPhotoAttribute: a, MODEL_DRESSING_GARMENT_REPLACEMENT } = require('./lib/shared/src/marketplacePhotoPlan.js') as typeof import('../shared/src/marketplacePhotoPlan');
const { createCommercialProviderImageConfig } = require('./lib/shared/src/commercialPhoto.js');
const { selectReviewPrompt, MODEL_PLAN_IMAGE_ROLES } = require('./lib/functions/src/review/geminiImageReview.prompts.js') as typeof import('../functions/src/review/geminiImageReview.prompts');

/** JISHOP 20-11 regression: long chino (JST-H04-AZM) on a lower-body back base that wears shorts. */
const chinoInput = (): PhotoPlanInput => {
  const i: PhotoPlanInput = { clientId: 'test', provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4',
    marketplaces: { shein: { enabled: true } },
    articles: [{ itemId: 'JST-H04-AZM', productId: 'p', variantId: 'v', name: 'Pantalón chino largo', kind: 'garment', attributes: {
      category: a('ordinary'), audience: a('adult'), bodyArea: a('lower_body'), packaging: a('unit'), transparency: a(false), components: a('1 pantalón'), color: a('azul'),
    }, references: ['front', 'back'].map(view => ({ id: view, view: view as any, storagePath: `garments/drafts/admin/chino-${view}.jpg` })) }] };
  i.bases = approvedBasesForInput(i); return i;
};
const observation = (spec: ModelBaseSpec, extra: Partial<PhotoBaseObservation> = {}): PhotoBaseObservation => ({
  pose: spec.shot, orientation: 'back', posture: 'standing', framing: spec.framing, background: spec.background, faceVisible: spec.faceVisible, lookingAtCamera: false,
  mainPoseCompliant: false, identityCoherent: true, audience: spec.audience, width: 300, height: 400, garmentVisible: true, accessories: false,
  performer: 'synthetic', verified: true, evidence: 'fixture', ...extra });

test('base prompts use a fitted ankle-length placeholder and never mention shorts, for every framing and shot', () => {
  for (const area of ['upper_body', 'lower_body', 'full_body', 'footwear'] as const) for (const shot of sets.MODEL_SET_SHOTS) {
    const prompt = sets.buildModelBasePrompt(sets.modelBaseSpec('shein', 'ordinary', 'adult', area, shot, {}));
    assert.doesNotMatch(prompt, /short|bermuda/i, `${area}/${shot}`);
    assert.ok(prompt.includes(sets.MODEL_BASE_FILLER_OUTFIT));
    assert.match(prompt, /fitted opaque crew-neck T-shirt/);
    assert.match(prompt, /full-length leggings .* reach the ankles/);
  }
});

test('base verifier rejects non-compliant filler clothing; legacy approvals without the check stay valid', () => {
  const spec = sets.modelBaseSpec('shein', 'ordinary', 'adult', 'lower_body', 'commercial_back', {});
  const legacy = observation(spec);
  assert.deepEqual(sets.baseObservationIssues(spec, legacy), []);
  // New verifications must positively confirm the placeholder clothing.
  assert.ok(sets.baseObservationIssues(spec, legacy, { requireFillerOutfit: true }).includes(sets.MODEL_BASE_FILLER_ISSUE));
  const shorts = observation(spec, { fillerOutfitCompliant: false, fillerOutfitEvidence: 'Short negro por encima de la rodilla.' });
  assert.ok(sets.baseObservationIssues(spec, shorts).includes(sets.MODEL_BASE_FILLER_ISSUE));
  assert.ok(sets.baseObservationIssues(spec, shorts, { requireFillerOutfit: true }).includes(sets.MODEL_BASE_FILLER_ISSUE));
  const leggings = observation(spec, { fillerOutfitCompliant: true, fillerOutfitEvidence: 'Leggings grises hasta el tobillo.' });
  assert.deepEqual(sets.baseObservationIssues(spec, leggings, { requireFillerOutfit: true }), []);
  assert.match(sets.MODEL_BASE_FILLER_VERIFICATION, /hasta los tobillos: short, bermuda.* es false/);
  // A stored approval whose observation says shorts can no longer back a plan.
  const base = { id: 'b', storagePath: 'p.png', approvals: [{ clientId: 'c', modelId: 'm', recipeRevision: 0, spec, poseId: 'b', storagePath: 'p.png', sha256: 's', storageGeneration: '1',
    identitySha256: 'i', observation: shorts, verifiedAt: '', verifiedByUid: 'u', verifierVersion: 'model-base-verifier-v1' as const }] };
  assert.equal(sets.compatibleBaseApproval(base, spec), undefined);
});

test('dressing instructions replace the base clothing and take length and silhouette only from the references', () => {
  const plan = buildMarketplacePhotoPlan(chinoInput());
  const modelTasks = plan.tasks.filter(t => t.composition === 'model');
  assert.ok(modelTasks.some(t => t.outputPose === 'commercial_back'));
  for (const task of modelTasks) {
    assert.ok(task.instructions.includes(MODEL_DRESSING_GARMENT_REPLACEMENT));
    assert.match(task.instructions, /clothing in the FIRST image is a placeholder: fully replace it in the sold garment area/);
    assert.match(task.instructions, /Type, length, silhouette, fit, cut, hems, real color, texture, logos and visible details come ONLY from the garment references/);
    assert.match(task.instructions, /full-length trousers stay full-length down to the ankles, whatever the base wears/);
    assert.doesNotMatch(task.instructions, /short/i);
    assert.match(task.instructions, /Preserve the exact person, age, proportions, pose, gaze, camera, lighting, background and framing of the approved base/);
  }
});

test('regression: long reference + shorts base — the reviewer is told base clothing is placeholder and length comes only from the references', () => {
  const task = buildMarketplacePhotoPlan(chinoInput()).tasks.find(t => t.composition === 'model' && t.outputPose === 'commercial_back')!;
  const review = selectReviewPrompt({ photoTask: task, generationKind: 'garment', finalPrompt: task.instructions } as any);
  assert.ok(review.includes(MODEL_PLAN_IMAGE_ROLES));
  assert.match(review, /IMAGE 1 \(FIRST\) = APPROVED MODEL BASE\. Use it ONLY for person identity, pose, gaze, camera, lighting, background and framing/);
  assert.match(review, /clothing it wears is a neutral placeholder .* ignore it completely/);
  assert.match(review, /MIDDLE IMAGES .* = SOLD GARMENT REFERENCES\. They are the ONLY source of truth for garment type, length/);
  assert.match(review, /LAST IMAGE = GENERATED RESULT/);
  assert.match(review, /key garmentLength/);
  assert.match(review, /Reject a result whose garment length or silhouette follows the base placeholder .* shorts when the references show full-length trousers/);
  assert.match(review, /never ask in revisedPrompt to keep the base clothing/);
  assert.match(review, /La ropa de la base es relleno que debe reemplazarse: no la compares con el resultado/);
  // The roles come before the approved generation prompt, which itself carries the replacement order.
  assert.ok(review.indexOf('IMAGE 1 (FIRST)') < review.indexOf('BEGIN APPROVED GENERATION PROMPT'));
  assert.ok(review.includes(MODEL_DRESSING_GARMENT_REPLACEMENT));
});
