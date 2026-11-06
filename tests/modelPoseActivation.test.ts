import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const firestore = require('../functions/lib/functions/src/firebase/appFirestore.js');
const { setModelPoseActive } = require('../functions/lib/functions/src/callables/setModelPoseActive.js');

test('pose activation enforces admin permissions, validates input, and preserves pose assets and other poses', async (t) => {
  let model: any = {
    name: 'Modelo', status: 'active', poseCount: 2,
    poses: [
      { id: 'pose', storagePath: 'pose.jpg', fileName: 'pose.jpg', aiClassification: { confidence: 0.99 } },
      { id: 'other', storagePath: 'other.jpg', active: false },
    ],
  };
  const ref = { id: 'model' };
  let writes = 0;
  t.mock.method(firestore, 'getAppFirestore', () => ({
    collection: (name: string) => ({ doc: (uid: string) => name === 'users'
      ? { get: async () => ({ exists: true, data: () => ({ active: true, role: uid === 'admin' ? 'admin' : 'revisor' }) }) }
      : ref }),
    runTransaction: async (callback: any) => callback({
      get: async () => ({ exists: Boolean(model), data: () => model }),
      update: (_ref: any, data: any) => { model = { ...model, ...data }; writes++; },
    }),
  }));
  const data = { modelId: 'model', poseId: 'pose', active: false };
  const auth = { uid: 'admin', token: { role: 'admin' } };
  await assert.rejects(() => setModelPoseActive.run({ data }), { code: 'unauthenticated' });
  for (const role of ['operador', 'revisor']) {
    await assert.rejects(() => setModelPoseActive.run({ data, auth: { uid: 'user', token: { role } } }), { code: 'permission-denied' });
  }
  for (const patch of [{ active: 'false' }, { active: null }, { modelId: '../model' }, { poseId: '' }]) {
    await assert.rejects(() => setModelPoseActive.run({ data: { ...data, ...patch }, auth }), { code: 'invalid-argument' });
  }
  await assert.rejects(() => setModelPoseActive.run({ data: { ...data, poseId: 'missing' }, auth }), { code: 'not-found' });
  model.status = 'archived';
  await assert.rejects(() => setModelPoseActive.run({ data, auth }), { code: 'failed-precondition' });
  model.status = 'active';
  assert.equal(writes, 0);

  const before = structuredClone(model);
  assert.deepEqual(await setModelPoseActive.run({ data, auth }), { success: true, ...data });
  assert.deepEqual(model.poses[0], { ...before.poses[0], active: false });
  assert.deepEqual(model.poses[1], before.poses[1]);
  assert.equal(model.poseCount, before.poseCount);
  await setModelPoseActive.run({ data: { ...data, active: true }, auth });
  assert.equal(model.poses[0].active, true);
  model = undefined;
  await assert.rejects(() => setModelPoseActive.run({ data, auth }), { code: 'not-found' });
});

test('background pose classification preserves activation and catalog edits made during analysis', async (t) => {
  const classifier = require('../functions/lib/functions/src/utils/classifyPose.js');
  const { onModelWrite } = require('../functions/lib/functions/src/triggers/onModelWrite.js');
  const initial = { id: 'pose', storagePath: 'pose.jpg', fileName: 'pose.jpg' };
  let current: any = { poses: [initial, { id: 'removed', storagePath: 'removed.jpg' }] };
  const ref = {};
  t.mock.method(classifier, 'classifyPoseWithGemini', async () => {
    current = { poses: [{ ...initial, active: false }, { id: 'added', storagePath: 'added.jpg', active: true }] };
    return { orientationDetail: 'front', framing: 'full_body', faceVisible: true, confidence: 0.99 };
  });
  t.mock.method(firestore, 'getAppFirestore', () => ({
    collection: () => ({ doc: () => ref }),
    runTransaction: async (callback: any) => callback({
      get: async () => ({ data: () => current }),
      update: (_ref: any, data: any) => { current = { ...current, ...data }; },
    }),
  }));
  await onModelWrite.run({ params: { modelId: 'model' }, data: { after: { exists: true, data: () => ({ name: 'Modelo', poses: [initial, { id: 'removed', storagePath: 'removed.jpg' }] }) } } });
  assert.equal(current.poses[0].active, false);
  assert.equal(current.poses[0].aiClassification.orientationDetail, 'front');
  assert.deepEqual(current.poses.map((pose: any) => pose.id), ['pose', 'added']);
  assert.equal(current.poses[1].active, true);
  assert.equal(current.poses[1].aiClassification, undefined);
});

const emulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);
test('MCP discovers and changes pose activation with idempotency, role and client restrictions', { skip: !emulators }, async (t) => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'demo-manglar-automation', storageBucket: 'demo-manglar-automation.appspot.com' });
  const db = firestore.getAppFirestore();
  const { executeManglarTool } = require('../functions/lib/functions/src/automation/mcp.js');
  const filePrototype = Object.getPrototypeOf(admin.storage().bucket().file('fixture'));
  t.mock.method(filePrototype, 'getSignedUrl', async () => ['http://localhost:9199/test-preview']);
  await db.collection('users').doc('pose-admin').set({ role: 'admin', active: true, status: 'active' });
  await db.collection('manglarAccess').doc('pose-admin').set({ enabled: true, clientIds: ['pose-client'], version: 1 });
  const caller = { uid: 'pose-admin', role: 'admin', connectionId: 'pose-connection', allowedClientIds: ['pose-client'], accessVersion: 1, scopes: ['jobs:read', 'jobs:create'] };
  const ref = db.collection('models').doc('pose-model');
  const poses = [{ id: 'legacy', storagePath: 'legacy.jpg' }, { id: 'inactive', active: false, storagePath: 'inactive.jpg' }];
  await ref.set({ clientId: 'pose-client', name: 'Modelo', status: 'active', poses, poseCount: 2 });
  const describe = await executeManglarTool('manglar_describe', { domain: 'models', action: 'setPoseActive' }, caller);
  assert.ok(describe.operations[0].inputSchema.required.includes('active'));
  const read = await executeManglarTool('manglar_models', { action: 'get', data: { id: ref.id } }, caller);
  assert.deepEqual(read.poses.map((pose: any) => pose.active), [true, false]);
  const args = { action: 'setPoseActive', data: { modelId: ref.id, poseId: 'legacy', active: false }, idempotencyKey: 'pose-off-once' };
  const result = await executeManglarTool('manglar_models', args, caller);
  assert.equal(result.active, false);
  assert.deepEqual(await executeManglarTool('manglar_models', args, caller), result);
  assert.deepEqual((await ref.get()).data().poses, [{ ...poses[0], active: false }, poses[1]]);
  await executeManglarTool('manglar_models', { ...args, data: { ...args.data, active: true }, idempotencyKey: 'pose-on-once' }, caller);
  assert.equal((await ref.get()).data().poses[0].active, true);
  await assert.rejects(() => executeManglarTool('manglar_models', { ...args, data: { ...args.data, active: 'false' } }, caller), { code: 'invalid-argument' });
  for (const role of ['operador', 'revisor']) {
    const uid = `pose-${role}`;
    await db.collection('users').doc(uid).set({ role, active: true, status: 'active' });
    await db.collection('manglarAccess').doc(uid).set({ enabled: true, clientIds: ['pose-client'], version: 1 });
    await assert.rejects(() => executeManglarTool('manglar_models', args, { ...caller, uid, role }), { code: 'permission-denied' });
  }
  await db.collection('models').doc('pose-foreign').set({ clientId: 'foreign-client', status: 'active', poses });
  await assert.rejects(() => executeManglarTool('manglar_models', { ...args, data: { ...args.data, modelId: 'pose-foreign' }, idempotencyKey: 'pose-foreign' }, caller), { code: 'permission-denied' });
  await admin.app().delete();
});
