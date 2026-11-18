import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Job, JobOutput } from '../shared/src/types';
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-photo-edit', storageBucket: 'demo-photo-edit.appspot.com' });
const edits = require('../functions/lib/functions/src/workers/jobImageEdit.js');
const configModule = require('../functions/lib/functions/src/admin/systemConfig.js');
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const { createDefaultProviderImageConfig } = require('../functions/lib/shared/src/providerImageConfig.js');
const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js');
const source = { id: 'old', jobId: 'job', batchId: 'batch', clientId: 'client', resultImagePath: 'generated/client/batch/job/old.png',
  aspectRatio: '3:4', imageConfig: createDefaultProviderImageConfig('fal-gpt-image-2.5-flare'), createdAt: new Date() } as JobOutput;
const original = { id: 'job', clientId: 'client', batchId: 'batch', status: 'completed', provider: 'fal-seedream',
  promptBase: 'Original editable', requestedPromptBase: 'Original solicitado', finalPrompt: 'Original final',
  poseImagePath: 'models/original.jpg', garmentFilePath: 'garments/original.jpg', aspectRatio: '3:4',
  imageConfig: createDefaultProviderImageConfig('fal-seedream'), currentOutputId: 'old', currentOutput: source,
  garmentId: 'garment', modelId: 'model', clientNameSnapshot: 'Cliente', modelNameSnapshot: 'Modelo', poseImageId: 'pose',
  garmentName: 'Producto', maxRetries: 1, createdByUid: 'user', claimToken: 'claim', completedOutputCount: 1,
} as Job;
const config = { jobMaxRetries: 2, disabledProviders: [] };

test('requires actual instructions; execution preserves original job and regeneration clears edit mode', () => {
  for (const invalid of [undefined, null, '', '  ', 12, 'a'.repeat(4001)]) assert.throws(() => edits.validatePhotoEditInstructions(invalid));
  assert.equal(edits.validatePhotoEditInstructions('  quita el bolso  '), 'quita el bolso');
  const imageEdit = { sourceOutputId: source.id, sourceImagePath: source.resultImagePath, instructions: 'quita el bolso',
    requestedByUid: 'user', requestedAt: new Date(), provider: 'fal-gpt-image-2.5-flare', imageConfig: source.imageConfig, aspectRatio: '3:4' };
  const job = { ...original, imageEdit, photoTask: { composition: 'reference' }, automationManaged: true };
  const execution = edits.getPhotoEditExecutionJob(job);
  assert.equal(execution.poseImagePath, source.resultImagePath);
  assert.equal(execution.garmentFilePath, source.resultImagePath);
  assert.deepEqual(execution.productReferencePaths, [source.resultImagePath]);
  assert.equal(execution.photoTask, undefined);
  assert.equal(execution.automationManaged, false);
  assert.match(execution.finalPrompt, /Conserva todo.*identidad.*detalles del producto/);
  assert.equal(job.promptBase, original.promptBase);
  assert.equal(job.poseImagePath, original.poseImagePath);
  const regen = buildRegenerateJobPatch(job, original.provider, 'Nuevo prompt');
  assert.equal(regen.imageEdit, null);
  const regenerated = edits.getPhotoEditExecutionJob({ ...job, ...regen });
  assert.equal(regenerated.poseImagePath, original.poseImagePath);
  assert.equal(regenerated.promptBase, 'Nuevo prompt');
});

test('callable validates source membership, permissions, busy jobs, disabled provider and writes only edit state', async t => {
  const { editJobPhoto } = require('../functions/lib/functions/src/callables/editJobPhoto.js');
  let role = 'admin';
  let job: any = { ...original };
  let output: any = { ...source };
  const writes: any[] = [];
  const snap = (data: any) => ({ exists: !!data, data: () => data, get: (key: string) => data?.[key] });
  const ref = (path: string): any => ({ path, id: path.split('/').pop(), collection: (name: string) => coll(`${path}/${name}`),
    get: async () => snap(path.startsWith('users/') ? { active: true, role, displayName: 'Operador' } : job) });
  const coll = (path: string): any => ({ doc: (id = 'log') => ref(`${path}/${id}`) });
  t.mock.method(firestore, 'getAppFirestore', () => ({ collection: coll, runTransaction: async (fn: any) => fn({
    getAll: async () => [snap(job), snap(output), snap({ displayName: 'Operador' })],
    update: (_: any, patch: any) => writes.push(patch), create: (_: any, log: any) => writes.push(log),
  }) }));
  t.mock.method(configModule, 'getSystemConfigCached', async () => config);
  const data = { jobId: 'job', sourceOutputId: 'old', instructions: '  luz cálida  ' };
  const call = () => editJobPhoto.run({ data, auth: { uid: 'user', token: {} } });
  await assert.rejects(() => editJobPhoto.run({ data }), { code: 'unauthenticated' });
  role = 'revisor'; await assert.rejects(call, { code: 'permission-denied' }); role = 'admin';
  job.status = 'processing'; await assert.rejects(call, { code: 'failed-precondition' }); job.status = 'completed';
  for (const changed of [null, { ...source, jobId: 'foreign' }, { ...source, clientId: 'foreign' }, { ...source, storageDeletedAt: new Date() }]) {
    output = changed;
    if (!changed) job = { ...job, currentOutput: null };
    await assert.rejects(call);
  }
  output = source;
  await assert.rejects(() => editJobPhoto.run({ data: { ...data, instructions: ' ' }, auth: { uid: 'user', token: {} } }), { code: 'invalid-argument' });
  t.mock.method(configModule, 'getSystemConfigCached', async () => ({ ...config, disabledProviders: ['fal-gpt-image-2.5-flare'] }));
  await assert.rejects(call, { code: 'failed-precondition' });
  t.mock.method(configModule, 'getSystemConfigCached', async () => config);
  assert.equal(writes.length, 0);
  await call();
  const patch = writes[0];
  assert.equal(patch.imageEdit.sourceImagePath, source.resultImagePath);
  assert.equal(patch.imageEdit.instructions, 'luz cálida');
  assert.equal(patch.imageEdit.provider, 'fal-gpt-image-2.5-flare');
  for (const key of ['provider', 'promptBase', 'requestedPromptBase', 'finalPrompt', 'currentOutput', 'userSelectedOutput', 'poseImagePath', 'garmentFilePath']) assert.equal(key in patch, false, key);
  assert.equal(patch.status, 'pending');
  writes.length = 0;
  await assert.rejects(() => editJobPhoto.run({ data: { ...data, provider: 'not-a-model' }, auth: { uid: 'user', token: {} } }), { code: 'invalid-argument' });
  t.mock.method(configModule, 'getSystemConfigCached', async () => ({ ...config, disabledProviders: ['fal-seedream'] }));
  await assert.rejects(() => editJobPhoto.run({ data: { ...data, provider: 'fal-seedream' }, auth: { uid: 'user', token: {} } }), { code: 'failed-precondition' });
  t.mock.method(configModule, 'getSystemConfigCached', async () => config);
  await editJobPhoto.run({ data: { ...data, provider: 'fal-seedream' }, auth: { uid: 'user', token: {} } });
  assert.equal(writes[0].imageEdit.provider, 'fal-seedream');
  assert.equal(writes[0].imageEdit.imageConfig.provider, 'fal-seedream');
});

test('edit provider receives only the visible source; persistence appends output with provenance and original prompts survive', async t => {
  const resources = require('../functions/lib/functions/src/workers/jobWorker.resources.js');
  const providers = require('../functions/lib/functions/src/providers/index.js');
  const generation = require('../functions/lib/functions/src/workers/jobWorker.generation.js');
  const persistence = require('../functions/lib/functions/src/workers/jobWorker.persistence.js');
  const sharp = require('../functions/node_modules/sharp');
  const bytes = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const imageEdit = { sourceOutputId: source.id, sourceImagePath: source.resultImagePath, instructions: 'pared blanca',
    provider: 'fal-gpt-image-2.5-flare', imageConfig: source.imageConfig, aspectRatio: '3:4', requestedByUid: 'user', requestedAt: new Date() };
  const job = edits.getPhotoEditExecutionJob({ ...original, imageEdit });
  let providerRequest: any;
  t.mock.method(providers, 'generateWithProvider', async (provider: string, request: any) => {
    providerRequest = request;
    return { provider, imageBytes: bytes, contentType: 'image/png', remoteUrl: null, requestId: null, responseSummary: {} };
  });
  t.mock.method(resources.bucket, 'file', (path: string) => ({ save: async () => {}, getSignedUrl: async () => [`https://signed.invalid/${path}`] }));
  const result = await generation.obtainProviderResultWithinBudget({ job, jobId: 'job', imageConfig: { imageConfig: job.imageConfig, aspectRatio: job.aspectRatio },
    inputUrls: await generation.signInputImages(job), signal: AbortSignal.timeout(1000) });
  assert.deepEqual(providerRequest.referenceImageUrls, [`https://signed.invalid/${source.resultImagePath}`]);
  assert.match(providerRequest.prompt, /pared blanca/);
  assert.doesNotMatch(providerRequest.prompt, /Original final/);
  const writes: any[] = [];
  const ref = (path: string): any => ({ path, id: path.split('/').pop(), collection: (name: string) => ({ doc: (id = 'new') => ref(`${path}/${name}/${id}`) }) });
  t.mock.method(resources.db, 'collection', (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }));
  t.mock.method(resources.db, 'runTransaction', async (fn: any) => fn({ get: async () => ({ exists: true, data: () => ({ ...original, status: 'processing' }) }),
    set: (ref: any, value: any) => writes.push({ path: ref.path, value }), update: (ref: any, value: any) => writes.push({ path: ref.path, value }) }));
  await persistence.persistGeneratedAttempt({ claimedJob: job, providerResult: result, durationSeconds: 1, generationAttempt: 1,
    nextStatus: 'completed', autoReview: null, failureInfo: null, lastError: null });
  const output = writes.find(write => write.path === 'jobs/job/outputs/new').value;
  assert.deepEqual(output.imageEdit, imageEdit);
  assert.equal(output.finalPrompt, providerRequest.prompt);
  assert.notEqual(output.resultImagePath, source.resultImagePath);
  assert.deepEqual(writes.find(write => write.path === 'jobs/job/outputs/old').value, { isCurrent: false });
  const update = writes.find(write => write.path === 'jobs/job').value;
  for (const key of ['provider', 'imageConfig', 'aspectRatio', 'promptBase', 'finalPrompt', 'requestedPromptBase']) assert.equal(key in update, false, key);
  assert.ok(output.costUsd > 0);
  const { selectReviewPrompt } = require('../functions/lib/functions/src/review/geminiImageReview.prompts.js');
  assert.match(selectReviewPrompt({ imageEditInstructions: imageEdit.instructions }), /foto de partida.*resultado editado/);
});

test('product edit reviews are approved on their own criteria, without the product criteria set', () => {
  const { decideVerdict } = require('../functions/lib/functions/src/review/geminiImageReview.parse.js');
  const criteria = ['change', 'identity', 'details', 'consistency', 'quality']
    .map(key => ({ key, label: key, passed: true, notes: '' }));
  const parsed = { verdict: 'approved' };
  const verdict = (request: Record<string, unknown>, list = criteria) =>
    decideVerdict({ request, parsed, criteria: list, usesApprovedPrompt: false, photoValidation: undefined });
  assert.equal(verdict({ generationKind: 'product', imageEditInstructions: 'Fondo blanco' }), 'approved');
  assert.equal(verdict({ generationKind: 'product' }), 'rejected');
  assert.equal(decideVerdict({ request: { generationKind: 'product', imageEditInstructions: 'Fondo blanco' },
    parsed: { verdict: 'rejected' }, criteria, usesApprovedPrompt: false, photoValidation: undefined }), 'rejected');
});
