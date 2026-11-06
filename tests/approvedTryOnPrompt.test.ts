import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CreateGenerationBatchRequest, GarmentBodyArea, Job } from '../shared/src/types';
import type { UploadedGarmentDraft } from '../src/features/generate/types';

const require = createRequire(import.meta.url);
const { APPROVED_TRY_ON_PROMPT_FORMAT, composeApprovedTryOnPrompt, seedTryOnPrompt, validateApprovedTryOnPrompt } = require('../shared/src/approvedTryOnPrompt') as typeof import('../shared/src/approvedTryOnPrompt');
const { DEFAULT_TRY_ON_PROMPT, INTERNAL_GARMENT_DETAILS_PROMPT_MARKER, CARRY_ACCESSORY_PROMPT_MARKER, resolveTryOnPromptCaseKey } = require('../shared/src/domain') as typeof import('../shared/src/domain');
const { createInitialGenerateWizardState } = require('../src/features/generate/wizard/state') as typeof import('../src/features/generate/wizard/state');
const { buildCreateGenerationBatchRequest } = require('../src/features/generate/wizard/submit') as typeof import('../src/features/generate/wizard/submit');
const { TryOnPromptFields } = require('../src/components/wizard/TryOnPromptFields') as typeof import('../src/components/wizard/TryOnPromptFields');
const { buildJobDraft, validateCreateGenerationBatchInput } = require('../functions/lib/functions/src/callables/createGenerationBatch.helpers.js') as typeof import('../functions/src/callables/createGenerationBatch.helpers');
const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js') as typeof import('../functions/src/callables/regenerateJob.helpers');
const { buildAutomaticRetryPromptPatch } = require('../functions/lib/functions/src/workers/jobWorker.helpers.js') as typeof import('../functions/src/workers/jobWorker.helpers');
const { generateWithProvider } = require('../functions/lib/functions/src/providers/index.js') as typeof import('../functions/src/providers');
const { createDefaultProviderImageConfig } = require('../functions/lib/shared/src/providerImageConfig.js') as typeof import('../shared/src/providerImageConfig');
const { PROVIDER_VALUES } = require('../functions/lib/shared/src/domain.js') as typeof import('../shared/src/domain');
const reviewModule = require('../functions/lib/functions/src/review/geminiImageReview.js') as typeof import('../functions/src/review/geminiImageReview');
const usageModule = require('../functions/lib/functions/src/analytics/geminiUsage.js');

const traits = (hairColor: string) => ({ sex: '', age: '', skin: '', hairColor, hairLength: '', build: '' });
const draftGarment = (id: string, garmentBodyArea?: GarmentBodyArea): UploadedGarmentDraft => ({ id, name: id, garmentBodyArea } as UploadedGarmentDraft);
const makeRequest = () => {
  const state = createInitialGenerateWizardState();
  state.selectedClientId = 'client'; state.selectedModelId = 'model'; state.selectedPoseIds = ['pose'];
  state.outputMode = 'photos_only'; state.generationKind = 'garment';
  state.garments = [draftGarment('sweater', 'upper_body'), draftGarment('pants', 'lower_body')];
  const garments = state.garments.map(({ id, name, garmentBodyArea }) => ({
    id, name, garmentBodyArea, sourceType: 'single' as const, isMultiAngle: false,
    storagePath: `garments/drafts/user/draft/${id}.jpg`,
  }));
  return { state, request: buildCreateGenerationBatchRequest(state, garments) };
};

test('cases follow classification only; mixed lots expose B and C and no invented A', () => {
  for (const [area, expected] of [['full_body', 'full_outfit'], ['upper_body', 'top_only'], ['lower_body', 'bottom_only'], ['carry_accessory', 'carry_accessory'], ['footwear', null], ['head_accessory', null], [undefined, null]] as const) {
    assert.equal(resolveTryOnPromptCaseKey(area), expected);
  }
  const { state, request } = makeRequest();
  const html = renderToStaticMarkup(React.createElement(TryOnPromptFields, { state, sourceLabel: 'Configuración', onPromptChange() {}, onBlocksChange() {} }));
  assert.match(html, /Caso B · Prenda superior/); assert.match(html, /Caso C · Prenda inferior/);
  assert.doesNotMatch(html, /Caso A · Conjunto completo|Reglas de accesorios/);
  assert.match(request.approvedPrompts![0].text, /CASE B/); assert.doesNotMatch(request.approvedPrompts![0].text, /CASE C/);
  assert.match(request.approvedPrompts![1].text, /CASE C/); assert.doesNotMatch(request.approvedPrompts![1].text, /CASE B/);
  state.garments = [draftGarment('shoes', 'footwear')];
  const shoes = renderToStaticMarkup(React.createElement(TryOnPromptFields, { state, sourceLabel: 'default', onPromptChange() {}, onBlocksChange() {} }));
  assert.doesNotMatch(shoes, /Caso [ABC] ·/); assert.match(shoes, /Sin caso A\/B\/C/);
});

test('seeding separates exact default blocks without duplicate rules or loss of configured intent', () => {
  const seeded = seedTryOnPrompt(DEFAULT_TRY_ON_PROMPT, traits('black'), { systemPromptTopOnly: 'Keep jeans' });
  assert.doesNotMatch(seeded.general, /INTERNAL GARMENT DETAILS|CARRY ACCESSORY RULES/);
  assert.match(seeded.blocks.identity, /Hair color anchor: black/);
  assert.equal(seeded.blocks.cases.top_only, 'Keep jeans');
  const prompt = composeApprovedTryOnPrompt(seeded.general, seeded.blocks, 'carry_accessory');
  assert.equal(prompt.split(INTERNAL_GARMENT_DETAILS_PROMPT_MARKER).length - 1, 1);
  assert.equal(prompt.split(CARRY_ACCESSORY_PROMPT_MARKER).length - 1, 1);
  assert.equal(prompt.split('- Preserve 100%').length - 1, 1);
  assert.equal(seedTryOnPrompt('Custom tags and background instruction').general, 'Custom tags and background instruction');
  assert.doesNotMatch(composeApprovedTryOnPrompt(seeded.general, seeded.blocks, 'upper_body'), /CARRY ACCESSORY RULES|multiples angulos/);
  assert.match(composeApprovedTryOnPrompt(seeded.general, seeded.blocks, 'upper_body', 'multi_angle_composite'), /multiples angulos/);
});

test('wizard exposes only the selected model gender block and preserves local edits and deletion in the submitted prompt', () => {
  const { state, request } = makeRequest();
  const config = { systemPromptMale: 'Male global instructions', systemPromptFemale: 'Female global instructions' };
  for (const sex of ['male', 'female'] as const) {
    state.tryOnPromptBlocks = seedTryOnPrompt(state.prompt, { ...traits('black'), sex }, config).blocks;
    const name = sex === 'male' ? 'hombre' : 'mujer';
    const html = renderToStaticMarkup(React.createElement(TryOnPromptFields, { state, sourceLabel: 'Configuración', onPromptChange() {}, onBlocksChange() {} }));
    assert.ok(html.includes(`Prendas · Prompt adicional para modelo ${name}`));
    assert.ok(!html.includes(`Prendas · Prompt adicional para modelo ${sex === 'male' ? 'mujer' : 'hombre'}`));
    state.tryOnPromptBlocks.gender = 'Local gender instructions';
    for (const entry of buildCreateGenerationBatchRequest(state, request.garments).approvedPrompts!) {
      assert.equal(entry.text.split('Local gender instructions').length - 1, 1);
      assert.doesNotMatch(entry.text, /Male global instructions|Female global instructions/);
    }
    state.tryOnPromptBlocks.gender = '';
    assert.doesNotMatch(buildCreateGenerationBatchRequest(state, request.garments).approvedPrompts![0].text, /Local gender instructions|Male global instructions|Female global instructions/);
  }
});

test('deleted blocks stay deleted through frontend preview, validation, persistence and regeneration', () => {
  const { state, request } = makeRequest();
  state.prompt = '  Only the instructions I approved.\n';
  state.tryOnPromptBlocks.identity = ''; state.tryOnPromptBlocks.internalLabels = '';
  state.tryOnPromptBlocks.accessories = ''; state.tryOnPromptBlocks.cases.top_only = '';
  const approvedRequest = buildCreateGenerationBatchRequest(state, request.garments);
  const preview = composeApprovedTryOnPrompt(state.prompt, state.tryOnPromptBlocks, 'upper_body');
  assert.equal(preview, state.prompt);
  const validated = validateCreateGenerationBatchInput(approvedRequest, 'user', 100);
  assert.equal(validated.approvedPrompts![0].text, preview);
  const stored = buildJobDraft({ garmentIsMultiAngle: true, promptCaseText: 'HIDDEN RULES', promptCaseKey: 'top_only' }, 'fal-banana-pro', 'backend base', traits('DO NOT INSERT'), 3, preview);
  assert.equal(stored.finalPrompt, preview); assert.equal(stored.promptBase, preview); assert.equal(stored.requestedPromptBase, preview);
  const job = { ...stored, aspectRatio: '3:4' } as Job;
  const edited = '  Edited approved text\n\n';
  assert.equal(buildRegenerateJobPatch(job, 'fal-banana-pro', edited).finalPrompt, edited);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    Object.assign(job, buildAutomaticRetryPromptPatch(job));
    assert.equal(job.finalPrompt, preview); assert.equal(job.promptBase, preview);
  }
});

test('approved contract rejects missing/duplicate/foreign prompts, invalid formats and excessive size without fallback', () => {
  const { request } = makeRequest();
  const validate = (patch: Partial<CreateGenerationBatchRequest>) => validateCreateGenerationBatchInput({ ...request, ...patch }, 'user', 100);
  for (const approvedPrompts of [undefined, [], [request.approvedPrompts![0], request.approvedPrompts![0]], [{ garmentId: 'foreign', text: 'x' }, request.approvedPrompts![1]], [{ garmentId: 'sweater', text: '' }, request.approvedPrompts![1]]]) {
    assert.throws(() => validate({ approvedPrompts }));
  }
  assert.throws(() => validate({ promptFormat: 'unknown' as any }));
  assert.throws(() => validateApprovedTryOnPrompt('x'.repeat(30001)));
  assert.throws(() => validateApprovedTryOnPrompt('invalid\u0000text'));
  assert.throws(() => validateApprovedTryOnPrompt('  '));
  assert.equal(validateApprovedTryOnPrompt(' \nvalid\n '), ' \nvalid\n ');
});

test('all fal providers receive exactly the preview and Gemini reviews that same approved text and images', async (t) => {
  const { request } = makeRequest();
  const prompt = request.approvedPrompts![0].text;
  const posts: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body as string));
      return Response.json({ request_id: 'id', status_url: 'https://fake/status', response_url: 'https://fake/result' });
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.endsWith('/result')) return Response.json({ images: [{ url: 'https://fake/image', content_type: 'image/png' }] });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  });
  for (const provider of PROVIDER_VALUES) {
    await generateWithProvider(provider, { prompt, imageConfig: createDefaultProviderImageConfig(provider), poseImageUrl: 'https://fake/pose', garmentImageUrl: 'https://fake/garment', signal: AbortSignal.timeout(1000) }, { falKey: 'test' });
    assert.equal(posts.at(-1).prompt, prompt);
  }
  let geminiBody: any;
  let passes = false;
  t.mock.method(usageModule, 'callGeminiGenerateContent', async ({ body }: any) => {
    geminiBody = body;
    return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'approved', summary: 'Result', revisedPrompt: 'Proposed correction', criteria: [{ key: 'pose', label: 'Pose', passed: passes, notes: 'Exact preservation required' }] }) }] } }] } };
  });
  const asset = (text: string) => ({ bytes: Buffer.from(text), mimeType: 'image/png' });
  const reviewRequest = { apiKey: 'test', model: 'test', promptFormat: APPROVED_TRY_ON_PROMPT_FORMAT,
    requestedPromptBase: 'not the reference', promptBase: 'not the reference', finalPrompt: prompt,
    modelIdentityTraitsSnapshot: traits('HIDDEN TRAIT'), attemptNumber: 1, maxAttempts: 3,
    poseReference: asset('pose'), garmentReference: asset('garment'), generatedImage: asset('result'), signal: AbortSignal.timeout(1000) };
  const review = await reviewModule.reviewGeneratedImageWithGemini(reviewRequest);
  assert.equal(review.verdict, 'rejected'); // Failed criterion cannot be overruled by the verdict.
  assert.equal(review.revisedPrompt, 'Proposed correction');
  const parts = geminiBody.contents[0].parts;
  assert.equal(parts[0].text, reviewModule.buildApprovedTryOnReviewPrompt(prompt));
  assert.ok(parts[0].text.includes(`\n\n${prompt}\n\n`));
  assert.doesNotMatch(parts[0].text, /HIDDEN TRAIT|not the reference|70%|Small variations in posture/);
  assert.deepEqual(parts.slice(1).map((part: any) => Buffer.from(part.inline_data.data, 'base64').toString()), ['pose', 'garment', 'result']);
  assert.match(parts[0].text, /complete, self-contained corrected generation prompt in English for the next automatic attempt/);
  assert.match(geminiBody.generationConfig.responseJsonSchema.properties.revisedPrompt.description, /next image generation attempt/);
  const job = { promptFormat: APPROVED_TRY_ON_PROMPT_FORMAT, requestedPromptBase: prompt, promptBase: prompt, finalPrompt: prompt } as Job;
  Object.assign(job, buildAutomaticRetryPromptPatch(job, review.revisedPrompt!));
  assert.equal(job.requestedPromptBase, prompt);
  assert.equal(job.promptBase, 'Proposed correction');
  assert.equal(job.finalPrompt, 'Proposed correction');
  await generateWithProvider('fal-banana-pro', { prompt: job.finalPrompt, imageConfig: createDefaultProviderImageConfig('fal-banana-pro'), poseImageUrl: 'https://fake/pose', garmentImageUrl: 'https://fake/garment', signal: AbortSignal.timeout(1000) }, { falKey: 'test' });
  assert.equal(posts.at(-1).prompt, 'Proposed correction');
  await reviewModule.reviewGeneratedImageWithGemini({ ...reviewRequest, promptBase: job.promptBase, finalPrompt: job.finalPrompt, attemptNumber: 2 });
  assert.equal(geminiBody.contents[0].parts[0].text, reviewModule.buildApprovedTryOnReviewPrompt('Proposed correction'));
  passes = true;
  assert.equal((await reviewModule.reviewGeneratedImageWithGemini(reviewRequest)).verdict, 'approved');
  const minimal = reviewModule.buildApprovedTryOnReviewPrompt('Change the background');
  assert.doesNotMatch(minimal, /INTERNAL GARMENT DETAILS|IDENTITY PRESERVATION RULES|CARRY ACCESSORY RULES/);
});

test('legacy garment jobs and product retries retain historical behavior', () => {
  const legacy = { promptBase: 'base', requestedPromptBase: 'original', garmentIsMultiAngle: false } as Job;
  assert.match(buildAutomaticRetryPromptPatch(legacy, 'correction').finalPrompt!, /IDENTITY PRESERVATION RULES/);
  const product = { ...legacy, generationKind: 'product' } as Job;
  assert.match(buildAutomaticRetryPromptPatch(product, 'fix').finalPrompt!, /original\nCorrection: fix/);
  assert.match(buildRegenerateJobPatch({ ...legacy, aspectRatio: '3:4' }, 'fal-banana-pro', 'new').finalPrompt, /INTERNAL GARMENT DETAILS/);
});

test('automatic retries apply successive corrections and preserve the current prompt when Gemini omits one', () => {
  for (const generationKind of ['garment', 'product'] as const) {
    const job = { generationKind, promptFormat: generationKind === 'garment' ? APPROVED_TRY_ON_PROMPT_FORMAT : undefined,
      requestedPromptBase: 'Original intent', promptBase: 'Original intent', finalPrompt: 'Original provider prompt' } as Job;
    for (const correction of ['Fix color', 'Fix logo']) {
      Object.assign(job, buildAutomaticRetryPromptPatch(job, correction));
      assert.equal(job.requestedPromptBase, 'Original intent');
      assert.equal(job.promptBase, correction);
      if (generationKind === 'garment') assert.equal(job.finalPrompt, correction);
      else assert.ok(job.finalPrompt.endsWith(`Original intent\nCorrection: ${correction}`));
    }
    for (const missing of [undefined, '', '  ']) {
      assert.deepEqual(buildAutomaticRetryPromptPatch(job, missing), {});
    }
  }
});

test('product review correction is applied to the next generation prompt', async (t) => {
  let geminiBody: any;
  t.mock.method(usageModule, 'callGeminiGenerateContent', async ({ body }: any) => {
    geminiBody = body;
    return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'rejected', summary: 'Logo incorrecto', revisedPrompt: 'Keep the exact mug and restore its logo', criteria: [{ key: 'logos', label: 'Logo', passed: false, notes: 'Incorrecto' }] }) }] } }] } };
  });
  const asset = { bytes: Buffer.from('product'), mimeType: 'image/png' };
  const job = { generationKind: 'product', requestedPromptBase: 'White background', promptBase: 'White background', finalPrompt: 'Original provider prompt' } as Job;
  const review = await reviewModule.reviewGeneratedImageWithGemini({ generationKind: 'product', apiKey: 'test', model: 'test',
    requestedPromptBase: job.requestedPromptBase!, promptBase: job.promptBase, finalPrompt: job.finalPrompt,
    attemptNumber: 1, maxAttempts: 3, poseReference: asset, garmentReference: asset, productReferences: [asset], generatedImage: asset, signal: AbortSignal.timeout(1000) });
  assert.equal(review.verdict, 'rejected');
  assert.match(geminiBody.contents[0].parts[0].text, /corrected generation prompt in English for the next automatic attempt/);
  Object.assign(job, buildAutomaticRetryPromptPatch(job, review.revisedPrompt!));
  assert.equal(job.requestedPromptBase, 'White background');
  assert.equal(job.promptBase, 'Keep the exact mug and restore its logo');
  assert.match(job.finalPrompt, /White background\nCorrection: Keep the exact mug and restore its logo$/);
});

test('batch callable stores each approved prompt verbatim and rejects old clients and unauthorized callers', async (t) => {
  const admin = require('../functions/node_modules/firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-approved-prompt', storageBucket: 'demo-approved-prompt.appspot.com' });
  const firestoreModule = require('../functions/lib/functions/src/firebase/appFirestore.js');
  const configModule = require('../functions/lib/functions/src/admin/systemConfig.js');
  const { createGenerationBatch, createGenerationBatchCore } = require('../functions/lib/functions/src/callables/createGenerationBatch.js') as typeof import('../functions/src/callables/createGenerationBatch');
  const stored = new Map<string, any>();
  stored.set('clients/client', { name: 'Client', status: 'active' });
  stored.set('models/model', { name: 'Model', clientId: 'client', poseCount: 1, identityTraits: { hairColor: 'do not inject' }, poses: [{ id: 'pose', fileName: 'pose.jpg', storagePath: 'model/pose.jpg', aiClassification: { usableForGarmentViews: ['front'], framing: 'full_body', orientationGroup: 'front', bodyFocus: 'full_body' } }] });
  stored.set('users/user', { displayName: 'Operator' });
  let sequence = 0;
  const collection = (path: string): any => ({ doc: (id = `generated-${++sequence}`) => ({
    id, path: `${path}/${id}`,
    get: async () => ({ id, exists: stored.has(`${path}/${id}`), data: () => stored.get(`${path}/${id}`) }),
    collection: (child: string) => collection(`${path}/${id}/${child}`),
  }) });
  const transaction = {
    get: (ref: any) => ref.get(),
    getAll: (...refs: any[]) => Promise.all(refs.map(ref => ref.get())),
    set: (ref: any, data: any) => { stored.set(ref.path, data); },
  };
  t.mock.method(firestoreModule, 'getAppFirestore', () => ({ collection, runTransaction: async (callback: any) => callback(transaction) }));
  t.mock.method(configModule, 'getSystemConfigCached', async () => ({ ...configModule.DEFAULT_SYSTEM_CONFIG, batchMaxJobs: 100, jobMaxRetries: 3, systemPromptTopOnly: 'HIDDEN CONFIGURATION TEXT' }));
  const { request } = makeRequest();
  request.approvedPrompts![0].text = '  Approved sweater prompt\n';
  request.approvedPrompts![1].text = 'Pants prompt';
  const result = await createGenerationBatchCore(request, 'user');
  assert.equal(result.createdJobs, 2);
  const jobs = [...stored.entries()].filter(([path]) => path.startsWith('jobs/')).map(([, data]) => data);
  for (const job of jobs) {
    const expected = request.approvedPrompts!.find((entry) => entry.garmentId === job.garmentId)!.text;
    assert.equal(job.finalPrompt, expected); assert.equal(job.requestedPromptBase, expected); assert.equal(job.promptBase, expected);
    assert.equal(job.promptFormat, APPROVED_TRY_ON_PROMPT_FORMAT); assert.equal(job.promptCaseText, null);
  }
  await assert.rejects(createGenerationBatch.run({ data: request } as any), /iniciar sesión/);
  await assert.rejects(createGenerationBatch.run({ data: request, auth: { uid: 'user', token: { role: 'revisor' } } } as any), /permisos/);
  await assert.rejects(createGenerationBatch.run({ data: { ...request, promptFormat: undefined }, auth: { uid: 'user', token: { role: 'operador' } } } as any), /Actualiza la aplicación/);
});
