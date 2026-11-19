import { approvedBasesForInput, modelFromBases } from './support/modelSetFixtures';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { wizardPhotoPlanInput } from '../src/features/generate/wizard/marketplacePlan';
import type { PhotoPlanInput, PhotoArticle, Job, Batch, MasterProduct, PhotoAssignment } from '../shared/src/types';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const sharp = require('sharp');
const { buildMarketplacePhotoPlan, manualPhotoAttribute: attr, PHOTO_RULES } = require('./lib/shared/src/marketplacePhotoPlan.js') as typeof import('../shared/src/marketplacePhotoPlan');
const { normalizePhotoAttributes, mergePhotoAttributes } = require('./lib/shared/src/photoAttributes.js') as typeof import('../shared/src/photoAttributes');
const { createCommercialProviderImageConfig } = require('./lib/shared/src/commercialPhoto.js');
const { compressGeneratedImageIfNeeded } = require('./lib/functions/src/media/compressGeneratedImage.js');
const { prepareMarketplaceImage } = require('./lib/functions/src/media/prepareMarketplaceImage.js');
const { hasSyntheticPerformerXmp, inspectPlannedPhoto } = require('./lib/functions/src/media/photoPlanFile.js');
const { buildAutomaticRetryPromptPatch } = require('./lib/functions/src/workers/jobWorker.helpers.js');
const { buildRegenerateJobPatch } = require('./lib/functions/src/callables/regenerateJob.helpers.js');
const { projectMasterProducts } = require('./lib/functions/src/spreadsheets/masterProducts.js');
const { MARKETPLACE_ADAPTERS } = require('./lib/shared/src/marketplaceExport/adapters.js');
const article = (patch: Partial<PhotoArticle> = {}): PhotoArticle => ({ itemId: 'blue-shirt', productId: 'shirt', variantId: 'blue', name: 'Camiseta azul', kind: 'garment',
  attributes: { category: attr('ordinary'), audience: attr('adult'), bodyArea: attr('upper_body'), packaging: attr('unit'), transparency: attr(false), color: attr('azul'), components: attr('1 camiseta'), gender: attr('unisex') },
  references: ['front', 'side', 'back'].map((view, i) => ({ id: String(i), storagePath: `garments/drafts/operator/${view}.jpg`, view: view as 'front' | 'back' | 'side' })), ...patch });
const rawInput = (channels = ['amazon', 'mercado-libre', 'tiktok-shop', 'shein'], articles = [article()]): PhotoPlanInput => ({ clientId: 'test', marketplaces: Object.fromEntries(channels.map(id => [id, { enabled: true }])), articles, provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4' });

const input: typeof rawInput = (...args) => { const i = rawInput(...args); return { ...i, bases: approvedBasesForInput(i) }; };

test('every active channel gets its own photos; no photo is shared across marketplaces', () => {
  const channels = ['amazon', 'mercado-libre', 'tiktok-shop', 'shein'];
  for (let mask = 1; mask < 16; mask++) {
    const chosen = channels.filter((_, i) => mask & 1 << i); const plan = buildMarketplacePhotoPlan(input(chosen));
    assert.equal(plan.issues.filter(i => i.blocking).length, 0);
    for (const channel of chosen) assert.equal(plan.tasks.filter(t => t.destinations.some(d => d.channel === channel && d.role === 'main')).length, 1);
    assert.equal(new Set(plan.tasks.map(t => t.id)).size, plan.tasks.length);
  }
  const plan = buildMarketplacePhotoPlan(input());
  assert.equal(plan.tasks.length, 12); // 3 views x 4 marketplaces
  assert.ok(plan.tasks.every(t => new Set(t.destinations.map(d => d.channel)).size === 1));
  assert.deepEqual(plan.tasks.filter(t => t.view === 'front').map(t => t.destinations.map(d => d.channel)), [['amazon'], ['mercado-libre'], ['tiktok-shop'], ['shein']]);
  assert.equal(plan.estimate.generations, 12); assert.equal(plan.estimate.reviews, 12);
  assert.ok(!plan.tasks[0].instructions.includes('85%')); // extensive rules belong to validation
});
test('no active channels preserve legacy (no production plan or hidden requirements)', () => {
  const plan = buildMarketplacePhotoPlan(input([])); assert.equal(plan.tasks.length, 0); assert.equal(plan.rules.length, 0);
  assert.equal(plan.estimate.estimatedCostUsd, 0);
});
test('children on SHEIN are allowed; all TikTok child images are flat lay and Amazon exception is scoped', () => {
  const child = article(); child.attributes.audience = attr('child');
  child.references.push({ id: 'detail', storagePath: 'garments/drafts/operator/detail.jpg', view: 'detail' });
  const plan = buildMarketplacePhotoPlan(input(undefined, [child]));
  assert.ok(plan.tasks.filter(t => t.destinations.some(d => d.channel === 'tiktok-shop')).every(t => t.composition === 'flat_lay' && t.background === 'white'));
  assert.equal(plan.tasks.find(t => t.destinations.some(d => d.channel === 'shein' && d.role === 'main'))!.composition, 'model');
  assert.equal(plan.tasks.find(t => t.destinations.some(d => d.channel === 'amazon' && d.role === 'main'))!.composition, 'model');
  child.attributes.category = attr('bodysuit');
  assert.equal(buildMarketplacePhotoPlan(input(['amazon'], [child])).tasks[0].composition, 'flat_lay');
});
test('packs are model free with exact contents; adult underwear/transparency retain coverage without hidden details', () => {
  for (const packaging of ['set', 'multipack'] as const) {
    const pack = article(); pack.attributes.packaging = attr(packaging);
    assert.ok(buildMarketplacePhotoPlan(input(undefined, [pack])).tasks.every(t => t.composition === 'flat_lay'));
  }
  for (const category of ['underwear', 'swimwear'] as const) {
    const a = article(); a.attributes.category = attr(category); a.attributes.transparency = attr(true);
    const plan = buildMarketplacePhotoPlan(input(undefined, [a]));
    assert.ok(plan.tasks.every(t => /no intimate exposure/.test(t.instructions)));
    assert.ok(plan.tasks.every(t => /hidden details/.test(t.instructions)));
  }
});
test('uncertain attributes block only affected articles; manual/commercial facts precede inference and preserve references', () => {
  const a = article(); a.attributes.audience = { value: 'adult', confidence: .4, source: 'gemini', evidence: 'uncertain' };
  const refs = structuredClone(a.references);
  let plan = buildMarketplacePhotoPlan(input(undefined, [a, article({ itemId: 'red', variantId: 'red' })]));
  assert.ok(plan.issues.some(i => i.code === 'attribute-audience' && i.blocking));
  assert.ok(plan.tasks.every(t => t.itemId === 'red'));
  a.attributes = mergePhotoAttributes(a.attributes, { audience: attr('child') });
  assert.deepEqual(a.references, refs);
  assert.ok(buildMarketplacePhotoPlan(input(undefined, [a])).tasks.length);
  assert.equal(normalizePhotoAttributes({ audience: { value: 'alien', confidence: 1 } }).audience?.value, null);
});
test('insufficient back references never invent a back; different variants/references never merge', () => {
  const a = article({ references: [article().references[0]] });
  const plan = buildMarketplacePhotoPlan(input(undefined, [a, article({ itemId: 'red-shirt', variantId: 'red' })]));
  assert.equal(plan.tasks.filter(t => t.itemId === a.itemId).length, 4); // front only, once per marketplace
  assert.ok(plan.issues.some(i => !i.blocking && i.code.startsWith('optional-back')));
  assert.ok(plan.tasks.filter(t => t.itemId === 'red-shirt').every(t => !plan.tasks.filter(o => o.itemId === a.itemId).some(o => o.id === t.id)));
  assert.equal(buildMarketplacePhotoPlan(input(undefined, [article({ references: [] })])).tasks.length, 0);
});
test('deterministic versioned identity binds effective config, evidence and frozen destinations', () => {
  const i = input(); const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.id, buildMarketplacePhotoPlan(structuredClone(i)).id);
  assert.equal(plan.version, 'marketplace-photo-v1');
  assert.notEqual(plan.id, buildMarketplacePhotoPlan({ ...i, aspectRatio: '4:3' }).id);
  assert.notEqual(plan.id, buildMarketplacePhotoPlan(input(['shein'])).id);
  assert.ok(PHOTO_RULES.filter(r => r.channel === 'shein').some(r => r.level === 'preference'));
  assert.ok(!PHOTO_RULES.some(r => r.channel === 'shein' && /fondo blanco/.test(r.text) && r.level === 'obligation'));
});
test('bases require explicit verified recipe approval; observations and labels alone never authorize them', () => {
  const i = input(['amazon']);
  i.bases = [{ id: 'legacy', storagePath: 'models/a.jpg', observation: i.bases![0].observation }];
  const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.tasks.length, 0);
  assert.ok(plan.issues.some(issue => issue.code === 'base-amazon-front' && issue.blocking));
  i.bases = approvedBasesForInput(i);
  assert.ok(buildMarketplacePhotoPlan(i).tasks.every(task => task.base && !task.identityBase));
});
test('wizard and automation use equivalent planner inputs and task counts', () => {
  const i = input(); const a = article();
  i.marketplaces!.shein = { enabled: true, photoRecipeRevision: 2, photoRecipe: { general: { views: ['back'] }, categories: { ordinary: { views: ['side', 'back'], mainBackground: 'white' } } } };
  const state: any = { provider: i.provider, providerImageConfigs: { [i.provider]: i.imageConfig }, generationKind: 'garment', productScenes: [], garments: [{ id: a.itemId, name: a.name, photoAttributes: a.attributes,
    originalPhotos: a.references.map(r => ({ id: r.id, upload: { storagePath: r.storagePath }, classification: { view: r.view } })) }] };
  const wizardInput = wizardPhotoPlanInput(state, { id: i.clientId, marketplaces: i.marketplaces } as any, modelFromBases(i.bases!));
  const automationInput = { ...i, objectScenes: [], articles: [{ ...a, productId: a.itemId, variantId: a.itemId }] };
  assert.deepEqual(buildMarketplacePhotoPlan(wizardInput), buildMarketplacePhotoPlan(automationInput));
});

test('recipe precedence is per field and per channel, without expanding reference evidence', () => {
  const ordinary = article();
  const underwear = article({ itemId: 'swim', attributes: { ...ordinary.attributes, category: attr('swimwear') } });
  const i = input(['shein', 'mercado-libre'], [ordinary, underwear]);
  i.marketplaces!.shein = { enabled: true, photoRecipeRevision: 7, photoRecipe: {
    general: { views: ['side', 'back'], mainBackground: 'white', additionalComposition: 'flat_lay' },
    categories: { ordinary: { views: ['back', 'detail'], mainBackground: 'neutral' } },
  } };
  const plan = buildMarketplacePhotoPlan(i);
  const gallery = (itemId: string, channel: string) => plan.tasks.filter(t => t.itemId === itemId)
    .flatMap(t => t.destinations.filter(d => d.channel === channel).map(d => ({ ...d, view: t.view, composition: t.composition })))
    .sort((a, b) => a.position - b.position);
  assert.deepEqual(gallery(ordinary.itemId, 'shein').map(t => t.view), ['front', 'back']);
  assert.deepEqual(gallery(underwear.itemId, 'shein').map(t => t.view), ['front', 'side', 'back']);
  assert.deepEqual(gallery(ordinary.itemId, 'mercado-libre').map(t => t.view), ['front', 'side', 'back']);
  assert.equal(gallery(ordinary.itemId, 'shein')[1].composition, 'flat_lay');
  assert.deepEqual(gallery(ordinary.itemId, 'shein')[0].recipeSources, { background: 'category', composition: 'default' });
  assert.ok(plan.tasks.filter(t => t.itemId === ordinary.itemId && t.view === 'front').every(t => t.destinations.length === 1));
  assert.equal(plan.tasks.filter(t => t.itemId === ordinary.itemId && t.view === 'front').length, 2);
  assert.ok(plan.tasks.filter(t => t.itemId === ordinary.itemId && t.view === 'back').length === 2);
  assert.ok(plan.issues.some(issue => issue.code === 'optional-detail-shein' && !issue.blocking));
  assert.deepEqual(plan.recipeSnapshot?.channels, [{ channel: 'mercado-libre', revision: 0 }, { channel: 'shein', revision: 7 }]);
  assert.equal(plan.recipeSnapshot?.articles[0].channels[1].sources.additionalComposition, 'client');
  assert.equal(plan.estimate.uniqueImages, plan.tasks.length);
});

test('recipe review holds the article without dropping references and channel restrictions still govern appearance', () => {
  const child = article();
  child.attributes.audience = attr('child');
  child.references.push({ id: 'detail', storagePath: 'garments/drafts/operator/detail.jpg', view: 'detail' });
  const i = input(['tiktok-shop', 'shein'], [child]);
  i.marketplaces!['tiktok-shop'] = { enabled: true, photoRecipeRevision: 1, photoRecipe: {
    general: { views: ['back', 'detail'], missingReference: 'review', additionalBackground: 'neutral', mainComposition: 'model' }, categories: {},
  } };
  const held = buildMarketplacePhotoPlan(i);
  assert.equal(held.tasks.length, 0);
  assert.deepEqual(held.articles[0].references, child.references);
  assert.ok(held.issues.some(issue => issue.code === 'recipe-reference-detail-tiktok-shop' && issue.blocking));
  i.marketplaces!['tiktok-shop'].photoRecipe!.general.missingReference = 'omit';
  const plan = buildMarketplacePhotoPlan(i);
  const tiktok = plan.tasks.filter(t => t.destinations.some(d => d.channel === 'tiktok-shop'));
  assert.deepEqual(tiktok.map(t => [t.view, t.background, t.composition]), [['front', 'white', 'flat_lay'], ['back', 'white', 'flat_lay']]);
  assert.equal(tiktok[0].destinations[0].recipeSources?.composition, 'constraint');
  assert.ok(plan.issues.some(issue => issue.code === 'tiktok-child-detail' && !issue.blocking));
  assert.equal(buildMarketplacePhotoPlan({ ...i, articles: [article({ references: [] })] }).tasks.length, 0);
});

test('restoring defaults preserves legacy approval ID and optional gallery while a revision changes a configured plan ID', () => {
  const i = input(['amazon']);
  const original = buildMarketplacePhotoPlan(i);
  i.marketplaces!.amazon!.photoRecipe = { general: { views: [] }, categories: {} };
  i.marketplaces!.amazon!.photoRecipeRevision = 1;
  const configured = buildMarketplacePhotoPlan(i);
  assert.deepEqual(configured.tasks.map(t => t.view), ['front']);
  i.marketplaces!.amazon!.photoRecipeRevision = 2;
  assert.notEqual(buildMarketplacePhotoPlan(i).id, configured.id);
  delete i.marketplaces!.amazon!.photoRecipe;
  assert.deepEqual(buildMarketplacePhotoPlan(i), original);
});
test('retry prompts retain plan obligations, including manually regenerated historical job compatibility', () => {
  const task = buildMarketplacePhotoPlan(input()).tasks[0];
  const job = { photoTask: task, automationManaged: true, requestedPromptBase: 'original', provider: 'fal-gpt-image-2.5-flare', photoProfile: 'commercial-photo-v1', imageConfig: input().imageConfig, aspectRatio: '3:4' } as Job;
  assert.ok(buildAutomaticRetryPromptPatch(job, 'Fix garment texture').finalPrompt.includes(task.instructions));
  assert.ok(buildRegenerateJobPatch(job, job.provider, 'new request').finalPrompt.includes(task.instructions));
  assert.deepEqual(buildAutomaticRetryPromptPatch({ automationManaged: true } as Job, 'legacy'), { promptBase: 'legacy', finalPrompt: 'legacy' });
});
test('XMP survives final conversion, bytes/weight/hash include it; TikTok 3:4 and 4:3 never become square', async () => {
  for (const [width, height] of [[1200, 1600], [1600, 1200]]) {
    const original = await sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer();
    const normalized = await compressGeneratedImageIfNeeded({ bytes: original, contentType: 'image/png', photoProfile: 'commercial-photo-v1', syntheticPerformer: true });
    assert.ok(hasSyntheticPerformerXmp(normalized.bytes)); assert.equal(normalized.storedImage.sizeBytes, normalized.bytes.length);
    const published = await prepareMarketplaceImage(normalized.bytes, 'tiktok-shop');
    assert.ok(hasSyntheticPerformerXmp(published.bytes)); assert.equal(published.width / published.height, width / height); assert.ok(published.bytes.length < 2900000);
    const technical = await inspectPlannedPhoto(normalized.bytes, buildMarketplacePhotoPlan(input()).tasks[0]); assert.ok(technical.tiktokRatio && technical.xmp && technical.whiteCorners);
  }
});
test('master products stay together across batches and variant assignments remain destination specific', () => {
  const plan = buildMarketplacePhotoPlan(input());
  const batches = ['a', 'b'].map(id => ({ id, automationJobId: 'order', clientId: 'test', photoPlan: plan } as Batch));
  const jobs = plan.tasks.map((task, i) => ({ id: `j${i}`, clientId: 'test', batchId: batches[i % 2].id, garmentId: task.itemId, garmentName: 'shirt', photoTask: task, status: 'completed', currentOutput: { id: `o${i}`, resultImagePath: `generated/test/${batches[i % 2].id}/j${i}/o${i}.jpg`, autoReview: { verdict: 'approved' }, photoValidation: { fidelity: true, destinations: task.destinations.map(d => ({ channel: d.channel, position: d.position, passed: d.channel !== 'amazon', notes: '' })) } } }));
  const products = projectMasterProducts('test', batches, jobs, []);
  assert.equal(products.length, 1); const p = products[0] as MasterProduct;
  assert.deepEqual(p.batchIds.sort(), ['a', 'b']); assert.equal(p.variants[0].id, 'blue');
  assert.ok(p.photoAssignments?.find(a => a.channel === 'tiktok-shop' && a.position === 1)?.eligible);
  assert.equal(p.photoAssignments?.find(a => a.channel === 'amazon' && a.position === 1)?.eligible, false);
  for (const channel of ['amazon', 'shein'] as const) {
    p.marketplaces[channel] = { templateId: 't', categoryId: 'c', imageUrls: Object.fromEntries(p.approvedImages.map(i => [i.outputId, `https://example.com/${i.outputId}.jpg`])) };
    const template: any = { id: 't', exportConfig: { marketplaceId: channel, operation: 'listing', mappings: { c: { main: { source: 'image.0' }, detail: { source: 'image.1' }, image_type: { source: 'assignment.imageType' }, image_sort: { source: 'assignment.imageSort' } } } } };
    const result = MARKETPLACE_ADAPTERS[channel].prepare(p, template, { id: 'c', attributes: [], columns: [{ key: 'main', label: 'main' }, { key: 'detail', label: 'detail' }, { key: 'image_type', label: 'type' }, { key: 'image_sort', label: 'sort' }] });
    if (channel === 'amazon') { assert.ok(result.issues.some((i: { code: string }) => i.code === 'gallery_pending')); assert.equal(result.rows[0].values.main, ''); }
    else { assert.equal(result.rows[0].values.image_type, '1'); assert.equal(result.rows[0].values.image_sort, '1'); const main: PhotoAssignment = p.photoAssignments!.find(a => a.channel === 'shein' && a.position === 1)!; assert.equal(result.rows[0].values.main, `https://example.com/${main.outputId}.jpg`); assert.notEqual(result.rows[0].values.main, result.rows[0].values.detail); }
  }
});

test('objects do not enter marketplace planning even with all channels enabled', () => {
  const plan = buildMarketplacePhotoPlan(input(undefined, [article({ kind: 'product', attributes: {}, references: [article().references[0]] })]));
  assert.deepEqual(plan.channels, []);
  assert.deepEqual(plan.tasks, []);
  assert.equal(plan.estimate.generations, 0);
  assert.deepEqual(plan.issues, []);
});
test('real detail references are reused without generation, while flat lay tasks have no human framing', () => {
  const pack = article(); pack.attributes.packaging = attr('multipack'); pack.references.push({ id: 'detail', storagePath: 'garments/drafts/operator/detail.jpg', view: 'detail' });
  const plan = buildMarketplacePhotoPlan(input(undefined, [pack]));
  assert.ok(plan.tasks.some(t => t.composition === 'reference'));
  assert.ok(plan.tasks.filter(t => t.composition === 'flat_lay').every(t => t.instructions.includes('No person, body parts, mannequin') && !t.instructions.includes('desde muslos')));
  assert.ok(plan.estimate.generations < plan.estimate.uniqueImages);
});
test('visually white and mislabeled bases cannot fall back to identity or RGB assumptions', () => {
  const i = input(['amazon']);
  i.bases = [{ id: 'identity', storagePath: 'models/identity.jpg', observation: { audience: 'adult', orientation: 'front', posture: 'standing', framing: 'upper_body', background: 'white', whiteRgbVerified: false, garmentVisible: true, accessories: false, performer: 'synthetic', verified: true, evidence: 'visually white only' } }];
  const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.tasks.length, 0);
  assert.ok(plan.issues.some(i => i.code === 'base-amazon-front' && i.blocking));
});

test('review requires structured per-destination validation; flattering prose cannot approve a missing field', async t => {
  const usage = require('./lib/functions/src/analytics/geminiUsage.js');
  const reviewer = require('./lib/functions/src/review/geminiImageReview.js');
  const sidePlan = buildMarketplacePhotoPlan(input(['amazon', 'shein']));
  let task = sidePlan.tasks.find(t => t.view === 'side' && t.destinations[0].channel === 'shein')!;
  const amazonTask = sidePlan.tasks.find(t => t.view === 'side' && t.destinations[0].channel === 'amazon')!;
  let omit = false;
  t.mock.method(usage, 'callGeminiGenerateContent', async ({ body }: any) => {
    assert.ok(body.generationConfig.responseJsonSchema.required.includes('photoValidation'));
    // Each photo is validated only against its own marketplace.
    assert.deepEqual(body.generationConfig.responseJsonSchema.properties.photoValidation.properties.destinations.items.properties.channel.enum, [task.destinations[0].channel]);
    return { payload: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ verdict: 'approved', summary: 'All perfect', revisedPrompt: '', criteria: [{ key: 'identity', label: 'Identity', passed: true, notes: '' }], marketplaceData: {},
      ...(!omit ? { photoValidation: { fidelity: true, destinations: task.destinations.map(d => ({ channel: d.channel, position: d.position, passed: d.channel === 'shein', notes: 'Scoped check' })) } } : {}) }) }] } }] } };
  });
  const image = { bytes: Buffer.from('fixture'), mimeType: 'image/jpeg' };
  const request = () => ({ photoTask: task, apiKey: 'test', model: 'test', generationKind: 'product', requestedPromptBase: 'test', promptBase: 'test', finalPrompt: task.instructions, attemptNumber: 1, maxAttempts: 1, poseReference: image, garmentReference: image, generatedImage: image, signal: new AbortController().signal });
  const result = await reviewer.reviewGeneratedImageWithGemini(request());
  assert.equal(result.verdict, 'approved'); assert.deepEqual(result.photoValidation.destinations.map((d: any) => [d.channel, d.passed]), [['shein', true]]);
  task = amazonTask;
  const amazonResult = await reviewer.reviewGeneratedImageWithGemini(request());
  assert.equal(amazonResult.verdict, 'rejected'); assert.deepEqual(amazonResult.photoValidation.destinations.map((d: any) => [d.channel, d.passed]), [['amazon', false]]);
  omit = true; await assert.rejects(reviewer.reviewGeneratedImageWithGemini(request()), /validaciones estructuradas/);
});

test('conservative white preparation preserves product pixels and edges and excludes transparency/light products', async () => {
  const { neutralWhiteBackground } = require('./lib/functions/src/media/neutralWhiteBackground.js');
  const pixels = Buffer.alloc(100 * 100 * 3, 253);
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) { const p = (y * 100 + x) * 3; pixels[p] = 30; pixels[p + 1] = 70; pixels[p + 2] = 150; }
  const original = await sharp(pixels, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
  const prepared = await neutralWhiteBackground(original); assert.ok(prepared.correctedPixels > 0);
  const raw = await sharp(prepared.bytes).removeAlpha().raw().toBuffer();
  assert.deepEqual([...raw.subarray(0, 3)], [255, 255, 255]);
  for (let y = 29; y <= 70; y++) for (let x = 29; x <= 70; x++) { const p = (y * 100 + x) * 3; assert.deepEqual(raw.subarray(p, p + 3), pixels.subarray(p, p + 3)); }
  const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff88' } }).png().toBuffer();
  assert.deepEqual((await neutralWhiteBackground(transparent)).bytes, transparent);
  const light = article(); light.attributes.color = attr('blanco');
  assert.ok(buildMarketplacePhotoPlan(input(['amazon'], [light])).tasks.every(t => !t.backgroundCorrection));
});

test('trousers never reframe a full-body identity base; missing lower-body shots block with references retained', () => {
  const a = article(); a.attributes.bodyArea = attr('lower_body');
  const i = input(['shein'], [a]);
  i.bases = approvedBasesForInput(input(['shein'])); // upper-body bases
  const plan = buildMarketplacePhotoPlan(i);
  assert.equal(plan.tasks.length, 0);
  assert.ok(plan.issues.filter(i => i.blocking).length === 3);
  assert.deepEqual(plan.articles[0].references, a.references);
});

test('a declared sixteen-year-old model remains a minor despite adult-looking visual classification', () => {
  const { withDeclaredModelAge } = require('./lib/shared/src/photoAttributes.js');
  assert.equal(withDeclaredModelAge({ audience: 'adult', evidence: 'appearance' }, { age: '16' }).audience, 'child');
  assert.equal(withDeclaredModelAge({ audience: 'adult', evidence: 'appearance' }, { age: '1' }).audience, 'baby');
  assert.equal(withDeclaredModelAge({ audience: 'child', evidence: 'appearance' }, { age: '65' }).audience, 'adult');
});
