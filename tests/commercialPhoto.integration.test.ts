import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
process.env.FIRESTORE_DATABASE_ID = 'test-commercial-photo';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST;

test('commercial photos: effective configs → real fal adapters with simulated responses → emulator Storage and review recovery', { skip: !enabled }, async t => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):/);
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation'; process.env.FAL_KEY = 'test-only'; process.env.GEMINI_API_KEY = 'test-only';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket();
  const sharp = require('../functions/node_modules/sharp');
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://fixtures.invalid/reference.png']);
  const original = await sharp({ create: { width: 24, height: 30, channels: 4, background: '#33669988' } }).png().toBuffer();
  const uid = 'photo-operator', clientId = 'photo-client', modelId = 'photo-model';
  const path = `garments/drafts/${uid}/draft/item/front.png`;
  await bucket.file(path).save(original, { metadata: { contentType: 'image/png' } });
  await db.collection('users').doc(uid).set({ role: 'operador', active: true, clientAccess: { mode: 'global' } });
  await db.collection('clients').doc(clientId).set({ name: clientId, batchCount: 0, automation: { defaultModelId: modelId } });
  await db.collection('models').doc(modelId).set({ clientId, name: modelId, poseCount: 1, poses: [{ id: 'front', storagePath: path, fileName: 'front.png', aiClassification: { usableForGarmentViews: ['front'], orientationGroup: 'front', bodyFocus: 'full_body', framing: 'full_body' } }] });
  await db.collection('system_config').doc('main').set({ batchMaxJobs: 100, jobMaxRetries: 0, jobRetryDelayMs: 0 });
  require('../functions/lib/functions/src/admin/systemConfig.js').invalidateSystemConfigCache();
  const { COMMERCIAL_PHOTO_PROFILE, createCommercialProviderImageConfig } = require('../functions/lib/shared/src/commercialPhoto.js');
  const { PROVIDER_VALUES } = require('../functions/lib/shared/src/domain.js');
  const { estimateGenerationHold } = require('../functions/lib/functions/src/costs/generationEstimates.js');
  const manualGarment = require('../functions/lib/functions/src/callables/createGenerationBatch.js').createGenerationBatchCore;
  const manualProduct = require('../functions/lib/functions/src/callables/createProductGenerationBatch.js').createProductGenerationBatchCore;
  const persistence = require('../functions/lib/functions/src/automation/persistence.js');
  const plans = require('../functions/lib/functions/src/automation/plans.js');
  const intake = require('../functions/lib/functions/src/automation/worker.js');
  const generation = require('../functions/lib/functions/src/workers/jobWorker.js');
  const compressor = require('../functions/lib/functions/src/media/compressGeneratedImage.js');
  const classifier = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js');
  t.mock.method(classifier, 'classifyGarmentWithGemini', async ({ garment }: any) => ({ itemKind: 'garment', itemKindConfidence: 0.99, garmentBodyArea: 'upper_body', garmentAccessoryType: null, photos: garment.photos.map((p: any) => ({ ...p, view: 'front', confidence: 0.99 })) }));
  const review = require('../functions/lib/functions/src/review/geminiImageReview.js');
  let failReview = false;
  t.mock.method(review, 'reviewGeneratedImageWithGemini', async ({ generatedImage }: any) => {
    assert.ok((await sharp(generatedImage.bytes).metadata()).width);
    if (failReview) { failReview = false; throw new Error('Simulated review unavailable'); }
    return { model: 'test', verdict: 'approved', summary: 'test', reviewPrompt: 'test', revisedPrompt: null, criteria: [], marketplaceData: {} };
  });
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = String(input);
    if (url.startsWith('https://queue.fal.run/')) {
      if (init?.method === 'POST') { requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ request_id: 'simulated', status_url: 'https://queue.fal.run/test/status', response_url: 'https://queue.fal.run/test/result' }); }
      if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
      return Response.json({ images: [{ url: 'https://fixtures.invalid/result.png', content_type: 'image/png', width: 9999, height: 9999 }] });
    }
    if (url === 'https://fixtures.invalid/result.png') return new Response(original, { headers: { 'content-type': 'image/png' } });
    if (/^http:\/\/(localhost|127\.0\.0\.1):/.test(url)) return originalFetch(input, init);
    throw new Error(`Unexpected network request: ${url}`);
  });
  const scenes = [{ type: 'clean', prompt: 'Commercial scene' }];
  const garments = [{ id: 'item', name: 'Shirt', storagePath: path, isMultiAngle: false, sourceType: 'single', garmentBodyArea: 'upper_body', photos: [{ id: 'front', storagePath: path, fileName: 'front.png', view: 'front', sourceIndex: 0 }] }];
  const automationInput = (provider: string, jobType: string) => ({ source: 'api', externalId: randomUUID(), clientId, provider, jobType, allowEstimatedCosts: true, authorizeClassification: true, budgetUsd: 10, inputImages: [{ itemId: 'item', fileName: 'front.png', storagePath: path }] });
  const checkOutput = async (jobId: string) => {
    const done = (await db.collection('jobs').doc(jobId).get()).data();
    assert.equal(done.status, 'completed', done.lastError); assert.equal(done.photoProfile, COMMERCIAL_PHOTO_PROFILE);
    const output = done.currentOutput;
    assert.equal(output.photoProfile, COMMERCIAL_PHOTO_PROFILE); assert.equal(output.contentType, 'image/jpeg');
    assert.equal(output.resultImagePath, `generated/${clientId}/${done.batchId}/${jobId}/${output.id}.jpg`);
    const [meta] = await bucket.file(output.resultImagePath).getMetadata(); assert.equal(meta.contentType, output.contentType);
    const [bytes] = await bucket.file(output.resultImagePath).download(); const m = await sharp(bytes).metadata();
    assert.deepEqual([m.format, m.width, m.height, m.space, m.depth, m.hasAlpha], ['jpeg', 24, 30, 'srgb', 'uchar', false]); assert.ok(m.icc);
    assert.equal(output.storedImage.sizeBytes, bytes.length); assert.equal(output.storedImage.requestedGeometryDiffers, true);
    assert.deepEqual([output.storedImage.sourceWidth, output.storedImage.sourceHeight], [24, 30]);
    return done;
  };
  try {
    for (const provider of PROVIDER_VALUES) for (const jobType of ['garment', 'product']) for (const source of ['wizard', 'automation']) {
      await t.test(`${provider}/${jobType}/${source}`, async () => {
        const config = createCommercialProviderImageConfig(provider);
        let batchId: string;
        let automationId: string | undefined;
        if (source === 'wizard') {
          const result = jobType === 'garment' ? await manualGarment({ clientId, modelId, provider, imageConfig: config, outputMode: 'photos_only', poseIds: ['front'], garments, productDrafts: [], promptBase: 'Commercial photo' }, uid)
            : await manualProduct({ requestId: randomUUID(), clientId, provider, imageConfig: config, prompt: '', items: [{ id: 'item', name: 'Lamp', referencePaths: [path] }], scenes }, uid);
          batchId = result.batchId;
        } else {
          const receipt = await persistence.createAutomation(automationInput(provider, jobType), uid, 'operador'); automationId = receipt.jobId;
          await intake.processAutomation(receipt.jobId);
          const a = (await db.collection('automationJobs').doc(receipt.jobId).get()).data();
          assert.equal(a.status, 'processing', JSON.stringify(a.error)); assert.deepEqual(a.resolvedPreset.imageConfig, config); batchId = a.batchId;
        }
        const jobs = (await db.collection('jobs').where('batchId', '==', batchId).get()).docs;
        const job = jobs[0]; assert.deepEqual(job.data().imageConfig, config);
        assert.equal((await db.collection('batches').doc(batchId).get()).data().photoProfile, COMMERCIAL_PHOTO_PROFILE);
        const before = requests.length;
        await generation.processJob(job.id, 'create', { skipBacklogSweep: true });
        assert.equal(requests.length, before + 1);
        const request = requests.at(-1).body;
        if ('imageSize' in config) assert.deepEqual(request.image_size, config.imageSize);
        else { assert.equal(request.aspect_ratio, config.aspectRatio); assert.equal(request.resolution, config.resolution); }
        assert.equal(request.output_format, provider === 'fal-seedream' ? undefined : 'jpeg');
        const done = await checkOutput(job.id);
        assert.equal(done.currentOutput.costUsd, estimateGenerationHold(provider, config, jobType === 'garment' ? 2 : 1).estimateUsd);
        if (automationId) {
          const a = (await db.collection('automationJobs').doc(automationId).get()).data();
          assert.equal(a.budget.reservedUsd, 0); assert.equal(a.budget.recordedUsd, done.currentOutput.costUsd);
          const operations = (await db.collection('automationJobs').doc(automationId).collection('operations').get()).docs;
          assert.ok(operations.length > 0);
        }
      });
    }
    await t.test('new plans freeze the effective configuration; historical plans and jobs remain legacy', async () => {
      const request = automationInput('fal-nano-banana-2', 'product');
      const plan = await plans.prepareAutomationPlan(request, uid, 'operador');
      assert.equal(plan.photoProfile, COMMERCIAL_PHOTO_PROFILE); assert.equal(plan.preset.imageConfig.resolution, '2K');
      await db.collection('clients').doc(clientId).update({ 'automation.presets.generic_product': { provider: 'fal-banana-pro', aspectRatio: '1:1' } });
      const receipt = await plans.executeAutomationPlan(plan.id, uid, 'operador');
      await intake.processAutomation(receipt.jobId);
      const a = (await db.collection('automationJobs').doc(receipt.jobId).get()).data(); assert.deepEqual(a.resolvedPreset, plan.preset);
      const old = { ...plan, id: randomUUID(), request: { ...request, externalId: randomUUID() }, preset: { provider: 'fal-nano-banana-2', aspectRatio: '3:4', imageConfig: { provider: 'fal-nano-banana-2', aspectRatio: '3:4', resolution: '1K' } } };
      delete old.photoProfile;
      await db.collection('automationPlans').doc(old.id).set(old);
      const legacy = await persistence.createAutomation(old.request, uid, 'operador', old);
      await intake.processAutomation(legacy.jobId);
      const historical = (await db.collection('automationJobs').doc(legacy.jobId).get()).data(); assert.equal(historical.photoProfile, undefined);
      const job = (await db.collection('jobs').doc(historical.generationJobIds[0]).get()).data(); assert.equal(job.photoProfile, undefined); assert.equal(job.imageConfig.resolution, '1K');
      await db.collection('clients').doc(clientId).update({ 'automation.presets': {} });
    });
    await t.test('review recovery never calls fal, compression or Storage.save and preserves existing output metadata/cost/duration', async () => {
      const receipt = await persistence.createAutomation({ ...automationInput('fal-nano-banana-2', 'product'), maxOperationalRetries: 1 }, uid, 'operador'); await intake.processAutomation(receipt.jobId);
      const a = (await db.collection('automationJobs').doc(receipt.jobId).get()).data(); const ref = db.collection('jobs').doc(a.generationJobIds[0]);
      failReview = true; await generation.processJob(ref.id, 'create', { skipBacklogSweep: true });
      const before = (await ref.get()).data(); assert.equal(before.automationReviewPending, true); const count = requests.length;
      const compressMock = t.mock.method(compressor, 'compressGeneratedImageIfNeeded', async () => { throw new Error('Unexpected recompression'); });
      const saveMock = t.mock.method(File.prototype, 'save', async () => { throw new Error('Unexpected overwrite'); });
      try { await generation.processJob(ref.id, 'requeue', { skipBacklogSweep: true }); } finally { compressMock.mock.restore(); saveMock.mock.restore(); }
      const done = await checkOutput(ref.id); assert.equal(requests.length, count);
      const { autoReview: _a, failureInfo: _b, ...beforeFields } = before.currentOutput;
      const { autoReview: _c, failureInfo: _d, ...afterFields } = done.currentOutput;
      assert.deepEqual(afterFields, beforeFields); assert.equal(done.totalCostUsd, before.totalCostUsd); assert.equal(done.totalDurationSeconds, before.totalDurationSeconds);
    });
    await t.test('compression failure stays outside Gemini handling, never saved or compressed twice', async () => {
      const { batchId } = await manualProduct({ requestId: randomUUID(), clientId, provider: 'fal-nano-banana-2', prompt: '', items: [{ id: 'item', name: 'Lamp', referencePaths: [path] }], scenes }, uid);
      const ref = (await db.collection('jobs').where('batchId', '==', batchId).get()).docs[0].ref;
      let calls = 0;
      const compressMock = t.mock.method(compressor, 'compressGeneratedImageIfNeeded', async () => { calls++; throw new Error('Invalid image bytes'); });
      const saveMock = t.mock.method(File.prototype, 'save', async () => { throw new Error('Unexpected save'); });
      try { await generation.processJob(ref.id, 'create', { skipBacklogSweep: true }); assert.equal(saveMock.mock.callCount(), 0); } finally { compressMock.mock.restore(); saveMock.mock.restore(); }
      assert.equal(calls, 1); const failed = (await ref.get()).data(); assert.equal(failed.status, 'failed'); assert.equal(failed.currentOutputId, null);
      assert.notEqual(failed.failureInfo.source, 'gemini'); assert.equal((await ref.collection('outputs').get()).size, 0);
    });
  } finally { await cleanupEmulatorDatabase(db); }
});
