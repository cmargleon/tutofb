import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { PhotoPlanInput } from '../shared/src/types';
import { approvedBasesForInput } from './support/modelSetFixtures';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sets = require('./lib/shared/src/modelPhotoSets.js') as typeof import('../shared/src/modelPhotoSets');
const { buildMarketplacePhotoPlan, manualPhotoAttribute: a, PHOTO_RULES } = require('./lib/shared/src/marketplacePhotoPlan.js') as typeof import('../shared/src/marketplacePhotoPlan');
const { createCommercialProviderImageConfig } = require('./lib/shared/src/commercialPhoto.js');
const { verifyWhiteBackground } = require('./lib/functions/src/media/verifyWhiteBackground.js');
const { buildAutomaticRetryPromptPatch } = require('./lib/functions/src/workers/jobWorker.helpers.js');
const { selectReviewPrompt } = require('./lib/functions/src/review/geminiImageReview.prompts.js');
const sharp = require('sharp');
const input = (): PhotoPlanInput => {
  const i: PhotoPlanInput = { clientId: 'test', provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4',
    marketplaces: { amazon: { enabled: true }, 'tiktok-shop': { enabled: true }, shein: { enabled: true } },
    articles: [{ itemId: 'shirt', productId: 'p', variantId: 'v', name: 'Shirt', kind: 'garment', attributes: {
      category: a('ordinary'), audience: a('adult'), bodyArea: a('upper_body'), packaging: a('unit'), transparency: a(false), components: a('1 shirt'), color: a('blue'),
    }, references: ['front', 'side', 'back'].map(view => ({ id: view, view: view as any, storagePath: `garments/drafts/admin/${view}.jpg` })) }] };
  i.bases = approvedBasesForInput(i); return i;
};
test('destination subset, per-task native ratios and pose/evidence are independent', () => {
  const i = input(); i.selectedChannels = ['amazon', 'tiktok-shop'];
  const plan = buildMarketplacePhotoPlan(i);
  assert.deepEqual(plan.channels, ['amazon', 'tiktok-shop']);
  assert.equal(plan.tasks.length, 6);
  for (const task of plan.tasks) {
    assert.ok(task.base && !task.identityBase);
    assert.equal(task.aspectRatio, task.destinations[0].channel === 'tiktok-shop' ? '1:1' : '3:4');
    assert.ok(task.destinations.every(d => d.channel !== 'shein'));
    if (task.view === 'side') { assert.equal(task.outputPose, 'front_three_quarter'); assert.equal(task.referencePaths.length, 2); }
    if (task.view === 'back') assert.equal(task.outputPose, 'commercial_back');
    assert.ok(task.instructions.length < 850);
    assert.doesNotMatch(task.instructions, /strict lateral|turn.*90|adapta fondo|crea una persona/i);
  }
  const invalid = buildMarketplacePhotoPlan({ ...i, selectedChannels: ['mercado-libre'] });
  assert.ok(invalid.issues.some(issue => issue.blocking && issue.code === 'destinations'));
  assert.equal(invalid.tasks.length, 0);
  assert.ok(PHOTO_RULES.find(rule => rule.id === 'tiktok-set-square')?.level === 'preference');
});
test('every compatibility dimension is checked and imported approvals require verification', () => {
  const i = input(), task = buildMarketplacePhotoPlan(i).tasks[0], spec = task.baseSpec!, base = structuredClone(task.base!);
  const approval = base.approvals!.find(approval => sets.sameBaseSpec(approval.spec, spec))!;
  assert.deepEqual(sets.baseObservationIssues(spec, approval.observation), []);
  for (const patch of [{ pose: 'profile' }, { identityCoherent: false }, { faceVisible: false }, { lookingAtCamera: false }, { framing: 'full_body' },
    { background: 'neutral' }, { whiteRgbVerified: false }, { audience: 'child' }, { garmentVisible: false }, { accessories: true }, { mainPoseCompliant: false }, { width: 1600, height: 1600 }, { verified: false }]) {
    assert.ok(sets.baseObservationIssues(spec, { ...approval.observation, ...patch } as any).length, JSON.stringify(patch));
  }
  approval.requiresReverification = true;
  assert.equal(sets.compatibleBaseApproval({ ...base, approvals: [approval] }, spec), undefined);
  assert.equal(sets.compatibleBaseApproval({ ...base, storagePath: 'replaced.jpg' }, spec), undefined);
  assert.equal(sets.compatibleBaseApproval({ ...base, approvals: [] }, spec), undefined);
});
test('missing bases hold the article without fallback, payment or reference loss; child exceptions bypass models', () => {
  const i = input(); i.bases = [];
  const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.tasks.length, 0); assert.equal(plan.estimate.generations, 0);
  assert.equal(plan.issues.filter(issue => issue.blocking).length, 9);
  assert.deepEqual(plan.articles, i.articles);
  i.selectedChannels = ['tiktok-shop']; i.articles[0].attributes.audience = a('child');
  const child = buildMarketplacePhotoPlan(i);
  assert.equal(child.tasks.length, 3);
  assert.ok(child.tasks.every(task => task.composition === 'flat_lay' && !task.base && task.aspectRatio === '1:1'));
  i.articles[0].attributes.packaging = a('multipack'); i.selectedChannels = ['amazon', 'tiktok-shop', 'shein'];
  assert.ok(buildMarketplacePhotoPlan(i).tasks.every(task => task.composition === 'flat_lay'));
});
test('native square preserves explicit provider quality and format; other destinations preserve the override', () => {
  const i = input(); i.imageConfig = { provider: i.provider as 'fal-gpt-image-2.5-flare', quality: 'high', outputFormat: 'webp', imageSize: { width: 1536, height: 2048 } };
  const square = sets.photoTaskConfig(i, 'tiktok-shop');
  assert.equal(square.aspectRatio, '1:1');
  assert.equal((square.imageConfig as any).quality, 'high'); assert.equal((square.imageConfig as any).outputFormat, 'webp');
  assert.equal((square.imageConfig as any).imageSize.width, (square.imageConfig as any).imageSize.height);
  assert.deepEqual(sets.photoTaskConfig(i, 'shein').imageConfig, i.imageConfig);
});
test('base generation and final review agree on commercial back, natural three-quarter and face-free crops', () => {
  const i = input();
  for (const task of buildMarketplacePhotoPlan(i).tasks) {
    const prompt = sets.buildModelBasePrompt(task.baseSpec!);
    if (task.outputPose === 'commercial_back') assert.match(prompt, /look at the camera over the shoulder/);
    if (task.outputPose === 'front_three_quarter') assert.match(prompt, /Natural commercial three-quarter/);
    const review = selectReviewPrompt({ photoTask: task, generationKind: 'product', finalPrompt: task.instructions } as any);
    assert.match(review, /First image: approved model base/); assert.match(review, /rostro está fuera de cuadro/);
    assert.doesNotMatch(review, /No human model or garment replacement is required/);
  }
  const lower = sets.modelBaseSpec('amazon', 'ordinary', 'adult', 'lower_body', 'commercial_back', i.marketplaces);
  const o = { ...i.bases![0].observation!, pose: 'commercial_back', orientation: 'back', framing: 'lower_body', background: 'neutral', faceVisible: false, lookingAtCamera: false } as any;
  assert.equal(sets.baseObservationIssues(lower, o).length, 0);
  assert.match(sets.buildModelBasePrompt(lower), /Gaze instructions do not apply/);
});
test('contradictory customizations block planning and cannot re-enter through retry prompts', () => {
  const i = input();
  for (const customPrompt of ['Turn the body 90 degrees.', 'Change the background to beige.', 'Do not look at camera.']) {
    const plan = buildMarketplacePhotoPlan({ ...i, customPrompt });
    assert.ok(plan.issues.some(issue => issue.code === 'prompt-conflict' && issue.blocking), customPrompt);
    const job = { photoTask: buildMarketplacePhotoPlan(i).tasks[0] } as any;
    assert.deepEqual(buildAutomaticRetryPromptPatch(job, customPrompt), {});
  }
  assert.deepEqual(sets.photoPromptConflicts('Do not change the background. Preserve fabric texture.'), []);
});
test('technical white verification rejects white corners around a tinted border and transparent white', async () => {
  const n = 80, pixels = Buffer.alloc(n * n * 3, 255);
  const white = await sharp(pixels, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
  assert.equal(await verifyWhiteBackground(white), true);
  for (let y = 25; y < 55; y++) pixels[(y * n) * 3] = 250;
  const cornersOnly = await sharp(pixels, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
  assert.equal(await verifyWhiteBackground(cornersOnly), false);
  assert.equal(await verifyWhiteBackground(await sharp({ create: { width: n, height: n, channels: 4, background: '#ffffff00' } }).png().toBuffer()), false);
});
test('declared age ranges remain conservative and unknown age cannot be inferred as adult', () => {
  const { withDeclaredModelAge } = require('./lib/shared/src/photoAttributes.js');
  assert.equal(withDeclaredModelAge({}, { age: '7-9' }).audience, 'child');
  assert.equal(withDeclaredModelAge({}, { age: '16–25' }).audience, 'child');
  assert.equal(withDeclaredModelAge({}, { age: '25-35' }).audience, 'adult');
  assert.equal(withDeclaredModelAge({}, { age: '65+' }).audience, 'adult');
  assert.equal(withDeclaredModelAge({}, { age: 'unknown' }).audience, undefined);
});

test('operator poses form a distinct pose × destination matrix, with explicit incompatibilities and gallery roles', () => {
  const recipes = require('./lib/shared/src/modelPoseRecipes.js').MODEL_POSE_RECIPES_BY_ID;
  const channels = ['amazon', 'tiktok-shop', 'mercado-libre', 'shein'] as const;
  const marketplaces = Object.fromEntries(channels.map(channel => [channel, { enabled: true }]));
  const ids = ['full-front', 'full-front-diagonal', 'full-three-quarter'];
  const specs = channels.flatMap(channel => ids.map(id => sets.concreteModelBaseSpec(recipes.get(id), channel, 'ordinary', 'adult', marketplaces, '3:4').spec!));
  assert.equal(specs.length, 12);
  assert.equal(new Set(specs.map(spec => JSON.stringify(spec))).size, 12);
  for (const spec of specs) {
    assert.equal(spec.aspectRatio, spec.channel === 'tiktok-shop' ? '1:1' : '3:4');
    assert.equal(spec.role, spec.poseRecipeId === 'full-front' ? 'main' : 'alternative');
    assert.match(sets.buildModelBasePrompt(spec), new RegExp(recipes.get(spec.poseRecipeId).shotType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const a = specs.find(spec => spec.poseRecipeId === 'full-front-diagonal')!;
  const b = specs.find(spec => spec.poseRecipeId === 'full-three-quarter')!;
  assert.equal(a.shot, b.shot); assert.equal(sets.sameBaseSpec(a, b), false);
  assert.ok(sets.baseObservationIssues(a, { verified: true, concretePoseMatches: false } as any).some(issue => issue.includes('concreta')));
  assert.ok(sets.concreteModelBaseSpec(recipes.get('portrait-profile-left'), 'amazon', 'ordinary', 'adult', marketplaces, '3:4').reason);
  assert.ok(sets.concreteModelBaseSpec(recipes.get('full-front'), 'tiktok-shop', 'ordinary', 'child', marketplaces, '3:4').reason);
  const frontGallery = sets.concreteModelBaseSpec(recipes.get('full-contrapposto'), 'amazon', 'ordinary', 'adult', marketplaces, '3:4').spec!;
  assert.equal(frontGallery.role, 'alternative'); assert.equal(frontGallery.background, 'neutral');
});

test('concrete pose approvals still match shared garment planning without conflating distinct poses', () => {
  const i = input();
  const expectedTasks = buildMarketplacePhotoPlan(i).tasks.length;
  for (const base of i.bases!) for (const approval of base.approvals || []) {
    approval.spec.poseRecipeId = approval.spec.shot === 'front' ? 'half-front' : approval.spec.shot === 'commercial_back' ? 'half-back' : 'half-three-quarter';
    approval.observation.concretePoseMatches = true;
  }
  const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.tasks.length, expectedTasks);
  assert.ok(plan.tasks.every(task => task.base?.approvals?.[0].spec.poseRecipeId));
  assert.ok(plan.tasks.filter(task => task.view === 'side').every(task => task.outputPose === 'front_three_quarter' && task.referencePaths.length === 2));
  assert.ok(plan.tasks.filter(task => task.view === 'back').every(task => task.outputPose === 'commercial_back'));
});

test('an article assigned to a model only uses that model approved bases (gender-selected automation)', () => {
  const i = input(); i.selectedChannels = ['shein'];
  const male = approvedBasesForInput(i).map(base => ({ ...base, id: `m-${base.id}`, storagePath: `models/m/${base.id}.jpg`,
    approvals: base.approvals!.map(approval => ({ ...approval, modelId: 'male', poseId: `m-${base.id}`, storagePath: `models/m/${base.id}.jpg` })) }));
  const female = approvedBasesForInput(i).map(base => ({ ...base, id: `f-${base.id}`, storagePath: `models/f/${base.id}.jpg`,
    approvals: base.approvals!.map(approval => ({ ...approval, modelId: 'female', poseId: `f-${base.id}`, storagePath: `models/f/${base.id}.jpg` })) }));
  i.bases = [...female, ...male];
  const shirt = i.articles[0];
  i.articles = [{ ...shirt, itemId: 'men', modelId: 'male' }, { ...shirt, itemId: 'women', modelId: 'female' }];
  const plan = buildMarketplacePhotoPlan(i);
  assert.ok(plan.tasks.length > 0);
  assert.ok(plan.tasks.filter(task => task.itemId === 'men').every(task => task.base?.id.startsWith('m-')));
  assert.ok(plan.tasks.filter(task => task.itemId === 'women').every(task => task.base?.id.startsWith('f-')));
  const missing = buildMarketplacePhotoPlan({ ...i, articles: [{ ...shirt, itemId: 'other', modelId: 'nobody' }] });
  assert.ok(missing.issues.some(issue => issue.blocking && issue.code.startsWith('base-shein')));
});
