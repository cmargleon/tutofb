import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-marketplace-photo-plan';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST;
test('photo plan: authoritative creation, replay, frozen channels, automation parity, exact final review and variant export projection', { skip: !enabled }, async t => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):/);
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation'; process.env.FAL_KEY = 'test-only'; process.env.GEMINI_API_KEY = 'test-only';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore(); const bucket = admin.storage().bucket();
  const sharp = require('../functions/node_modules/sharp'); const uid = 'operator'; const clientId = 'photo-client'; const path = `garments/drafts/${uid}/source/front.jpg`;
  const bytes = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: 'white' } }).png().toBuffer();
  await bucket.file(path).save(bytes, { metadata: { contentType: 'image/png' } });
  const { manualPhotoAttribute: a } = require('../functions/lib/shared/src/marketplacePhotoPlan.js');
  const attributes = { category: a('ordinary'), audience: a('adult'), bodyArea: a('upper_body'), packaging: a('unit'), transparency: a(false), color: a('blue'), components: a('1 shirt') };
  const marketplaces = { amazon: { enabled: true }, shein: { enabled: true }, 'tiktok-shop': { enabled: true }, 'mercado-libre': { enabled: true } };
  await db.doc(`clients/${clientId}`).set({ name: 'Test', marketplaces, automation: { enabled: true } });
  await db.doc(`users/${uid}`).set({ role: 'operador', active: true, clientAccess: { mode: 'global' } });
  await db.doc('system_config/main').set({ batchMaxJobs: 100, jobMaxRetries: 0 });
  require('../functions/lib/functions/src/admin/systemConfig.js').invalidateSystemConfigCache();
  const { createCommercialProviderImageConfig } = require('../functions/lib/shared/src/commercialPhoto.js');
  const input = { clientId, articles: [{ itemId: 'shirt', productId: 'shirt', variantId: 'shirt', name: 'front.jpg', kind: 'garment', attributes, references: [{ id: 'shirt-0', storagePath: path, view: 'front' }] }], provider: 'fal-gpt-image-2.5-flare', imageConfig: createCommercialProviderImageConfig('fal-gpt-image-2.5-flare'), aspectRatio: '3:4' };
  const service = require('../functions/lib/functions/src/callables/createMarketplacePhotoBatch.js');
  const provider = require('../functions/lib/functions/src/providers/index.js'); const review = require('../functions/lib/functions/src/review/geminiImageReview.js');
  const { File } = require('../functions/node_modules/@google-cloud/storage'); t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://fixtures.invalid/reference']);
  let generations = 0; const reviewed: Buffer[] = [];
  t.mock.method(provider, 'generateWithProvider', async () => { generations++; return { provider: input.provider, imageBytes: bytes, contentType: 'image/png', remoteUrl: null, requestId: 'simulated', responseSummary: {} }; });
  t.mock.method(review, 'reviewGeneratedImageWithGemini', async ({ photoTask, generatedImage }: any) => {
    assert.equal((await sharp(generatedImage.bytes).metadata()).format, 'jpeg'); reviewed.push(generatedImage.bytes);
    return { model: 'test', verdict: 'approved', summary: 'test', reviewPrompt: 'test', revisedPrompt: null, criteria: [], marketplaceData: {}, photoValidation: { fidelity: true, destinations: photoTask.destinations.map((d: any) => ({ channel: d.channel, position: d.position, passed: true, notes: 'verified' })) } };
  });
  try {
    const plan = await service.resolveMarketplacePhotoPlan(input, uid); assert.equal(plan.tasks.length, 2);
    const request = { ...input, requestId: 'manual', approvedPlanId: plan.id, prompt: 'Commercial photograph' };
    await assert.rejects(service.createMarketplacePhotoBatchCore({ ...request, approvedPlanId: 'forged' }, uid));
    const created = await service.createMarketplacePhotoBatchCore(request, uid);
    const replay = await service.createMarketplacePhotoBatchCore(request, uid); assert.deepEqual(replay, created);
    await assert.rejects(service.createMarketplacePhotoBatchCore({ ...request, prompt: 'changed' }, uid), /otra entrada/);
    const jobs = (await db.collection('jobs').where('batchId', '==', created.batchId).get()).docs;
    const worker = require('../functions/lib/functions/src/workers/jobWorker.js');
    for (const j of jobs) await worker.processJob(j.id, 'create', { skipBacklogSweep: true });
    assert.equal(generations, 2);
    const completed = await Promise.all(jobs.map(j => j.ref.get()));
    for (const [index, j] of completed.entries()) {
      assert.equal(j.get('status'), 'completed', j.get('lastError'));
      const output = j.get('currentOutput'); const [stored] = await bucket.file(output.resultImagePath).download(); assert.deepEqual(stored, reviewed[index]);
      assert.equal(output.storedImage.sizeBytes, stored.length); assert.ok(output.photoValidation.fidelity);
      const final = await require('../functions/lib/functions/src/media/prepareMarketplaceImage.js').prepareMarketplaceImage(stored, 'amazon'); assert.deepEqual(final.bytes, stored);
    }
    const planService = require('../functions/lib/functions/src/automation/plans.js');
    const objectAuthorization = await planService.prepareAutomationPlan({ source: 'api', externalId: 'object-authorization', clientId, jobType: 'product', preset: 'generic_product', inputImages: [{ itemId: 'object', fileName: 'object.jpg', storagePath: path }], budgetUsd: 10, allowEstimatedCosts: true }, uid, 'operador');
    assert.equal(objectAuthorization.classificationRequired, true);
    await assert.rejects(planService.executeAutomationPlan(objectAuthorization.id, uid, 'operador'), /authorizeClassification/);
    const classifier = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js');
    t.mock.method(classifier, 'classifyGarmentWithGemini', async ({ garment }: any) => ({ photoAttributes: attributes, itemKind: 'garment', itemKindConfidence: 1, photos: garment.photos.map((p: any) => ({ ...p, view: 'front', confidence: 1 })), garmentBodyArea: 'upper_body' }));
    const { createAutomation } = require('../functions/lib/functions/src/automation/persistence.js');
    const auto = await createAutomation({ source: 'api', externalId: 'parity', clientId, jobType: 'garment', provider: input.provider, inputImages: [{ itemId: 'shirt', fileName: 'front.jpg', storagePath: path }], budgetUsd: 10, maxReviewAttempts: 1, maxOperationalRetries: 0, allowEstimatedCosts: true, authorizeClassification: true }, uid, 'operador');
    await require('../functions/lib/functions/src/automation/worker.js').processAutomation(auto.jobId);
    const autoJob = (await db.doc(`automationJobs/${auto.jobId}`).get()).data();
    assert.equal(autoJob.status, 'processing', JSON.stringify(autoJob.error)); assert.equal(autoJob.photoPlan.tasks.length, plan.tasks.length);
    assert.deepEqual(autoJob.photoPlan.channels, plan.channels);
    const multiInputs = [];
    for (const view of ['front', 'back', 'side']) {
      const storagePath = `garments/drafts/${uid}/known/${view}.jpg`;
      await bucket.file(storagePath).save(bytes, { metadata: { contentType: 'image/jpeg' } });
      multiInputs.push({ itemId: 'multi', fileName: `${view}.jpg`, storagePath });
    }
    const multi = await createAutomation({ source: 'api', externalId: 'commercial-view-correction', clientId, jobType: 'garment', provider: input.provider, inputImages: multiInputs, metadata: { photoArticles: { multi: { referenceViews: { 'front.jpg': 'front', 'back.jpg': 'back', 'side.jpg': 'side' } } } }, budgetUsd: 10, maxReviewAttempts: 1, maxOperationalRetries: 0, allowEstimatedCosts: true, authorizeClassification: true }, uid, 'operador');
    await require('../functions/lib/functions/src/automation/worker.js').processAutomation(multi.jobId);
    const multiPlan = (await db.doc(`automationJobs/${multi.jobId}`).get()).get('photoPlan');
    assert.ok(multiPlan.tasks.some((task: any) => task.view === 'back'));
    assert.ok(multiPlan.tasks.some((task: any) => task.view === 'side'));
    await db.doc(`clients/${clientId}`).update({ 'marketplaces.amazon.enabled': false });
    assert.deepEqual(await service.createMarketplacePhotoBatchCore(request, uid), created);
    await assert.rejects(service.createMarketplacePhotoBatchCore({ ...request, requestId: 'new' }, uid), /plan cambió/);
    assert.equal((await db.doc(`automationJobs/${auto.jobId}`).get()).get('photoMarketplaces.amazon.enabled'), true);
  } finally { await cleanupEmulatorDatabase(db); }
});
