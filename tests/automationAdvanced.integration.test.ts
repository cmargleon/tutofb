import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-automationadvanced-integration';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST;

test('automation plans, Drive, concurrent budgets, independent scenes and manual isolation (emulators and simulated providers)', { skip: !enabled }, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  process.env.GEMINI_API_KEY = 'test-only'; process.env.FAL_KEY = 'test-only'; process.env.JOB_AUTO_REVIEW_MAX_ATTEMPTS = '3';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore(); const bucket = admin.storage().bucket();
  const uid = 'advanced-operator'; const adminUid = 'advanced-admin';
  await db.collection('users').doc(uid).set({ uid, active: true, role: 'operador', clientAccess: { mode: 'global' } });
  await db.collection('users').doc(adminUid).set({ uid: adminUid, active: true, role: 'admin' });
  const { DEFAULT_AUTOMATION_BUDGET } = require('../functions/lib/shared/src/automationPolicy.js');
  const systemRef = db.collection('system_config').doc('main');
  await systemRef.set({ automationBudget: DEFAULT_AUTOMATION_BUDGET, batchMaxJobs: 100, jobMaxRetries: 1, jobRetryDelayMs: 0, geminiImageReviewModel: 'test' });
  const system = require('../functions/lib/functions/src/admin/systemConfig.js'); system.invalidateSystemConfigCache();
  const sharp = require('../functions/node_modules/sharp');
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#226644' } }).jpeg().toBuffer();
  const inputPath = `garments/drafts/${uid}/inputs/reference.jpg`; await bucket.file(inputPath).save(bytes, { metadata: { contentType: 'image/jpeg' } });
  const inputPathB = `garments/drafts/${uid}/client-b/reference.jpg`; await bucket.file(inputPathB).save(bytes, { metadata: { contentType: 'image/jpeg' } });
  const clientA = 'advanced-a'; const clientB = 'advanced-b';
  for (const [id, folder] of [[clientA, 'folder-a'], [clientB, 'folder-b']]) await db.collection('clients').doc(id).set({ name: id, status: 'active', batchCount: 0, automation: { enabled: true, driveFolderIds: [folder] } });
  const drive = require('../functions/lib/functions/src/automation/drive.js');
  let driveVersion = '1', downloads = 0, inaccessible = false;
  drive.googleDrive.metadata = async (id: string) => {
    if (inaccessible) throw new Error('Simulated inaccessible file');
    if (id.startsWith('folder-')) return { id, name: 'Same misleading folder name', mimeType: 'application/vnd.google-apps.folder' };
    return { id, name: 'arbitrary-no-skc.jpg', mimeType: 'image/jpeg', parents: [id === 'file-b' ? 'folder-b' : 'folder-a'], version: driveVersion, headRevisionId: `r${driveVersion}`, size: String(bytes.length) };
  };
  drive.googleDrive.download = async () => { downloads++; return bytes; };
  drive.googleDrive.list = async () => [await drive.googleDrive.metadata('file-a')];
  const { File } = require('../functions/node_modules/@google-cloud/storage'); File.prototype.getSignedUrl = async () => ['https://test.invalid/signed'];
  const persistence = require('../functions/lib/functions/src/automation/persistence.js');
  const plans = require('../functions/lib/functions/src/automation/plans.js');
  const worker = require('../functions/lib/functions/src/automation/worker.js');
  const generation = require('../functions/lib/functions/src/workers/jobWorker.js');
  const budgets = require('../functions/lib/functions/src/automation/budget.js');
  const recovery = require('../functions/lib/functions/src/automation/recovery.js');
  const results = require('../functions/lib/functions/src/automation/results.js');
  const base = { source: 'api', clientId: clientA, jobType: 'product', allowEstimatedCosts: true, inputImages: [{ itemId: 'a', fileName: 'photo.jpg', storagePath: inputPath }], provider: 'fal-seedream-5-flash' };
  const providers = require('../functions/lib/functions/src/providers/index.js');
  const requestedPrompts: string[] = [];
  let classificationCalls = 0;
  let providerCalls = 0, rejectArticle = '', rejectCount = 0, reviewTransportFailures = 0;
  let generatedImage = { bytes, contentType: 'image/jpeg' };
  providers.generateWithProvider = async (provider: string, request: any) => { providerCalls++; requestedPrompts.push(request.prompt); return { provider, imageBytes: generatedImage.bytes, contentType: generatedImage.contentType, remoteUrl: null, requestId: `request-${providerCalls}`, responseSummary: {} }; };
  const originalFetch = globalThis.fetch;
  const reviewedPrompts: string[] = [];
  globalThis.fetch = async (url: any, options: any) => {
    const target = String(url);
    if (!target.startsWith('https://generativelanguage.googleapis.com/')) {
      if (/^http:\/\/(localhost|127\.0\.0\.1):/.test(target)) return originalFetch(url, options);
      throw new Error(`Unexpected external request in isolated test: ${new URL(target).hostname}`);
    }
    if (reviewTransportFailures-- > 0) return Response.json({ error: { message: 'Simulated temporary review failure' } }, { status: 503 });
    const body = JSON.parse(options.body);
    if (body.generationConfig.responseJsonSchema.required.includes('itemKind')) {
      classificationCalls++;
      const prompt = body.contents[0].parts[0].text;
      const photoId = prompt.match(/Fotos recibidas: 1:([^:]+):/)?.[1] || 'shirt-0';
      if (photoId.startsWith('transport-error-')) return Response.json({ error: { message: 'Simulated classification failure' } }, { status: 503 });
      const uncertain = photoId.startsWith('uncertain-');
      return Response.json({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 50 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ itemKind: photoId.startsWith('wrong-kind-') ? 'product' : 'garment', itemKindConfidence: photoId.startsWith('uncertain-kind-') ? 0.2 : 0.99, itemKindReasoning: 'Original photo', itemLabel: 'Camiseta', garmentGender: photoId.startsWith('unknown-gender-') ? null : photoId.startsWith('female-') ? 'female' : photoId.startsWith('unisex-') ? 'unisex' : 'male', garmentGenderConfidence: photoId.startsWith('low-gender-') ? 0.4 : 0.99, garmentGenderReasoning: 'Corte y diseño de las referencias', bodyArea: 'upper_body', photos: [{ photoId, view: photoId.startsWith('incompatible-') ? 'back' : 'front', confidence: uncertain ? 0.2 : 0.99, reasoning: 'Original reference' }] }) }] } }] });
    }
    const reviewPrompt = body.contents[0].parts[0].text;
    reviewedPrompts.push(reviewPrompt);
    assert.ok(body.contents[0].parts.length >= 3);
    const rejected = rejectArticle && reviewPrompt.includes(rejectArticle) && rejectCount-- > 0;
    return Response.json({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: rejected ? 'rejected' : 'approved', summary: rejected ? 'Incumple el prompt de este intento' : 'Cumple el prompt', revisedPrompt: rejected ? `${rejectArticle}: corrected full scene, freely change background` : '', criteria: ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts', 'scene', 'explicit_prompt'].map((key) => ({ key, label: 'Prompt aplicable', passed: !rejected, notes: 'Evidence from original reference and exact prompt' })), marketplaceData: {} }) }] } }] });
  };
  try {
    await t.test('System config persists automation-only limits and denies operators', async () => {
      const callable = require('../functions/lib/functions/src/callables/updateSystemConfig.js').updateSystemConfig;
      await assert.rejects(() => callable.run({ data: { automationBudget: DEFAULT_AUTOMATION_BUDGET }, auth: { uid, token: { role: 'operador' } } }), { code: 'permission-denied' });
      const changed = { ...DEFAULT_AUTOMATION_BUDGET, defaultBudgetUsd: 7 };
      await callable.run({ data: { automationBudget: changed }, auth: { uid: adminUid, token: { role: 'admin' } } });
      assert.deepEqual((await systemRef.get()).data().automationBudget, changed);
      assert.equal((await systemRef.get()).data().jobMaxRetries, 1);
      await assert.rejects(() => callable.run({ data: { automationBudget: { ...changed, defaultBudgetUsd: 101 } }, auth: { uid: adminUid, token: { role: 'admin' } } }), { code: 'invalid-argument' });
    });
    await t.test('new clients configure folders dynamically with access validation and model isolation', async () => {
      const config = require('../functions/lib/functions/src/automation/clientConfig.js');
      await config.saveClientAutomation({ clientId: clientA, automation: { enabled: true, driveFolderIds: ['https://drive.google.com/drive/folders/folder-a'], defaultBudgetUsd: 5 } });
      assert.deepEqual((await db.collection('clients').doc(clientA).get()).data().automation.driveFolderIds, ['folder-a']);
      await assert.rejects(() => config.saveClientAutomation({ clientId: clientB, automation: { enabled: true, driveFolderIds: ['folder-a'] } }), { code: 'already-exists' });
      const organizer = db.collection('organizers').doc(clientA);
      await organizer.set({ sourceIds: ['folder-a'] });
      try {
        await assert.rejects(() => config.saveClientAutomation({ clientId: clientA, automation: { enabled: true, driveFolderIds: [] } }), { code: 'failed-precondition' });
        const saved = await config.saveClientAutomation({ clientId: clientA, automation: { enabled: true, defaultBudgetUsd: 5 } });
        assert.deepEqual(saved.driveFolderIds, ['folder-a']);
      } finally {
        await organizer.delete();
      }
      await assert.rejects(() => config.saveClientAutomation({ clientId: clientA, automation: { enabled: true, defaultModelId: 'foreign-model' } }), { code: 'invalid-argument' });
      await assert.rejects(() => config.saveClientAutomation({ clientId: clientA, automation: { enabled: true, defaultBudgetUsd: 101 } }), { code: 'invalid-argument' });
    });
    await t.test('Drive permissions use IDs and current membership; normalized revisions are cached by client', async () => {
      const input = { itemId: 'explicit-item', fileName: 'arbitrary.jpg', driveFile: { folderId: 'folder-a', fileId: 'file-a' } };
      const one = await drive.importDriveImage(clientA, uid, input);
      const again = await drive.importDriveImage(clientA, uid, input);
      assert.equal(downloads, 1); assert.equal(one.storagePath, again.storagePath); assert.equal(one.itemId, 'explicit-item');
      await assert.rejects(() => drive.importDriveImage(clientB, uid, input), { code: 'permission-denied' });
      await assert.rejects(() => drive.importDriveImage(clientA, uid, { ...input, driveFile: { folderId: 'folder-a', fileId: 'file-b' } }), { code: 'permission-denied' });
      driveVersion = '2'; const changed = await drive.importDriveImage(clientA, uid, input); assert.notEqual(changed.storagePath, one.storagePath); assert.equal(downloads, 2);
      await assert.rejects(() => drive.importDriveImage(clientA, uid, { ...input, driveFile: { ...input.driveFile, version: '1' } }), { code: 'failed-precondition' });
      inaccessible = true; await assert.rejects(() => drive.importDriveImage(clientA, uid, input)); inaccessible = false;
    });
    await t.test('planning is free, pins Drive revisions, and execute is atomic under concurrent calls', async () => {
      const before = providerCalls; const beforeReviews = reviewedPrompts.length;
      const input = { ...base, externalId: `plan-${randomUUID()}`, inputImages: [{ itemId: 'mapped', fileName: 'reference.jpg', driveFile: { folderId: 'folder-a', fileId: 'file-a' } }] };
      const prepared = await Promise.all(Array.from({ length: 5 }, () => plans.prepareAutomationPlan(input, uid, 'operador')));
      assert.equal(new Set(prepared.map((p: any) => p.id)).size, 1); assert.equal(providerCalls, before); assert.equal(reviewedPrompts.length, beforeReviews);
      assert.equal(prepared[0].request.inputImages[0].driveFile.version, '2');
      assert.equal(plans.publicAutomationPlan(prepared[0]).imageCount, 6);
      const execution = await Promise.all(Array.from({ length: 5 }, () => plans.executeAutomationPlan(prepared[0].id, uid, 'operador')));
      assert.equal(new Set(execution.map((r: any) => r.jobId)).size, 1); assert.ok(execution[0].createdAt);
      await worker.processAutomation(execution[0].jobId);
      const job = (await db.collection('automationJobs').doc(execution[0].jobId).get()).data();
      assert.equal(job.generationJobIds.length, 6);
      assert.equal((await plans.executeAutomationPlan(prepared[0].id, uid, 'operador')).jobId, job.id);
      await assert.rejects(() => plans.readAutomationPlan(prepared[0].id, 'another-user', 'operador'), { code: 'not-found' });
    });
    await t.test('unknown cost authorization is explicit and planning never hides paid classification', async () => {
      const plan = await plans.prepareAutomationPlan({ ...base, externalId: randomUUID(), allowEstimatedCosts: false }, uid, 'operador');
      await assert.rejects(() => plans.executeAutomationPlan(plan.id, uid, 'operador'), { code: 'failed-precondition' });
      assert.equal((await db.collection('automationJobs').where('planId', '==', plan.id).get()).size, 0);
    });
    await t.test('budget reservations serialize concurrent spending and reconcile exactly once', async () => {
      const created = await persistence.createAutomation({ ...base, budgetUsd: 1, externalId: randomUUID() }, uid, 'operador');
      const holds = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => budgets.reserveAutomationOperation(created.jobId, `operation-${i}`, 'generation', 0.3)));
      assert.equal(holds.filter((r: any) => r.status === 'fulfilled').length, 3);
      let job = (await db.collection('automationJobs').doc(created.jobId).get()).data(); assert.equal(job.budget.reservedUsd, 0.9);
      const successfulIndex = holds.findIndex((r: any) => r.status === 'fulfilled');
      const id = (holds[successfulIndex] as PromiseFulfilledResult<string>).value;
      await Promise.all(Array.from({ length: 5 }, () => budgets.settleAutomationOperation(created.jobId, id, 0.1, true)));
      job = (await db.collection('automationJobs').doc(created.jobId).get()).data(); assert.equal(job.budget.reservedUsd, 0.6); assert.equal(job.budget.spentUsd, 0.1); assert.equal(job.budget.recordedUsd, 0.1);
      await assert.rejects(() => budgets.reserveAutomationOperation(created.jobId, `operation-${successfulIndex}`, 'generation', 0.3));
      await assert.rejects(() => persistence.createAutomation({ ...base, clientId: clientB, externalId: randomUUID() }, uid, 'operador'), { code: 'permission-denied' });
      const other = await persistence.createAutomation({ ...base, clientId: clientB, inputImages: [{ itemId: 'b', fileName: 'reference.jpg', storagePath: inputPathB }], budgetUsd: 1, externalId: randomUUID() }, uid, 'operador');
      assert.ok(await budgets.reserveAutomationOperation(other.jobId, 'separate-client', 'generation', 0.9));
    });
    await t.test('global edits apply to the next paid operation without deployment or cache expiry', async () => {
      const created = await persistence.createAutomation({ ...base, budgetUsd: 3, externalId: randomUUID() }, uid, 'operador');
      await systemRef.update({ automationBudget: { ...DEFAULT_AUTOMATION_BUDGET, defaultBudgetUsd: 0.1, maxBudgetUsd: 0.2 } });
      await assert.rejects(() => budgets.reserveAutomationOperation(created.jobId, 'after-limit-change', 'generation', 0.3), { code: 'resource-exhausted' });
      await systemRef.update({ automationBudget: DEFAULT_AUTOMATION_BUDGET }); system.invalidateSystemConfigCache();
    });
    await t.test('paid garment analysis requires explicit authorization and survives intake retry without reanalysis', async () => {
      await db.collection('models').doc('advanced-model').set({ clientId: clientA, name: 'Modelo autorizado', status: 'active', poseCount: 1, poses: [{ id: 'front', storagePath: inputPath, fileName: 'front.jpg', aiClassification: { usableForGarmentViews: ['front'], orientationGroup: 'front', orientationDetail: 'front', framing: 'full_body', bodyFocus: 'full_body' } }] });
      const garment = { ...base, jobType: 'garment', modelId: 'advanced-model', inputImages: [{ itemId: 'shirt', fileName: 'reference.jpg', storagePath: inputPath }] };
      const denied = await persistence.createAutomation({ ...garment, externalId: randomUUID() }, uid, 'operador');
      await worker.processAutomation(denied.jobId); assert.equal(classificationCalls, 0);
      assert.equal((await db.collection('automationJobs').doc(denied.jobId).get()).data().status, 'failed');
      const core = require('../functions/lib/functions/src/callables/createGenerationBatch.js'); const original = core.createGenerationBatchesCore;
      const created = await persistence.createAutomation({ ...garment, authorizeClassification: true, externalId: randomUUID() }, uid, 'operador');
      try {
        core.createGenerationBatchesCore = async () => { throw new Error('Simulated interruption after paid analysis'); };
        await worker.processAutomation(created.jobId);
      } finally { core.createGenerationBatchesCore = original; }
      const partial = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      assert.equal(partial.status, 'failed'); assert.equal(classificationCalls, 1); assert.equal(Object.keys(partial.analysisCache).length, 1);
      assert.equal(partial.budget.spentUsd, 0.05); assert.ok(partial.budget.recordedUsd > 0);
      await persistence.retryAutomation({ jobId: created.jobId }, uid, 'operador');
      await worker.processAutomation(created.jobId);
      const done = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      assert.equal(done.status, 'processing'); assert.equal(classificationCalls, 1); assert.equal(done.generationJobIds.length, 1);
      assert.equal(done.budget.recordedUsd, partial.budget.recordedUsd);
    });
    await t.test('classification incidents stay attached to their articles while valid siblings finish without duplicate work', async () => {
      const itemIds = ['uncertain-first', 'valid-middle', 'incompatible-pose', 'wrong-kind-object', 'transport-error-article', 'valid-last'];
      const beforeClassification = classificationCalls;
      const created = await persistence.createAutomation({ ...base, jobType: 'garment', modelId: 'advanced-model', authorizeClassification: true, externalId: randomUUID(), inputImages: itemIds.map((itemId) => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })) }, uid, 'operador');
      await Promise.all([worker.processAutomation(created.jobId), worker.processAutomation(created.jobId)]);
      let job = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      assert.equal(classificationCalls - beforeClassification, itemIds.length);
      assert.equal(job.status, 'processing'); assert.equal(job.generationJobIds.length, 2);
      assert.equal(job.items.filter((item: any) => item.issue).length, 4);
      assert.equal(job.items.find((item: any) => item.itemId === 'uncertain-first').issue.code, 'classification-required');
      assert.equal(job.items.find((item: any) => item.itemId === 'incompatible-pose').issue.code, 'no-compatible-poses');
      assert.equal(job.items.find((item: any) => item.itemId === 'transport-error-article').issue.code, 'classification-failed');
      const scenes = await db.getAll(...job.generationJobIds.map((id: string) => db.collection('jobs').doc(id)));
      assert.deepEqual(scenes.map((scene: any) => scene.data().garmentId).sort(), ['valid-last', 'valid-middle']);
      const beforeProvider = providerCalls;
      for (const scene of scenes) await Promise.all([generation.processJob(scene.id, 'create', { skipBacklogSweep: true }), generation.processJob(scene.id, 'create', { skipBacklogSweep: true })]);
      job = await worker.refreshAutomation(job.id);
      assert.equal(job.status, 'needs_attention'); assert.equal(job.outputImages.length, 2);
      assert.deepEqual(job.progress, { total: 2, completed: 2, failed: 0 });
      assert.equal(job.items.length, 6); assert.equal(job.items.filter((item: any) => item.status === 'completed').length, 2);
      assert.equal(results.automationReport(job).issues.filter((issue: any) => issue.itemId).length, 4);
      const refreshed = await worker.refreshAutomation(job.id);
      assert.deepEqual(refreshed.items, job.items);
      await worker.processAutomation(job.id);
      for (const scene of scenes) await generation.processJob(scene.id, 'create', { skipBacklogSweep: true });
      assert.equal(providerCalls - beforeProvider, 2); assert.equal(classificationCalls - beforeClassification, itemIds.length);
      assert.equal((await db.collection('batches').where('automationJobId', '==', job.id).get()).size, 1);
      assert.equal(job.inputImages.length, itemIds.length);
    });
    await t.test('when every article needs classification attention no empty batch is created and retry reuses paid analysis', async () => {
      const created = await persistence.createAutomation({ ...base, jobType: 'garment', modelId: 'advanced-model', authorizeClassification: true, externalId: randomUUID(), inputImages: ['uncertain-only', 'incompatible-only'].map((itemId) => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })) }, uid, 'operador');
      const before = classificationCalls;
      await worker.processAutomation(created.jobId);
      let job = await worker.refreshAutomation(created.jobId);
      assert.equal(job.status, 'needs_attention'); assert.equal(job.batchId, null); assert.equal(job.leaseToken, null);
      assert.deepEqual(job.generationJobIds, []); assert.equal(job.items.length, 2);
      assert.equal((await db.collection('batches').where('automationJobId', '==', job.id).get()).size, 0);
      await persistence.retryAutomation({ jobId: job.id }, uid, 'operador');
      await worker.processAutomation(job.id);
      job = await worker.refreshAutomation(job.id);
      assert.equal(job.items.length, 2); assert.equal(job.status, 'needs_attention'); assert.equal(classificationCalls - before, 2);
    });
    await t.test('an article incident never bypasses a later budget pause or duplicates classification on resume', async () => {
      const created = await persistence.createAutomation({ ...base, budgetUsd: 0.05, jobType: 'garment', modelId: 'advanced-model', authorizeClassification: true, externalId: randomUUID(), inputImages: ['uncertain-budget', 'valid-after-budget'].map((itemId) => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })) }, uid, 'operador');
      const before = classificationCalls;
      await worker.processAutomation(created.jobId);
      let job = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      assert.equal(job.spendingPaused, true); assert.equal(classificationCalls - before, 1);
      assert.equal(job.items[0].issue.code, 'classification-required'); assert.equal(job.batchId, null);
      await recovery.resumeAutomation({ jobId: job.id, budgetUsd: 1 }, uid, 'operador');
      await worker.processAutomation(job.id);
      job = await worker.refreshAutomation(job.id);
      assert.equal(job.status, 'processing'); assert.equal(job.items.length, 2); assert.equal(job.generationJobIds.length, 1);
      assert.equal(classificationCalls - before, 2);
    });
    await t.test('gender defaults persist, split mixed articles atomically, and reuse paid analysis on retry', async () => {
      const config = require('../functions/lib/functions/src/automation/clientConfig.js');
      const core = require('../functions/lib/functions/src/callables/createGenerationBatch.js');
      const models = [
        { id: 'gender-man', sex: 'male', poses: ['front-one', 'front-two'] },
        { id: 'gender-woman', sex: 'female', poses: ['front'] },
      ];
      for (const model of models) await db.collection('models').doc(model.id).set({
        clientId: clientA, name: model.id, status: 'active', active: true, poseCount: model.poses.length,
        identityTraits: { sex: model.sex, age: null, skin: null, hairColor: null, hairLength: null, build: null },
        poses: model.poses.map(id => ({ id, storagePath: inputPath, fileName: `${id}.jpg`, aiClassification: {
          usableForGarmentViews: ['front'], orientationGroup: 'front', orientationDetail: 'front', framing: 'full_body', bodyFocus: 'full_body',
        } })),
      });
      const previous = (await db.collection('clients').doc(clientA).get()).data().automation;
      const saved = await config.saveClientAutomation({ clientId: clientA, automation: { ...previous } });
      assert.equal(saved.defaultMaleModelId, 'gender-man'); assert.equal(saved.defaultFemaleModelId, 'gender-woman');
      await assert.rejects(() => config.saveClientAutomation({ clientId: clientA, automation: { ...saved, defaultFemaleModelId: 'gender-man' } }), { code: 'invalid-argument' });
      await assert.rejects(() => config.saveClientAutomation({ clientId: clientB, automation: { enabled: true, defaultMaleModelId: 'gender-man' } }), { code: 'invalid-argument' });
      const itemIds = ['male-shirt', 'female-shirt', 'unisex-shirt', 'unknown-gender-shirt', 'low-gender-shirt'];
      const plan = await plans.prepareAutomationPlan({ ...base, jobType: 'garment', authorizeClassification: true, budgetUsd: 10,
        externalId: randomUUID(), inputImages: itemIds.map(itemId => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })),
      }, uid, 'operador');
      assert.equal(plan.modelOptions.length, 2); assert.equal(plan.modelId, null);
      assert.equal(plans.publicAutomationPlan(plan).imageCount, 10, 'Estimates use the model with more poses');
      const before = classificationCalls;
      const created = await plans.executeAutomationPlan(plan.id, uid, 'operador');
      const original = core.createGenerationBatchesCore;
      try {
        core.createGenerationBatchesCore = async () => { throw new Error('Simulated interruption before committing groups'); };
        await worker.processAutomation(created.jobId);
      } finally { core.createGenerationBatchesCore = original; }
      let job = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      assert.equal(job.status, 'failed'); assert.equal(classificationCalls - before, itemIds.length);
      assert.equal((await db.collection('batches').where('automationJobId', '==', job.id).get()).size, 0);
      // Grouping by model may reorder items; retry must preserve each assignment.
      const assignmentsOf = (items: any[]) => items.filter(item => item.modelId).map(item => [item.itemId, item.modelId]).sort((a, b) => a[0].localeCompare(b[0]));
      const assignments = assignmentsOf(job.items);
      await persistence.retryAutomation({ jobId: job.id }, uid, 'operador');
      const batchCount = (await db.collection('clients').doc(clientA).get()).data().batchCount;
      await Promise.all([worker.processAutomation(job.id), worker.processAutomation(job.id)]);
      job = await worker.refreshAutomation(job.id);
      assert.equal(job.status, 'processing'); assert.equal(job.batchIds.length, 2);
      assert.equal(classificationCalls - before, itemIds.length, 'Retry reuses the same classification');
      assert.equal((await db.collection('clients').doc(clientA).get()).data().batchCount, batchCount + 2);
      assert.deepEqual(assignmentsOf(job.items), assignments);
      assert.equal(job.items.find((item: any) => item.itemId === 'male-shirt').modelId, 'gender-man');
      assert.equal(job.items.find((item: any) => item.itemId === 'female-shirt').modelId, 'gender-woman');
      for (const itemId of ['unknown-gender-shirt', 'low-gender-shirt']) assert.equal(job.items.find((item: any) => item.itemId === itemId).issue.code, 'garment-gender-required');
      const batches = await db.getAll(...job.batchIds.map((id: string) => db.collection('batches').doc(id)));
      assert.deepEqual(new Set(batches.map((batch: any) => batch.data().modelId)), new Set(['gender-man', 'gender-woman']));
      const scenes = await db.getAll(...job.generationJobIds.map((id: string) => db.collection('jobs').doc(id)));
      for (const scene of scenes) {
        assert.ok(job.batchIds.includes(scene.data().batchId));
        assert.equal(scene.data().modelId, job.items.find((item: any) => item.itemId === scene.data().garmentId).modelId);
        await generation.processJob(scene.id, 'create', { skipBacklogSweep: true });
      }
      job = await worker.refreshAutomation(job.id);
      assert.equal(job.status, 'needs_attention'); assert.equal(job.outputImages.length, scenes.length);
      assert.equal(job.progress.failed, 0); assert.equal(results.automationReport(job).catalogUrls.length, 2);
      const JSZip = require('../functions/node_modules/jszip');
      const zip = await JSZip.loadAsync(await results.automationResultsZip(job));
      const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      assert.equal(manifest.images.length, scenes.length); assert.deepEqual(new Set(manifest.images.map((image: any) => image.batchId)), new Set(job.batchIds));
      await worker.processAutomation(job.id);
      assert.equal((await db.collection('batches').where('automationJobId', '==', job.id).get()).size, 2);
    });
    await t.test('a single available gender model handles male, female, unisex and unknown garments', async () => {
      const config = require('../functions/lib/functions/src/automation/clientConfig.js');
      for (const sex of ['female', 'male']) {
        await db.collection('models').doc('gender-man').update({ active: sex === 'male' });
        await db.collection('models').doc('gender-woman').update({ active: sex === 'female' });
        const saved = await config.saveClientAutomation({ clientId: clientA, automation: { enabled: true } });
        assert.equal(saved[sex === 'male' ? 'defaultMaleModelId' : 'defaultFemaleModelId'], `gender-${sex === 'male' ? 'man' : 'woman'}`);
        const itemIds = ['male-only', 'female-only', 'unisex-only', 'unknown-gender-only'];
        const created = await persistence.createAutomation({ ...base, jobType: 'garment', authorizeClassification: true, budgetUsd: 10,
          externalId: randomUUID(), inputImages: itemIds.map(itemId => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })),
        }, uid, 'operador');
        await worker.processAutomation(created.jobId);
        const job = await worker.refreshAutomation(created.jobId);
        assert.equal(job.status, 'processing'); assert.equal(job.batchIds.length, 1);
        assert.equal(job.items.length, 4); assert.ok(job.items.every((item: any) => item.modelId === `gender-${sex === 'male' ? 'man' : 'woman'}` && !item.issue));
      }
    });
    let productionJob: any;
    await t.test('all six scenes per article start independently; a rejected scene cannot block siblings or other articles', async () => {
      const created = await persistence.createAutomation({ ...base, externalId: randomUUID(), inputImages: ['A','B','C'].map((itemId) => ({ itemId, fileName: `${itemId}.jpg`, storagePath: inputPath })) }, uid, 'operador');
      await worker.processAutomation(created.jobId);
      productionJob = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      const snapshots = await db.getAll(...productionJob.generationJobIds.map((id: string) => db.collection('jobs').doc(id)));
      assert.equal(snapshots.length, 18);
      assert.equal(snapshots.filter((s: any) => !s.data().automationGate && s.data().status === 'pending').length, 18);
      for (const snap of snapshots) await snap.ref.update({ finalPrompt: `${snap.data().garmentId}: ${snap.data().finalPrompt}` });
      const failedScene = snapshots.find((scene: any) => scene.data().garmentId === 'B');
      rejectArticle = 'B:'; rejectCount = 3;
      for (let attempt = 0; attempt < 3; attempt++) await generation.processJob(failedScene.id, 'create', { skipBacklogSweep: true });
      rejectArticle = '';
      const partial = await worker.refreshAutomation(productionJob.id);
      assert.equal(partial.status, 'processing');
      const b = partial.items.find((item: any) => item.itemId === 'B');
      assert.equal(b.scenes.filter((scene: any) => scene.status === 'failed').length, 1);
      assert.equal(b.scenes.filter((scene: any) => scene.status === 'pending').length, 5);
      assert.equal(b.scenes.find((scene: any) => scene.jobId === failedScene.id).attempts, 3);
      for (const scene of snapshots.filter((scene: any) => scene.id !== failedScene.id)) {
        await Promise.all([generation.processJob(scene.id, 'create', { skipBacklogSweep: true }), generation.processJob(scene.id, 'create', { skipBacklogSweep: true })]);
      }
      const done = await worker.refreshAutomation(productionJob.id); assert.equal(done.status, 'needs_attention'); assert.equal(done.outputImages.length, 17);
      assert.equal(done.items.find((item: any) => item.itemId === 'B').scenes.filter((scene: any) => scene.status === 'completed').length, 5);
      const beforeDuplicate = providerCalls;
      await worker.processAutomation(productionJob.id);
      await Promise.all(snapshots.map((scene: any) => generation.processJob(scene.id, 'create', { skipBacklogSweep: true })));
      assert.equal(providerCalls, beforeDuplicate);
      assert.equal((await failedScene.ref.collection('outputs').get()).size, 3);
      assert.deepEqual((await db.collection('automationJobs').doc(productionJob.id).get()).data().generationJobIds, productionJob.generationJobIds);
    });
    await t.test('reviews use the exact attempt prompt and originals, and corrections are never rewrapped', async () => {
      assert.ok(reviewedPrompts.some((prompt) => prompt.includes('B:: corrected full scene, freely change background')));
      assert.ok(requestedPrompts.includes('B:: corrected full scene, freely change background'));
      assert.ok(reviewedPrompts.every((prompt) => !prompt.includes('Approximate similarity (~70%)')));
      const usage = await db.collection('analytics_gemini_usage').where('clientId', '==', clientA).get();
      assert.ok(usage.size >= 20); assert.ok(usage.docs.filter((s: any) => s.data().status === 'success').every((s: any) => s.data().estimatedCostUsd > 0));
      assert.ok(usage.docs.some((s: any) => s.data().status === 'error' && s.data().feature === 'garment_view_category_color_classification'));
    });
    await t.test('approved downloads reuse Catalog assets and include an explicit manifest excluding rejects', async () => {
      const JSZip = require('../functions/node_modules/jszip');
      const current = await worker.refreshAutomation(productionJob.id);
      const archive = await JSZip.loadAsync(await results.automationResultsZip(current));
      const manifest = JSON.parse(await archive.file('manifest.json').async('string'));
      assert.equal(manifest.images.length, 17); assert.ok(manifest.images.every((image: any) => image.clientId === clientA && image.reviewStatus === 'approved' && image.outputId && image.jobId));
    });
    await t.test('exhaustion preserves outputs and safely resumes the same scenes after authorized budget increase', async () => {
      const created = await persistence.createAutomation({ ...base, externalId: randomUUID(), budgetUsd: 0.06 }, uid, 'operador');
      await worker.processAutomation(created.jobId);
      let current = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      const snapshots = await db.getAll(...current.generationJobIds.map((id: string) => db.collection('jobs').doc(id)));
      const first = snapshots[0];
      await generation.processJob(first.id, 'create', { skipBacklogSweep: true });
      const failed = (await first.ref.get()).data(); assert.equal(failed.automationGate, 'budget'); assert.ok(failed.currentOutput); assert.equal(failed.currentOutput.autoReview, null);
      const paidBeforeBudgetStops = providerCalls;
      for (const scene of snapshots.slice(1)) await generation.processJob(scene.id, 'create', { skipBacklogSweep: true });
      assert.equal(providerCalls, paidBeforeBudgetStops);
      current = await worker.refreshAutomation(created.jobId); assert.equal(current.status, 'needs_attention');
      const ids = current.generationJobIds;
      await recovery.resumeAutomation({ jobId: current.id, budgetUsd: 2 }, uid, 'operador');
      const beforeResume = providerCalls;
      await generation.processJob(first.id, 'requeue', { skipBacklogSweep: true });
      assert.equal(providerCalls, beforeResume);
      const resumed = (await first.ref.get()).data(); assert.equal(resumed.status, 'completed');
      assert.equal(resumed.generationAttemptCount, 1);
      assert.deepEqual((await db.collection('automationJobs').doc(current.id).get()).data().generationJobIds, ids);
      assert.equal((await first.ref.collection('outputs').get()).size, 1);
    });
    await t.test('worker persists exact generated path, extension, MIME and bytes for JPEG, PNG and WebP on either side of 3 MiB', async () => {
      const created = await persistence.createAutomation({ ...base, externalId: randomUUID(), budgetUsd: 2 }, uid, 'operador');
      await worker.processAutomation(created.jobId);
      const job = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      let index = 0;
      try {
        for (const oversized of [false, true]) for (const format of ['jpeg', 'png', 'webp']) {
          const original = await sharp({ create: { width: 13, height: 7, channels: 4, background: '#22664488' } })[format]().toBuffer();
          generatedImage = { bytes: oversized ? Buffer.concat([original, Buffer.alloc(3 * 1024 * 1024 + 1 - original.length)]) : original, contentType: `image/${format}` };
          const ref = db.collection('jobs').doc(job.generationJobIds[index++]);
          await ref.update({ photoProfile: admin.firestore.FieldValue.delete() }); // legacy characterization
          const before = providerCalls;
          await generation.processJob(ref.id, 'create', { skipBacklogSweep: true });
          const done = (await ref.get()).data();
          assert.equal(done.status, 'completed', done.lastError);
          assert.equal(providerCalls, before + 1);
          const expectedMime = oversized ? 'image/jpeg' : `image/${format}`;
          const extension = expectedMime === 'image/jpeg' ? 'jpg' : format;
          const path = `generated/${done.clientId}/${done.batchId}/${ref.id}/${done.currentOutputId}.${extension}`;
          assert.equal(done.currentOutput.resultImagePath, path);
          assert.equal(done.currentOutput.contentType, expectedMime);
          assert.deepEqual((await ref.collection('outputs').doc(done.currentOutputId).get()).data(), done.currentOutput);
          const [metadata] = await bucket.file(path).getMetadata();
          assert.equal(metadata.contentType, expectedMime);
          assert.equal(metadata.cacheControl, 'private, max-age=31536000');
          const [stored] = await bucket.file(path).download();
          const expected = oversized ? await sharp(generatedImage.bytes, { failOn: 'none' }).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer() : original;
          assert.deepEqual(stored, expected);
          assert.equal((await sharp(stored).metadata()).format, oversized ? 'jpeg' : format);
        }
      } finally { generatedImage = { bytes, contentType: 'image/jpeg' }; }
    });
    await t.test('operational review retry reuses the compressed output and keeps quality attempts separate', async () => {
      const created = await persistence.createAutomation({ ...base, externalId: randomUUID(), budgetUsd: 2 }, uid, 'operador');
      await worker.processAutomation(created.jobId);
      const job = (await db.collection('automationJobs').doc(created.jobId).get()).data();
      const first = db.collection('jobs').doc(job.generationJobIds[0]);
      const before = providerCalls; reviewTransportFailures = 1;
      const png = await sharp(bytes).png().toBuffer();
      generatedImage = { bytes: Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024 + 1 - png.length)]), contentType: 'image/png' };
      try { await generation.processJob(first.id, 'create', { skipBacklogSweep: true }); }
      finally { generatedImage = { bytes, contentType: 'image/jpeg' }; }
      const partial = (await first.get()).data(); assert.equal(partial.status, 'pending'); assert.equal(partial.automationReviewPending, true); assert.equal(partial.retryCount, 1);
      assert.equal(partial.currentOutput.contentType, 'image/jpeg');
      assert.ok(partial.currentOutput.resultImagePath.endsWith(`/${partial.currentOutputId}.jpg`));
      const file = bucket.file(partial.currentOutput.resultImagePath);
      const [storedBefore] = await file.download();
      const [metadataBefore] = await file.getMetadata();
      await generation.processJob(first.id, 'requeue', { skipBacklogSweep: true });
      const done = (await first.get()).data(); assert.equal(done.status, 'completed'); assert.equal(done.generationAttemptCount, 1); assert.equal(providerCalls, before + 1);
      assert.equal(done.currentOutputId, partial.currentOutputId); assert.equal(done.completedOutputCount, 1); assert.equal((await first.collection('outputs').get()).size, 1);
      assert.equal(done.currentOutput.resultImagePath, partial.currentOutput.resultImagePath);
      assert.equal(done.currentOutput.contentType, partial.currentOutput.contentType);
      assert.equal(done.totalCostUsd, partial.totalCostUsd);
      assert.equal(done.totalDurationSeconds, partial.totalDurationSeconds);
      assert.deepEqual(done.providerUsage, partial.providerUsage);
      const [storedAfter] = await file.download(); const [metadataAfter] = await file.getMetadata();
      assert.deepEqual(storedAfter, storedBefore);
      assert.equal(metadataAfter.generation, metadataBefore.generation);
      assert.equal(metadataAfter.contentType, 'image/jpeg');
    });
    await t.test('machine API authorizes multiple configured clients and scopes every plan, job and download', async () => {
      const machineAuth = require('../functions/lib/functions/src/automation/machineAuth.js');
      const api = require('../functions/lib/functions/src/automation/api.js');
      const secret = 'test-machine-secret-with-sufficient-entropy-placeholder';
      await db.collection('automationPrincipals').doc('advanced-machine').set({ active: true, version: 1, allowedClientIds: [clientA, clientB], allowedJobTypes: ['product'], scopes: ['jobs:create', 'jobs:read'], secretHashes: [{ hash: machineAuth.credentialHash(secret), expiresAt: null }] });
      const issued = await machineAuth.issueMachineToken('advanced-machine', secret);
      const http = async (method: string, path: string, body?: any, token = issued.access_token) => {
        let status = 200, data: any;
        const response = { set: () => response, status: (value: number) => { status = value; return response; }, json: (value: any) => { data = value; return response; }, send: (value: any) => { data = value; return response; } };
        await api.automationHttpHandler({ method, path, body, query: {}, headers: { authorization: `Bearer ${token}` } }, response);
        return { status, data };
      };
      const caps = await http('GET', '/capabilities'); assert.equal(caps.status, 200); assert.equal(caps.data.clients.length, 2); assert.equal(JSON.stringify(caps.data).includes('secretHashes'), false);
      for (const [clientId, folderId, fileId] of [[clientA, 'folder-a', 'file-a'], [clientB, 'folder-b', 'file-b']]) {
        const prepared = await http('POST', '/plans', { ...base, clientId, externalId: randomUUID(), inputImages: [{ itemId: 'mapped-item', fileName: 'photo.jpg', driveFile: { folderId, fileId } }] });
        assert.equal(prepared.status, 200); const planId = prepared.data.planId;
        assert.equal((await http('GET', `/plans/${planId}`)).data.clientId, clientId);
        const executed = await http('POST', `/plans/${planId}/execute`); assert.equal(executed.status, 202); assert.ok(executed.data.createdAt);
        assert.equal((await http('GET', `/jobs/${executed.data.jobId}`)).data.clientId, clientId);
        assert.equal((await http('POST', `/jobs/${executed.data.jobId}/resume`, {})).status, 403);
      }
      const foreign = await http('POST', '/plans', { ...base, clientId: 'not-authorized', externalId: randomUUID() }); assert.equal(foreign.status, 403);
      assert.equal((await http('GET', `/jobs/${productionJob.id}/download`)).status, 404);
      const readOnly = await machineAuth.issueMachineToken('advanced-machine', secret, 'jobs:read');
      assert.equal((await http('POST', '/plans', base, readOnly.access_token)).status, 403);
    });
    await t.test('legacy automation without an authorized budget is held before any new paid generation', async () => {
      const intake = await persistence.createAutomation({ ...base, externalId: randomUUID() }, uid, 'operador');
      await db.collection('automationJobs').doc(intake.jobId).update({ effectivePolicy: admin.firestore.FieldValue.delete(), budget: admin.firestore.FieldValue.delete() });
      const beforeAnalysis = classificationCalls;
      await worker.processAutomation(intake.jobId);
      assert.equal((await db.collection('automationJobs').doc(intake.jobId).get()).data().status, 'needs_attention');
      assert.equal(classificationCalls, beforeAnalysis);
      const current = (await db.collection('jobs').doc(productionJob.generationJobIds[0]).get()).data();
      const legacy = { ...current, automationJobId: 'legacy-without-budget', status: 'pending', currentOutput: null, currentOutputId: null, generationAttemptCount: 0, claimToken: null, automationGate: null };
      delete legacy.automationManaged;
      const ref = db.collection('jobs').doc(); await ref.set(legacy);
      const before = providerCalls;
      await generation.processJob(ref.id, 'create', { skipBacklogSweep: true });
      assert.equal(providerCalls, before); assert.equal((await ref.get()).data().automationGate, 'budget');
      const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js');
      assert.equal(buildRegenerateJobPatch(legacy, 'fal-seedream-5-flash', 'Explicit manual recovery').automationManaged, false);
    });
    await t.test('manual regeneration keeps traceability and bypasses automation limits', async () => {
      const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js');
      const current = (await db.collection('automationJobs').doc(productionJob.id).get()).data();
      const ref = db.collection('jobs').doc(current.generationJobIds[0]); const old = (await ref.get()).data();
      const history = (await ref.collection('outputs').get()).size;
      await ref.update(buildRegenerateJobPatch(old, 'fal-seedream-5-flash', 'Manual catalog regeneration'));
      await systemRef.update({ automationBudget: { ...DEFAULT_AUTOMATION_BUDGET, defaultBudgetUsd: 0.01, maxBudgetUsd: 0.01, maxReviewAttempts: 1, maxOperationalRetries: 0 } });
      const budgetBefore = (await db.collection('automationJobs').doc(current.id).get()).data().budget;
      await generation.processJob(ref.id, 'requeue', { skipBacklogSweep: true });
      const after = (await ref.get()).data(); assert.equal(after.status, 'completed'); assert.equal(after.automationJobId, current.id); assert.equal(after.automationManaged, false); assert.equal(after.autoReviewMaxAttempts, 3);
      assert.equal((await ref.collection('outputs').get()).size, history + 1);
      assert.deepEqual((await db.collection('automationJobs').doc(current.id).get()).data().budget, budgetBefore);
    });
    await t.test('manual and automatic completion create no spreadsheets; explicit download creates the first export without new image calls', async () => {
      await systemRef.update({ automationBudget: DEFAULT_AUTOMATION_BUDGET }); system.invalidateSystemConfigCache();
      const { createProductGenerationBatchCore } = require('../functions/lib/functions/src/callables/createProductGenerationBatch.js');
      const manual = await createProductGenerationBatchCore({ clientId: clientA, requestId: randomUUID(), provider: 'fal-seedream-5-flash', prompt: 'QA manual product', items: [{ id: 'manual-export-product', name: 'Producto manual', referencePaths: [inputPath] }], scenes: [{ type: 'hero', prompt: 'Studio photograph' }] }, uid);
      for (const scene of (await db.collection('jobs').where('batchId', '==', manual.batchId).get()).docs) await generation.processJob(scene.id, 'create', { skipBacklogSweep: true });
      const automated = await persistence.createAutomation({ ...base, budgetUsd: 10, externalId: randomUUID() }, uid, 'operador');
      await worker.processAutomation(automated.jobId);
      let automatic = (await db.collection('automationJobs').doc(automated.jobId).get()).data();
      for (const id of automatic.generationJobIds) await generation.processJob(id, 'create', { skipBacklogSweep: true });
      await worker.refreshAutomation(automated.jobId);
      automatic = (await db.collection('automationJobs').doc(automated.jobId).get()).data();
      assert.equal(automatic.status, 'completed', JSON.stringify(automatic.error));
      assert.equal((await db.collection('marketplaceExportRequests').get()).size, 0);
      assert.equal((await bucket.getFiles({ prefix: `client_spreadsheet_exports/${clientA}/` }))[0].length, 0);
      const XLSX = require('../functions/node_modules/xlsx'); const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['seller_sku', 'product_name'], ['', '']]), 'Products');
      const sourcePath = `client_spreadsheets/${clientA}/test-export-upload/source.xlsx`;
      const original = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); await bucket.file(sourcePath).save(original);
      const { importClientSpreadsheetTemplate } = require('../functions/lib/functions/src/callables/importClientSpreadsheetTemplate.js');
      const exports = require('../functions/lib/functions/src/callables/marketplaceExports.js');
      const req = (data: any) => ({ auth: { uid: adminUid, token: {} }, data });
      await db.collection('clients').doc(clientA).update({ marketplaces: { 'tiktok-shop': { enabled: true } } });
      const imported = await importClientSpreadsheetTemplate.run(req({ clientId: clientA, storagePath: sourcePath, originalFileName: 'source.xlsx', marketplaceId: 'tiktok-shop' }));
      const template = (await db.collection('clients').doc(clientA).collection('spreadsheetTemplates').doc(imported.templateId).get()).data();
      const configured = await exports.configureMarketplaceTemplate.run(req({ clientId: clientA, templateId: imported.templateId, marketplaceId: 'tiktok-shop', operation: 'listing', mappings: template.exportConfig.mappings }));
      const scope = { clientId: clientA, batchIds: [manual.batchId, ...automatic.batchIds || [automatic.batchId]] };
      const preview = await exports.previewMarketplaceExports.run(req(scope));
      assert.equal(preview.products.length, 2);
      for (const p of preview.products) await exports.saveMasterProduct.run(req({ ...scope, productId: p.id, expectedRevision: 0, values: { name: 'Verified QA product' }, variants: [{ id: 'sku', values: { sku: `qa-${p.id}` } }], marketplaces: { 'tiktok-shop': { templateId: configured.templateId, categoryId: 'products' } } }));
      assert.equal((await exports.previewMarketplaceExports.run(req(scope))).channels[0].ready, true);
      assert.equal((await bucket.getFiles({ prefix: `client_spreadsheet_exports/${clientA}/` }))[0].length, 0);
      const callsBefore = providerCalls; const budgetBefore = (await db.collection('automationJobs').doc(automated.jobId).get()).get('budget');
      const downloaded = await exports.downloadMarketplaceExports.run(req({ ...scope, marketplaceIds: ['tiktok-shop'], requestId: randomUUID() }));
      assert.equal(downloaded.failures.length, 0); assert.match(downloaded.fileName, /\.xlsx$/);
      assert.equal((await bucket.getFiles({ prefix: `client_spreadsheet_exports/${clientA}/` }))[0].length, 1);
      assert.equal(providerCalls, callsBefore); assert.deepEqual((await db.collection('automationJobs').doc(automated.jobId).get()).get('budget'), budgetBefore);
      assert.deepEqual((await bucket.file(sourcePath).download())[0], original);
    });
  } finally { globalThis.fetch = originalFetch; await cleanupEmulatorDatabase(db); await admin.app().delete(); }
});
