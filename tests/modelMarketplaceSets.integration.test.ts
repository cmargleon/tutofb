import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-model-marketplace-sets';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);

test('server-owned sets: identity, paid single-shot idempotency, failed verification, shared assets, ZIP provenance and stale-byte rejection', { skip: !enabled }, async t => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key]!, /^(127\.0\.0\.1|localhost):/);
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation'; process.env.FAL_KEY = 'test-only'; process.env.GEMINI_API_KEY = 'test-only';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket();
  const sharp = require('../functions/node_modules/sharp');
  const JSZip = require('../functions/node_modules/jszip');
  const service = require('../functions/lib/functions/src/models/marketplaceSets.js');
  const callables = require('../functions/lib/functions/src/callables/modelMarketplaceSets.js');
  const classifier = require('../functions/lib/functions/src/utils/classifyPose.js');
  const generator = require('../functions/lib/functions/src/utils/modelPhotoGeneration.js');
  const uid = 'set-admin', clientId = 'set-client', modelId = 'set-model';
  const auth = { uid, token: { role: 'admin' } };
  const sourcePath = `models/${clientId}/${modelId}/poses/identity.png`;
  const bytes = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: 'white' } }).png().toBuffer();
  await bucket.file(sourcePath).save(bytes, { metadata: { contentType: 'image/png' } });
  await db.doc(`users/${uid}`).set({ role: 'admin', active: true });
  await db.doc(`clients/${clientId}`).set({ name: 'Test', marketplaces: { amazon: { enabled: true }, 'tiktok-shop': { enabled: true }, shein: { enabled: true } } });
  await db.doc(`models/${modelId}`).set({ clientId, name: 'Identity', clientNameSnapshot: 'Test', active: true, status: 'active', identityTraits: { age: '30' }, poses: [{ id: 'identity', storagePath: sourcePath, fileName: 'identity.png', createdAt: null }], poseCount: 1, createdAt: null, updatedAt: null, createdByUid: uid });
  await db.doc('system_config/main').set({ disabledProviders: [] });
  require('../functions/lib/functions/src/admin/systemConfig.js').invalidateSystemConfigCache();
  const { File } = require('../functions/node_modules/@google-cloud/storage');
  t.mock.method(File.prototype, 'getSignedUrl', async () => ['https://fixtures.invalid/base']);
  let generations = 0, failThreeQuarter = true, concretePoseMatches = true;
  t.mock.method(generator, 'generateSingleModelPhoto', async ({ imageConfig, prompt }: any) => {
    generations++; assert.match(prompt, /approved identity reference/); assert.match(prompt, /Plain fitted opaque/);
    const ratio = typeof imageConfig.imageSize === 'object' ? imageConfig.imageSize.width / imageConfig.imageSize.height : .75;
    return { imageBytes: await sharp(bytes).resize(1200, Math.round(1200 / ratio)).png().toBuffer(), contentType: 'image/png' };
  });
  t.mock.method(classifier, 'classifyPoseWithGemini', async ({ pose, identityStoragePath }: any) => {
    assert.equal(identityStoragePath, sourcePath);
    const spec = pose.marketplaceBaseSpec;
    const metadata = await sharp((await bucket.file(pose.storagePath).download())[0]).metadata();
    return { orientationDetail: spec.shot === 'front' ? 'front' : spec.shot === 'commercial_back' ? 'back_three_quarter' : 'front_three_quarter', framing: 'full_body', faceVisible: spec.faceVisible, confidence: 1,
      photoObservation: { pose: failThreeQuarter && spec.shot === 'front_three_quarter' ? 'profile' : spec.shot, orientation: spec.shot === 'commercial_back' ? 'back' : spec.shot === 'front' ? 'front' : 'side', posture: 'standing', audience: 'adult', framing: spec.framing, background: spec.background, garmentVisible: true, accessories: false, performer: 'synthetic', verified: true,
        evidence: 'Simulated visual observation; no quality claim', identityCoherent: true, concretePoseMatches, concretePoseEvidence: 'Simulated concrete pose check', faceVisible: spec.faceVisible, lookingAtCamera: spec.faceVisible, mainPoseCompliant: spec.shot === 'front', whiteRgbVerified: spec.background === 'white', width: metadata.width, height: metadata.height } };
  });
  const baseRequest = { modelId, channels: ['amazon'], category: 'ordinary', bodyArea: 'upper_body', provider: 'fal-gpt-image-2.5-flare' };
  try {
    await assert.rejects(callables.approveModelIdentity.run({ data: { modelId, poseId: 'identity', performer: 'synthetic' }, auth: null }));
    await assert.rejects(callables.approveModelIdentity.run({ data: { modelId, poseId: 'identity', performer: 'synthetic' }, auth: { uid: 'operator', token: { role: 'operador' } } }));
    const noIdentity = await callables.previewModelPhotoSets.run({ data: baseRequest, auth });
    assert.ok(noIdentity.issues.some((i: string) => i.includes('identidad'))); assert.equal(generations, 0);
    await callables.approveModelIdentity.run({ data: { modelId, poseId: 'identity', performer: 'synthetic' }, auth });
    let preview = (await service.loadModelSetContext(baseRequest, uid)).preview;
    assert.equal(preview.shots.length, 3); assert.equal(preview.missing, 3); assert.ok(preview.estimatedCostUsd > 0);
    const request = { ...baseRequest, channel: 'amazon', shot: 'front', requestId: 'front-once', approvedPreviewId: preview.id };
    await assert.rejects(service.generateModelBaseCore({ ...request, approvedPreviewId: 'forged' }, uid), /estimación/);
    assert.equal(generations, 0);
    const front = await service.generateModelBaseCore(request, uid);
    assert.equal(front.approved, true); assert.deepEqual(await service.generateModelBaseCore(request, uid), front); assert.equal(generations, 1);
    preview = (await service.loadModelSetContext(baseRequest, uid)).preview; assert.equal(preview.missing, 2);
    const side = await service.generateModelBaseCore({ ...request, shot: 'front_three_quarter', requestId: 'side-once', approvedPreviewId: preview.id }, uid);
    assert.equal(side.approved, false); assert.match(side.issues.join(' '), /Pose requerida/); assert.equal(generations, 2);
    assert.ok((await db.doc(`models/${modelId}`).get()).get('poses').some((p: any) => p.id === side.poseId));
    failThreeQuarter = false;
    assert.equal((await service.verifyModelBaseCore({ ...baseRequest, channel: 'amazon', shot: 'front_three_quarter', poseId: side.poseId }, uid)).approved, true);
    const shared = await service.verifyModelBaseCore({ ...baseRequest, channel: 'shein', shot: 'front_three_quarter', poseId: side.poseId }, uid);
    assert.equal(shared.approved, true); assert.equal(generations, 2);
    const saved = (await db.doc(`models/${modelId}`).get()).data();
    assert.equal(saved.poses.length, 3); assert.equal(saved.marketplaceBaseApprovals.filter((a: any) => a.poseId === side.poseId).length, 2);
    const square = (await service.loadModelSetContext({ ...baseRequest, channels: ['tiktok-shop'] }, uid)).preview;
    assert.ok(square.shots.every((s: any) => s.spec.aspectRatio === '1:1'));
    const lower = (await service.loadModelSetContext({ ...baseRequest, bodyArea: 'lower_body' }, uid)).preview;
    assert.equal(lower.missing, 3); assert.ok(lower.shots.every((s: any) => !s.spec.faceVisible));
    await db.doc(`models/${modelId}`).update({ 'identityTraits.age': 'child, 8-12 years old' });
    await callables.approveModelIdentity.run({ data: { modelId, poseId: 'identity', performer: 'synthetic' }, auth });
    const child = (await service.loadModelSetContext({ ...baseRequest, channels: ['tiktok-shop'] }, uid)).preview;
    assert.equal(child.shots.length, 0); assert.equal(child.estimatedCostUsd, 0);
    await db.doc(`models/${modelId}`).update({ 'identityTraits.age': '30' });
    await callables.approveModelIdentity.run({ data: { modelId, poseId: 'identity', performer: 'synthetic' }, auth });
    await require('../functions/lib/functions/src/http/downloadModelBundle.js').buildModelBundleDownload(modelId);
    const [archives] = await bucket.getFiles({ prefix: `temp/model_exports/${modelId}-` });
    const archive = (await archives[0].download())[0];
    const manifest = JSON.parse(await (await JSZip.loadAsync(archive)).file('manifest.json').async('text'));
    assert.equal(manifest.marketplaceBaseApprovals.length, 3); assert.equal(manifest.approvedIdentity.poseId, 'identity');
    assert.ok(manifest.poses.find((p: any) => p.id === side.poseId).marketplaceBaseSpec);
    const importPath = `model_imports/${uid}/sets.zip`;
    await bucket.file(importPath).save(archive, { metadata: { contentType: 'application/zip' } });
    const imported = await require('../functions/lib/functions/src/callables/importModelBundle.js').importModelBundle.run({ data: { clientId, storagePath: importPath, originalFileName: 'sets.zip' }, auth });
    const importedModel = (await db.doc(`models/${imported.modelId}`).get()).data();
    assert.equal(importedModel.approvedIdentity, undefined); assert.ok(importedModel.importedIdentity);
    assert.ok(importedModel.marketplaceBaseApprovals.every((a: any) => a.requiresReverification && importedModel.poses.some((p: any) => p.id === a.poseId && p.storagePath === a.storagePath)));
    assert.ok((await service.currentModelPhotoBases(importedModel)).every((b: any) => !b.approvals.length));
    // Concrete selection, four destinations, distinct poses sharing orientation, and safe duplicate/retry requests.
    await db.doc(`clients/${clientId}`).update({ 'marketplaces.mercado-libre': { enabled: true } });
    const concrete = { ...baseRequest, channels: ['amazon', 'tiktok-shop', 'mercado-libre', 'shein'], poseRecipeIds: ['full-front', 'full-front-diagonal', 'full-three-quarter'] };
    const matrix = (await service.loadModelSetContext(concrete, uid)).preview;
    assert.equal(matrix.shots.length, 12); assert.equal(matrix.incompatible.length, 0);
    assert.equal(new Set(matrix.shots.map((s: any) => JSON.stringify(s.spec))).size, 12);
    const blocked = (await service.loadModelSetContext({ ...concrete, poseRecipeIds: ['full-front', 'portrait-profile-left'] }, uid)).preview;
    assert.equal(blocked.shots.length, 4); assert.equal(blocked.incompatible.length, 4);
    assert.equal((await service.loadModelSetContext({ ...concrete, poseRecipeIds: [] }, uid)).preview.missing, 0);
    await assert.rejects(service.loadModelSetContext({ ...concrete, poseRecipeIds: ['forged'] }, uid), /poses concretas/);
    await assert.rejects(service.loadModelSetContext({ ...concrete, poseRecipeIds: ['full-front', 'full-front'] }, uid), /poses concretas/);
    const onePose = { ...baseRequest, bodyArea: 'full_body', poseRecipeIds: ['full-front-diagonal', 'full-three-quarter'] };
    const firstPreview = (await service.loadModelSetContext(onePose, uid)).preview;
    const beforeCount = generations;
    const concreteRequest = { ...onePose, channel: 'amazon', shot: 'front_three_quarter', poseRecipeId: 'full-front-diagonal', requestId: 'concrete-once', approvedPreviewId: firstPreview.id };
    const [one, duplicate] = await Promise.allSettled([
      service.generateModelBaseCore(concreteRequest, uid),
      service.generateModelBaseCore({ ...concreteRequest, requestId: 'concrete-concurrent' }, uid),
    ]);
    assert.equal(generations, beforeCount + 1);
    const approved = [one, duplicate].find((result: any) => result.status === 'fulfilled') as any;
    assert.equal(approved.value.approved, true);
    let next = (await service.loadModelSetContext(onePose, uid)).preview;
    assert.equal(next.missing, 1);
    assert.ok(next.shots.find((s: any) => s.spec.poseRecipeId === 'full-front-diagonal').poseId);
    assert.equal(next.shots.find((s: any) => s.spec.poseRecipeId === 'full-three-quarter').poseId, null);
    const noRepeat = await service.generateModelBaseCore({ ...concreteRequest, requestId: 'approved-different-request', approvedPreviewId: next.id }, uid);
    assert.equal(noRepeat.approved, true); assert.equal(generations, beforeCount + 1);
    const second = await service.generateModelBaseCore({ ...concreteRequest, poseRecipeId: 'full-three-quarter', requestId: 'concrete-second', approvedPreviewId: next.id }, uid);
    assert.equal(second.approved, true);
    const finalModel = (await db.doc(`models/${modelId}`).get()).data();
    assert.equal(finalModel.poses.find((p: any) => p.id === second.poseId).marketplaceBaseSpec.poseRecipeId, 'full-three-quarter');
    assert.equal(finalModel.poses.find((p: any) => p.id === second.poseId).aiClassification.orientationDetail, 'front_three_quarter');
    next = (await service.loadModelSetContext(onePose, uid)).preview;
    assert.equal(next.missing, 0); assert.equal(next.estimatedCostUsd, 0);
    const walkingRequest = { ...baseRequest, bodyArea: 'full_body', poseRecipeIds: ['full-walking'] };
    const walkingPreview = (await service.loadModelSetContext(walkingRequest, uid)).preview;
    concretePoseMatches = false;
    const walking = { ...walkingRequest, channel: 'amazon', shot: 'front_three_quarter', poseRecipeId: 'full-walking', requestId: 'walking-failed', approvedPreviewId: walkingPreview.id };
    const failedWalking = await service.generateModelBaseCore(walking, uid);
    assert.equal(failedWalking.approved, false); assert.match(failedWalking.issues.join(' '), /pose concreta/);
    const failedCount = generations;
    assert.deepEqual(await service.generateModelBaseCore(walking, uid), failedWalking);
    assert.equal(generations, failedCount);
    await assert.rejects(service.generateModelBaseCore({ ...walking, requestId: 'stale-duplicate-walking' }, uid), /estimación/);
    concretePoseMatches = true;
    const walkingRetryPreview = (await service.loadModelSetContext(walkingRequest, uid)).preview;
    const retried = await service.generateModelBaseCore({ ...walking, requestId: 'walking-retry', approvedPreviewId: walkingRetryPreview.id }, uid);
    assert.equal(retried.approved, true); assert.equal(generations, failedCount + 1);
    const retained = (await db.doc(`models/${modelId}`).get()).data();
    assert.ok(retained.poses.some((p: any) => p.id === failedWalking.poseId));
    assert.ok(retained.marketplaceBaseApprovals.some((a: any) => a.poseId === second.poseId));
    assert.equal((await service.loadModelSetContext(onePose, uid)).preview.missing, 0);
    const [beforeConcreteArchives] = await bucket.getFiles({ prefix: `temp/model_exports/${modelId}-` });
    await require('../functions/lib/functions/src/http/downloadModelBundle.js').buildModelBundleDownload(modelId);
    const [afterConcreteArchives] = await bucket.getFiles({ prefix: `temp/model_exports/${modelId}-` });
    const concreteArchive = afterConcreteArchives.find((file: any) => !beforeConcreteArchives.some((before: any) => before.name === file.name));
    const concreteZip = (await concreteArchive.download())[0];
    const concreteManifest = JSON.parse(await (await JSZip.loadAsync(concreteZip)).file('manifest.json').async('text'));
    assert.equal(concreteManifest.poses.find((p: any) => p.id === second.poseId).marketplaceBaseSpec.poseRecipeId, 'full-three-quarter');
    assert.equal(concreteManifest.marketplaceBaseApprovals.find((a: any) => a.poseId === retried.poseId).observation.concretePoseMatches, true);
    const concreteImportPath = `model_imports/${uid}/concrete.zip`;
    await bucket.file(concreteImportPath).save(concreteZip, { metadata: { contentType: 'application/zip' } });
    const concreteImport = await require('../functions/lib/functions/src/callables/importModelBundle.js').importModelBundle.run({ data: { clientId, storagePath: concreteImportPath, originalFileName: 'concrete.zip' }, auth });
    const concreteImported = (await db.doc(`models/${concreteImport.modelId}`).get()).data();
    assert.ok(concreteImported.poses.some((p: any) => p.marketplaceBaseSpec?.poseRecipeId === 'full-three-quarter'));
    assert.ok(concreteImported.marketplaceBaseApprovals.filter((a: any) => a.spec.poseRecipeId).every((a: any) => a.requiresReverification && a.observation.concretePoseMatches));
    const completeFull = { ...baseRequest, bodyArea: 'full_body', poseRecipeIds: ['full-front', 'back-full'] };
    for (const poseRecipeId of completeFull.poseRecipeIds) {
      const scopedPreview = (await service.loadModelSetContext(completeFull, uid)).preview;
      const shot = scopedPreview.shots.find((shot: any) => shot.spec.poseRecipeId === poseRecipeId);
      assert.equal((await service.generateModelBaseCore({ ...completeFull, channel: 'amazon', shot: shot.spec.shot, poseRecipeId, requestId: `match-${poseRecipeId}`, approvedPreviewId: scopedPreview.id }, uid)).approved, true);
    }
    const { manualPhotoAttribute: attr } = require('../functions/lib/shared/src/marketplacePhotoPlan.js');
    const { createCommercialProviderImageConfig } = require('../functions/lib/shared/src/commercialPhoto.js');
    const generationsBeforeGarmentPlan = generations;
    const garmentPlan = await require('../functions/lib/functions/src/callables/createMarketplacePhotoBatch.js').resolveMarketplacePhotoPlan({
      clientId, modelId, selectedChannels: ['amazon'], provider: baseRequest.provider, imageConfig: createCommercialProviderImageConfig(baseRequest.provider), aspectRatio: '3:4',
      // Browser-declared approvals must never provide authorization.
      bases: [{ id: 'forged', storagePath: 'forged', approvals: [{ poseId: 'forged' }] }],
      articles: [{ itemId: 'dress', productId: 'dress', variantId: 'blue', name: 'Dress', kind: 'garment',
        attributes: { category: attr('ordinary'), audience: attr('adult'), bodyArea: attr('full_body'), packaging: attr('unit'), transparency: attr(false), components: attr('dress'), color: attr('blue') },
        references: ['front', 'side', 'back'].map(view => ({ id: view, view, storagePath: `garments/drafts/${uid}/dress-${view}.png` })) }],
    }, uid);
    assert.equal(garmentPlan.tasks.length, 3); assert.equal(generations, generationsBeforeGarmentPlan);
    assert.ok(garmentPlan.tasks.every((task: any) => task.base.approvals[0].spec.poseRecipeId && task.base.id !== 'forged'));
    assert.equal(garmentPlan.tasks.find((task: any) => task.view === 'side').referencePaths.length, 2);
    assert.equal(garmentPlan.tasks.find((task: any) => task.view === 'back').outputPose, 'commercial_back');
    const frontPose = saved.poses.find((p: any) => p.id === front.poseId);
    await bucket.file(frontPose.storagePath).save(bytes, { metadata: { contentType: 'image/png' } });
    const stale = await service.currentModelPhotoBases((await db.doc(`models/${modelId}`).get()).data());
    assert.equal(stale.find((b: any) => b.id === front.poseId).approvals.length, 0);
    await db.doc(`clients/${clientId}`).update({ automation: { defaultPreset: 'generic_product', presets: { standard: { provider: 'fal-banana-pro', aspectRatio: '4:3' } } } });
    const configured = (await service.loadModelSetContext({ ...baseRequest, provider: undefined }, uid)).preview;
    assert.equal(configured.provider, 'fal-banana-pro');
    assert.ok(configured.shots.every((shot: any) => shot.spec.aspectRatio === '4:3'));
    const explicit = (await service.loadModelSetContext({ ...baseRequest, provider: 'fal-gpt-image-2.5-flare', aspectRatio: '3:4' }, uid)).preview;
    assert.equal(explicit.provider, 'fal-gpt-image-2.5-flare');
    assert.ok(explicit.shots.every((shot: any) => shot.spec.aspectRatio === '3:4'));
    // Exercise deployed rules on the default emulator database, where Storage's cross-service checks run.
    const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `sets-${Date.now()}@example.test`, password: 'emulator-password', returnSecureToken: true }),
    });
    const account = await signup.json() as any;
    assert.ok(account.idToken);
    const rulesDb = admin.firestore();
    const rulesUser = rulesDb.doc(`users/${account.localId}`), rulesModel = rulesDb.doc(`models/rules-${account.localId}`);
    await rulesUser.set({ role: 'admin', active: true }); await rulesModel.set({ clientId, name: 'Rules fixture' });
    const rulesAsset = `models/${clientId}/${rulesModel.id}/poses/immutable.png`;
    await bucket.file(rulesAsset).save(bytes, { metadata: { contentType: 'image/png' } });
    try {
      const headers = { Authorization: `Bearer ${account.idToken}`, 'Content-Type': 'application/json' };
      const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents/models/${rulesModel.id}`;
      assert.equal((await fetch(`${url}?updateMask.fieldPaths=name`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { name: { stringValue: 'Permitted edit' } } }) })).status, 200);
      for (const field of ['approvedIdentity', 'marketplaceBaseApprovals']) {
        const fields = { [field]: field === 'approvedIdentity' ? { mapValue: { fields: {} } } : { arrayValue: { values: [] } } };
        assert.equal((await fetch(`${url}?updateMask.fieldPaths=${field}`, { method: 'PATCH', headers, body: JSON.stringify({ fields }) })).status, 403);
      }
      const overwrite = await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o?uploadType=media&name=${encodeURIComponent(rulesAsset)}`, { method: 'POST', headers: { Authorization: `Firebase ${account.idToken}`, 'Content-Type': 'image/png' }, body: bytes });
      assert.equal(overwrite.status, 403, await overwrite.text());
    } finally { await rulesModel.delete(); await rulesUser.delete(); await admin.auth().deleteUser(account.localId); await bucket.file(rulesAsset).delete(); }
    await db.doc(`models/${modelId}`).update({ clientId: 'another-client' });
    await assert.rejects(require('../functions/lib/functions/src/callables/createMarketplacePhotoBatch.js').resolveMarketplacePhotoPlan({ clientId, modelId, articles: [{ kind: 'garment' }], provider: 'fal-gpt-image-2.5-flare' }, uid), /este cliente/);
  } finally { await cleanupEmulatorDatabase(db); }
});
