import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST;

test('automation API, persistence, dispatch and existing worker integration (emulators only)', { skip: !enabled }, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  const admin = require('../functions/node_modules/firebase-admin');
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GEMINI_API_KEY = 'emulator-test-placeholder';
  process.env.JOB_AUTO_REVIEW_MAX_ATTEMPTS = '3';
  process.env.GEMINI_IMAGE_REVIEW_MODEL = 'test';
  process.env.FAL_KEY = 'emulator-test-placeholder';
  process.env.OPENAI_API_KEY = 'emulator-test-placeholder';
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = admin.firestore();
  const authResponse = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'automation@example.test', password: 'test-password-only', returnSecureToken: true }),
  });
  const { localId: uid } = await authResponse.json() as any;
  assert.ok(uid);
  await admin.auth().setCustomUserClaims(uid, { role: 'operador', active: true });
  const signedIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'automation@example.test', password: 'test-password-only', returnSecureToken: true }),
  });
  const { idToken } = await signedIn.json() as any;
  await db.collection('users').doc(uid).set({ uid, role: 'operador', active: true, displayName: 'Automation Test' });
  await db.collection('clients').doc('client').set({ name: 'Test client', status: 'active', batchCount: 0, createdByUid: uid });
  await db.collection('system_config').doc('main').set({ batchMaxJobs: 100, jobMaxRetries: 1, jobRetryDelayMs: 0 });
  const storage = admin.storage().bucket();
  const sharp = require('../functions/node_modules/sharp');
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#008844' } }).jpeg().toBuffer();
  const inputPath = `garments/drafts/${uid}/draft/item/front.jpg`;
  await storage.file(inputPath).save(bytes, { metadata: { contentType: 'image/jpeg' } });
  const api = require('../functions/lib/functions/src/automation/api.js');
  const persistence = require('../functions/lib/functions/src/automation/persistence.js');
  const pipeline = require('../functions/lib/functions/src/automation/pipelines.js');
  const worker = require('../functions/lib/functions/src/automation/worker.js');
  const classifier = require('../functions/lib/functions/src/callables/classifyGarmentViewsWithGemini.js');
  const base = { source: 'api', externalId: 'initial', clientId: 'client', jobType: 'garment', modelId: 'model', inputImages: [{ itemId: 'sku', fileName: 'front.jpg', storagePath: inputPath }] };
  const http = async (method: string, path: string, body?: any, token: string | null = idToken, rawBody?: Buffer) => {
    let status = 200, data: any;
    const response = { set: () => response, status: (value: number) => { status = value; return response; }, json: (value: any) => { data = value; return response; } };
    await api.automationHttpHandler({ method, path, body, headers: { authorization: token ? `Bearer ${token}` : undefined }, rawBody, is: () => rawBody ? 'image/png' : false }, response);
    return { status, data };
  };
  await t.test('HTTP rejects missing, invalid and disabled-user authentication; invalid payload', async () => {
    assert.equal((await http('POST', '/jobs', base, null)).status, 401);
    assert.equal((await http('GET', '/jobs/a', undefined, 'bad')).status, 401);
    assert.equal((await http('POST', '/jobs', {})).status, 400);
    await db.collection('users').doc(uid).update({ active: false });
    assert.equal((await http('POST', '/jobs', base)).status, 403);
    await db.collection('users').doc(uid).update({ active: true });
  });
  await t.test('direct file upload validates images', async () => {
    const upload = await http('POST', '/uploads', undefined, idToken, bytes);
    assert.equal(upload.status, 201);
    assert.ok(upload.data.storagePath.startsWith(`garments/drafts/${uid}/`));
    assert.equal((await http('POST', '/uploads', undefined, idToken, Buffer.from('not-image'))).status, 400);
    assert.equal((await http('POST', '/uploads', undefined, idToken, Buffer.from('<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"/>'))).status, 400);
  });
  await t.test('machine credentials renew without Firebase, restrict scopes/clients/owners, and revoke immediately', async () => {
    const machineAuth = require('../functions/lib/functions/src/automation/machineAuth.js');
    const secret = 'emulator-only-client-secret-with-256-bit-random-shape';
    const principal = db.collection('automationPrincipals').doc('machine-test');
    await principal.set({ active: true, version: 1, allowedClientIds: ['client'], allowedJobTypes: ['product'],
      scopes: ['uploads:write', 'jobs:create', 'jobs:read'], secretHashes: [{ hash: machineAuth.credentialHash(secret), expiresAt: null }] });
    assert.equal((await http('POST', '/token', { grant_type: 'password' }, null)).status, 400);
    assert.equal((await http('POST', '/token', { grant_type: 'client_credentials', client_id: 'machine-test', client_secret: 'wrong' }, null)).status, 401);
    const getToken = (scope?: string) => http('POST', '/token', { grant_type: 'client_credentials', client_id: 'machine-test', client_secret: secret, ...(scope ? { scope } : {}) }, null);
    const issued = await getToken();
    assert.equal(issued.status, 200); assert.equal(issued.data.expires_in, 900);
    const token = issued.data.access_token;
    const upload = await http('POST', '/uploads', undefined, token, bytes);
    assert.equal(upload.status, 201);
    assert.match(upload.data.storagePath, /^garments\/drafts\/automation-machine-test\//);
    const inputImages = [{ itemId: 'machine-sku', fileName: 'mug.jpg', storagePath: upload.data.storagePath }];
    const payload = { ...base, externalId: 'machine-order', jobType: 'product', inputImages };
    assert.equal((await http('POST', '/jobs', { ...payload, clientId: 'other-client' }, token)).status, 403);
    assert.equal((await http('POST', '/jobs', { ...payload, jobType: 'garment' }, token)).status, 403);
    const created = await http('POST', '/jobs', payload, token);
    assert.equal(created.status, 202); assert.equal(created.data.pollAfterSeconds, 20);
    const jobId = created.data.jobId;
    assert.equal((await db.collection('users').doc('automation-machine-test').get()).exists, false);
    await worker.processAutomation(jobId);
    assert.equal((await db.collection('automationJobs').doc(jobId).get()).data().status, 'processing');
    assert.equal((await http('GET', `/jobs/${jobId}`, undefined, token)).data.pollAfterSeconds, 20);
    const jobRef = db.collection('automationJobs').doc(jobId);
    const olderCreation = admin.firestore.Timestamp.fromMillis(Date.now() - 301_000);
    await jobRef.update({ createdAt: olderCreation });
    const later = await http('GET', `/jobs/${jobId}`, undefined, token);
    assert.equal(later.data.pollAfterSeconds, 60);
    const duplicate = await http('POST', '/jobs', payload, token);
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.pollAfterSeconds, 60);
    assert.equal(duplicate.data.createdAt, later.data.createdAt);
    await jobRef.update({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1801_000) });
    const timedOut = await http('GET', `/jobs/${jobId}`, undefined, token);
    assert.equal(timedOut.data.pollAfterSeconds, 0); assert.equal(timedOut.data.pollingTimedOut, true);
    assert.equal((await jobRef.get()).data().status, 'processing');
    assert.equal((await http('POST', `/jobs/${jobId}/retry`, {}, token)).status, 403);
    const readOnly = await getToken('jobs:read');
    assert.equal((await http('POST', '/uploads', undefined, readOnly.data.access_token, bytes)).status, 403);
    assert.equal((await getToken('admin')).status, 400);
    const stored = await db.collection('automationAccessTokens').doc(machineAuth.credentialHash(token)).get();
    assert.equal(JSON.stringify(stored.data()).includes(token), false);
    await stored.ref.update({ expiresAt: admin.firestore.Timestamp.fromMillis(1) });
    assert.equal((await http('GET', `/jobs/${jobId}`, undefined, token)).status, 401);
    const renewed = await getToken();
    assert.notEqual(renewed.data.access_token, token);
    await principal.update({ version: 2 });
    assert.equal((await http('GET', `/jobs/${jobId}`, undefined, renewed.data.access_token)).status, 401);
    await principal.update({ active: false });
    assert.equal((await getToken()).status, 401);
  });
  let garmentId: string;
  await t.test('parallel creation deduplicates externalId and gmailMessageId atomically', async () => {
    const payload = { ...base, gmailMessageId: 'gmail-one' };
    const receipts = await Promise.all(Array.from({ length: 8 }, () => persistence.createAutomation(payload, uid, 'operador')));
    assert.equal(new Set(receipts.map((r: any) => r.jobId)).size, 1);
    garmentId = receipts[0].jobId;
    const repeated = await http('POST', '/api/automation/jobs', { ...payload, externalId: 'alias', source: 'gmail' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.jobId, garmentId);
    assert.equal((await persistence.createAutomation({ ...base, externalId: 'alias' }, uid, 'operador')).jobId, garmentId);
    await assert.rejects(() => persistence.createAutomation(payload, 'other-user', 'operador'), { code: 'permission-denied' });
  });
  await db.collection('models').doc('model').set({ clientId: 'client', name: 'Model', status: 'active', poseCount: 1, poses: [{ id: 'front', storagePath: inputPath, fileName: 'front.jpg', aiClassification: { usableForGarmentViews: ['front'], orientationGroup: 'front', orientationDetail: 'front', framing: 'full_body', bodyFocus: 'full_body' } }] });
  classifier.classifyGarmentWithGemini = async ({ garment }: any) => ({ ...garment, photos: garment.photos.map((photo: any) => ({ ...photo, view: 'front', confidence: 0.99, classifiedBy: 'gemini' })), garmentBodyArea: 'full_body', garmentAccessoryType: null });
  await t.test('garment dispatch reuses core; duplicate worker delivery creates one batch', async () => {
    await Promise.all([worker.processAutomation(garmentId), worker.processAutomation(garmentId)]);
    const job = (await db.collection('automationJobs').doc(garmentId).get()).data();
    assert.equal(job.status, 'processing');
    assert.equal(job.generationJobIds.length, 1);
    assert.equal((await db.collection('jobs').where('automationJobId', '==', garmentId).get()).size, 1);
    assert.equal((await db.collection('batches').doc(job.batchId).get()).data().generationKind, 'garment');
  });
  await t.test('interactive generation callable keeps the manual wizard contract', async () => {
    const { createGenerationBatch } = require('../functions/lib/functions/src/callables/createGenerationBatch.js');
    const result = await createGenerationBatch.run({ auth: { uid, token: { role: 'operador' } }, data: {
      clientId: 'client', modelId: 'model', outputMode: 'photos_only', poseIds: ['front'],
      provider: 'fal-nano-banana-2', promptBase: '', productDrafts: [], garments: [{
        id: 'manual-sku', name: 'Manual', storagePath: inputPath, isMultiAngle: false, sourceType: 'single', garmentBodyArea: 'full_body',
        photos: [{ id: 'front', fileName: 'front.jpg', storagePath: inputPath, sourceIndex: 0, view: 'front', classifiedBy: 'gemini' }],
      }],
    } });
    assert.equal(result.createdJobs, 1);
    const batch = (await db.collection('batches').doc(result.batchId).get()).data();
    assert.equal(batch.automationJobId, undefined);
    assert.equal(batch.outputMode, 'photos_only');
    assert.equal(batch.modelId, 'model');
  });
  await t.test('missing model requires attention; intake retries are limited', async () => {
    const { jobId } = await persistence.createAutomation({ ...base, modelId: undefined, externalId: randomUUID() }, uid, 'operador');
    for (let attempt = 0; attempt < 3; attempt++) {
      await worker.processAutomation(jobId);
      assert.equal((await db.collection('automationJobs').doc(jobId).get()).data().status, 'needs_attention');
      if (attempt < 2) await persistence.retryAutomation({ jobId }, uid, 'operador');
    }
    await assert.rejects(() => persistence.retryAutomation({ jobId }, uid, 'operador'), { code: 'failed-precondition' });
  });
  await t.test('missing storage input fails job with a sanitized error', async () => {
    const { jobId } = await persistence.createAutomation({ ...base, externalId: randomUUID(), inputImages: [{ ...base.inputImages[0], storagePath: `${inputPath}-missing` }] }, uid, 'operador');
    await worker.processAutomation(jobId);
    const failed = (await db.collection('automationJobs').doc(jobId).get()).data();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'processing-failed');
  });
  await t.test('expired intake leases recover with bounded retries and reject stale writers', async () => {
    const { jobId } = await persistence.createAutomation({ ...base, externalId: randomUUID() }, uid, 'operador');
    const ref = db.collection('automationJobs').doc(jobId);
    for (let retryCount = 0; retryCount < 3; retryCount++) {
      await ref.update({ status: 'importing', leaseToken: 'expired', leaseExpiresAt: admin.firestore.Timestamp.fromMillis(1), retryCount });
      await worker.recoverAutomation();
      assert.equal((await ref.get()).data().status, retryCount === 2 ? 'failed' : 'pending');
    }
    const current = (await ref.get()).data();
    await assert.rejects(() => pipeline.dispatchProduct({ ...current, inputImages: base.inputImages, leaseToken: 'expired' }, { name: 'Test' }, {}), { code: 'aborted' });
    assert.equal((await db.collection('jobs').where('automationJobId', '==', jobId).get()).size, 0);
  });
  await t.test('Firestore rules allow own reads, deny cross-owner reads and all direct writes', async () => {
    const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/automationJobs/${garmentId}`;
    const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url, { headers, method: 'PATCH', body: JSON.stringify({ fields: { status: { stringValue: 'completed' } } }) })).status, 403);
    await db.collection('automationJobs').doc('private-other').set({ createdByUid: 'other' });
    assert.equal((await fetch(url.replace(garmentId, 'private-other'), { headers })).status, 403);
  });
  await t.test('actual product review rejects missing/failed fidelity criteria', async () => {
    const gemini = require('../functions/lib/functions/src/analytics/geminiUsage.js');
    const review = require('../functions/lib/functions/src/review/geminiImageReview.js');
    const original = gemini.callGeminiGenerateContent;
    let criteria: any[] = [];
    gemini.callGeminiGenerateContent = async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'approved', summary: 'Test', criteria }) }] } }] } });
    const request = { apiKey: 'test', model: 'test', generationKind: 'product', requestedPromptBase: 'Clean white background', finalPrompt: 'Product', productReferences: [{ bytes, mimeType: 'image/jpeg' }], generatedImage: { bytes, mimeType: 'image/jpeg' } };
    assert.equal((await review.reviewGeneratedImageWithGemini(request)).verdict, 'rejected');
    criteria = ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts', 'scene'].map((key) => ({ key, label: key, notes: '', passed: true }));
    assert.equal((await review.reviewGeneratedImageWithGemini(request)).verdict, 'approved');
    criteria[2].passed = false;
    assert.equal((await review.reviewGeneratedImageWithGemini(request)).verdict, 'rejected');
    gemini.callGeminiGenerateContent = original;
  });
  let productId: string;
  await t.test('product dispatch shares jobs queue and creates four scenes per product', async () => {
    const result = await http('POST', '/jobs', { ...base, externalId: randomUUID(), jobType: 'product' });
    assert.equal(result.status, 202); productId = result.data.jobId;
    await worker.processAutomation(productId);
    const product = (await db.collection('automationJobs').doc(productId).get()).data();
    assert.equal(product.status, 'processing');
    assert.equal(product.generationJobIds.length, 4);
    await assert.rejects(() => persistence.retryAutomation({ jobId: productId }, uid, 'operador'), { code: 'failed-precondition' });
  });
  await t.test('existing worker persists attempts/costs, bounds review retries and completes approved outputs', async () => {
    const providers = require('../functions/lib/functions/src/providers/index.js');
    const review = require('../functions/lib/functions/src/review/geminiImageReview.js');
    const { File } = require('../functions/node_modules/@google-cloud/storage');
    File.prototype.getSignedUrl = async () => ['https://test.invalid/signed'];
    providers.generateWithProvider = async () => ({ provider: 'fal-nano-banana-2', contentType: 'image/jpeg', imageBytes: bytes, remoteUrl: null, requestId: 'test', responseSummary: {} });
    let approve = false;
    review.reviewGeneratedImageWithGemini = async (request: any) => {
      assert.equal(request.generationKind, 'product');
      assert.equal(request.productReferences.length, 1);
      return { model: 'test', verdict: approve ? 'approved' : 'rejected', summary: 'test', reviewPrompt: 'test', revisedPrompt: 'Preserve exact product and logo', criteria: [], marketplaceData: {} };
    };
    const generation = require('../functions/lib/functions/src/workers/jobWorker.js');
    const product = (await db.collection('automationJobs').doc(productId).get()).data();
    const first = db.collection('jobs').doc(product.generationJobIds[0]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await generation.processJob(first.id, 'create', { skipBacklogSweep: true });
      const current = (await first.get()).data();
      assert.equal(current.status, attempt === 3 ? 'failed' : 'pending', JSON.stringify({ lastError: current.lastError, failure: current.failureInfo }));
      assert.equal(current.generationAttemptCount, attempt);
      assert.ok(current.totalCostUsd > 0);
      assert.match(current.finalPrompt, /exact referenced product/);
    }
    approve = true;
    for (const id of product.generationJobIds.slice(1)) await generation.processJob(id, 'create', { skipBacklogSweep: true });
    let status = await worker.refreshAutomation(productId);
    assert.equal(status.status, 'needs_attention');
    assert.equal(status.outputImages.length, 3);
    const { buildRegenerateJobPatch } = require('../functions/lib/functions/src/callables/regenerateJob.helpers.js');
    await first.update(buildRegenerateJobPatch((await first.get()).data(), 'fal-nano-banana-2', 'Clean studio product photo'));
    await generation.processJob(first.id, 'requeue', { skipBacklogSweep: true });
    status = await worker.refreshAutomation(productId);
    assert.equal(status.status, 'completed'); assert.equal(status.outputImages.length, 4);
    const costBeforeReview = (await first.get()).data().totalCostUsd;
    const retryReview = require('../functions/lib/functions/src/callables/retryJobAutoReview.js').retryJobAutoReview;
    const manualReview = await retryReview.run({ data: { jobId: first.id }, auth: { uid, token: { role: 'operador' } } });
    assert.equal(manualReview.verdict, 'approved');
    assert.equal((await first.get()).data().totalCostUsd, costBeforeReview);
    const response = await http('GET', `/jobs/${productId}`);
    assert.equal(response.status, 200); assert.equal(response.data.outputs.length, 4);
    assert.equal(response.data.pollAfterSeconds, 0); assert.equal(response.data.pollingTimedOut, false);
    assert.equal(response.data.outputs[0].expiresInSeconds, 900);
    assert.equal(response.data.outputs[0].metadata.itemId, 'sku');
    assert.equal(response.data.createdByUid, undefined);
    const privateRef = db.collection('automationJobs').doc('other-job');
    await privateRef.set({ ...status, id: 'other-job', createdByUid: 'other' });
    assert.equal((await http('GET', '/jobs/other-job')).status, 404);
  });
  await t.test('existing provider retry count stops at configured limit', async () => {
    const providers = require('../functions/lib/functions/src/providers/index.js');
    providers.generateWithProvider = async () => { throw new Error('Simulated provider failure'); };
    const { jobId } = await persistence.createAutomation({ ...base, externalId: randomUUID(), jobType: 'product' }, uid, 'operador');
    await worker.processAutomation(jobId);
    const current = (await db.collection('automationJobs').doc(jobId).get()).data();
    const ref = db.collection('jobs').doc(current.generationJobIds[0]);
    const generation = require('../functions/lib/functions/src/workers/jobWorker.js');
    await generation.processJob(ref.id, 'create', { skipBacklogSweep: true });
    assert.equal((await ref.get()).data().status, 'pending');
    await generation.processJob(ref.id, 'requeue', { skipBacklogSweep: true });
    assert.equal((await ref.get()).data().status, 'failed');
    assert.equal((await ref.get()).data().retryCount, 2);
    await generation.processJob(ref.id, 'requeue', { skipBacklogSweep: true });
    assert.equal((await ref.get()).data().retryCount, 2);
  });
  await t.test('duplicate core submission cannot create a second product batch', async () => {
    const current = (await db.collection('automationJobs').doc(productId).get()).data();
    await pipeline.dispatchProduct({ ...current, leaseToken: 'stale' }, { name: 'Test' }, {});
    assert.equal((await db.collection('jobs').where('automationJobId', '==', productId).get()).size, 4);
  });
  await admin.app().delete();
});
