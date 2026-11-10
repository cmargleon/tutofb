import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { wizardPhotoPlanInput } from '../src/features/generate/wizard/marketplacePlan';
import type { PhotoPlanInput, PhotoArticle, Job, Batch, MasterProduct } from '../shared/src/types';
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
  references: ['front', 'back', 'side'].map((view, i) => ({ id: String(i), storagePath: `garments/drafts/operator/${view}.jpg`, view: view as 'front' | 'back' | 'side' })), ...patch });
const input = (channels = ['amazon', 'mercado-libre', 'tiktok-shop', 'shein'], articles = [article()]): PhotoPlanInput => ({ clientId: 'test', marketplaces: Object.fromEntries(channels.map(id => [id, { enabled: true }])), articles, provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4' });

test('all channel combinations deduplicate compatible requirements, not only front labels', () => {
  const channels = ['amazon', 'mercado-libre', 'tiktok-shop', 'shein'];
  for (let mask = 1; mask < 16; mask++) {
    const chosen = channels.filter((_, i) => mask & 1 << i); const plan = buildMarketplacePhotoPlan(input(chosen));
    assert.equal(plan.issues.filter(i => i.blocking).length, 0);
    for (const channel of chosen) assert.equal(plan.tasks.filter(t => t.destinations.some(d => d.channel === channel && d.role === 'main')).length, 1);
    assert.equal(new Set(plan.tasks.map(t => t.id)).size, plan.tasks.length);
  }
  const plan = buildMarketplacePhotoPlan(input());
  assert.equal(plan.tasks.length, 4);
  assert.deepEqual(plan.tasks.filter(t => t.view === 'front').map(t => t.destinations.map(d => d.channel)), [['amazon', 'tiktok-shop'], ['mercado-libre', 'shein']]);
  assert.equal(plan.estimate.generations, 4); assert.equal(plan.estimate.reviews, 4);
  assert.ok(plan.tasks[0].instructions.includes('85%'));
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
    assert.ok(plan.tasks.every(t => /sin exposición íntima/.test(t.instructions)));
    assert.ok(plan.tasks.every(t => /detalles ocultos/.test(t.instructions)));
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
  assert.equal(plan.tasks.filter(t => t.itemId === a.itemId).length, 2);
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
test('bases need observed posture/framing/background/provenance; recipe alone cannot be selected', () => {
  const i = input(['amazon']); i.bases = [{ id: 'recipe', storagePath: 'models/a.jpg' }];
  assert.equal(buildMarketplacePhotoPlan(i).tasks[0].base, null);
  i.bases[0].observation = { whiteRgbVerified: true, audience: 'adult', orientation: 'front', posture: 'standing', framing: 'upper_body', background: 'white', garmentVisible: true, accessories: false, performer: 'real', verified: true, evidence: 'observed' };
  const task = buildMarketplacePhotoPlan(i).tasks[0]; assert.equal(task.base?.id, 'recipe'); assert.equal(task.syntheticPerformer, false);
});
test('wizard and automation use equivalent planner inputs and task counts', () => {
  const i = input(); const a = article();
  const state: any = { provider: i.provider, providerImageConfigs: { [i.provider]: i.imageConfig }, generationKind: 'garment', productScenes: [], garments: [{ id: a.itemId, name: a.name, photoAttributes: a.attributes,
    originalPhotos: a.references.map(r => ({ id: r.id, upload: { storagePath: r.storagePath }, classification: { view: r.view } })) }] };
  const wizardInput = wizardPhotoPlanInput(state, { id: i.clientId, marketplaces: i.marketplaces } as any, null);
  const automationInput = { ...i, objectScenes: [], articles: [{ ...a, productId: a.itemId, variantId: a.itemId }] };
  assert.deepEqual(buildMarketplacePhotoPlan(wizardInput), buildMarketplacePhotoPlan(automationInput));
});
test('retry prompts retain plan obligations, including manually regenerated historical job compatibility', () => {
  const task = buildMarketplacePhotoPlan(input()).tasks[0];
  const job = { photoTask: task, automationManaged: true, requestedPromptBase: 'original', provider: 'fal-gpt-image-2.5-flare', photoProfile: 'commercial-photo-v1', imageConfig: input().imageConfig, aspectRatio: '3:4' } as Job;
  assert.ok(buildAutomaticRetryPromptPatch(job, 'ignore background').finalPrompt.includes(task.instructions));
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
    if (channel === 'amazon') { assert.ok(result.issues.some(i => i.code === 'gallery_pending')); assert.equal(result.rows[0].values.main, ''); }
    else { assert.equal(result.rows[0].values.image_type, '1'); assert.equal(result.rows[0].values.image_sort, '1'); const main = p.photoAssignments!.find(a => a.channel === 'shein' && a.position === 1)!; assert.equal(result.rows[0].values.main, `https://example.com/${main.outputId}.jpg`); assert.notEqual(result.rows[0].values.main, result.rows[0].values.detail); }
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
  assert.ok(plan.tasks.filter(t => t.composition === 'flat_lay').every(t => t.instructions.includes('REMOVE the person entirely') && !t.instructions.includes('desde muslos')));
  assert.ok(plan.estimate.generations < plan.estimate.uniqueImages);
});
test('a visually white base is identity evidence, not a promise of RGB white pixels', () => {
  const i = input(['amazon']); i.bases = [{ id: 'identity', storagePath: 'models/identity.jpg', observation: { audience: 'adult', orientation: 'front', posture: 'standing', framing: 'upper_body', background: 'white', whiteRgbVerified: false, garmentVisible: true, accessories: false, performer: 'synthetic', verified: true, evidence: 'visually white only' } }];
  const task = buildMarketplacePhotoPlan(i).tasks[0]; assert.equal(task.base, null); assert.equal(task.identityBase?.id, 'identity');
  assert.ok(task.instructions.includes('Preserva la identidad exacta'));
});

test('review requires structured per-destination validation; flattering prose cannot approve a missing field', async t => {
  const usage = require('./lib/functions/src/analytics/geminiUsage.js');
  const reviewer = require('./lib/functions/src/review/geminiImageReview.js');
  const task = buildMarketplacePhotoPlan(input(['amazon', 'tiktok-shop'])).tasks[0];
  let omit = false;
  t.mock.method(usage, 'callGeminiGenerateContent', async ({ body }: any) => {
    assert.ok(body.generationConfig.responseJsonSchema.required.includes('photoValidation'));
    return { payload: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ verdict: 'approved', summary: 'All perfect', revisedPrompt: '', criteria: [{ key: 'identity', label: 'Identity', passed: true, notes: '' }], marketplaceData: {},
      ...(!omit ? { photoValidation: { fidelity: true, destinations: task.destinations.map(d => ({ channel: d.channel, position: d.position, passed: d.channel === 'tiktok-shop', notes: 'Scoped check' })) } } : {}) }) }] } }] } };
  });
  const image = { bytes: Buffer.from('fixture'), mimeType: 'image/jpeg' };
  const request = { photoTask: task, apiKey: 'test', model: 'test', generationKind: 'product', requestedPromptBase: 'test', promptBase: 'test', finalPrompt: task.instructions, attemptNumber: 1, maxAttempts: 1, poseReference: image, garmentReference: image, generatedImage: image, signal: new AbortController().signal };
  const result = await reviewer.reviewGeneratedImageWithGemini(request);
  assert.equal(result.verdict, 'approved'); assert.equal(result.photoValidation.destinations[0].passed, false); assert.equal(result.photoValidation.destinations[1].passed, true);
  omit = true; await assert.rejects(reviewer.reviewGeneratedImageWithGemini(request), /validaciones estructuradas/);
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

test('trousers retain their back and side identity references when full-body bases require reframing', () => {
  const a = article(); a.attributes.bodyArea = attr('lower_body');
  const i = input(['shein'], [a]);
  i.bases = ['front', 'back', 'side'].map(view => ({ id: view, storagePath: `models/${view}.jpg`, observation: { audience: 'adult', orientation: view, posture: 'standing', framing: 'full_body', background: 'white', garmentVisible: true, accessories: false, performer: 'synthetic', verified: true, evidence: 'observed' } })) as any;
  for (const task of buildMarketplacePhotoPlan(i).tasks) { assert.equal(task.identityBase?.id, task.view); assert.ok(task.instructions.includes('debajo de pies')); }
});

test('a declared sixteen-year-old model remains a minor despite adult-looking visual classification', () => {
  const { withDeclaredModelAge } = require('./lib/shared/src/photoAttributes.js');
  assert.equal(withDeclaredModelAge({ audience: 'adult', evidence: 'appearance' }, { age: '16' }).audience, 'child');
  assert.equal(withDeclaredModelAge({ audience: 'adult', evidence: 'appearance' }, { age: '1' }).audience, 'baby');
  assert.equal(withDeclaredModelAge({ audience: 'child', evidence: 'appearance' }, { age: '65' }).audience, 'adult');
});
