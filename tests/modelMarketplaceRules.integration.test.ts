import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
process.env.FIRESTORE_DATABASE_ID = 'test-model-marketplace-rules';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('real transactions persist rules per marketplace, reject concurrent stale saves, and drive model previews without paid calls', { skip: !enabled }, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const service = require('../functions/lib/functions/src/models/marketplaceRules.js');
  const { defaultModelMarketplaceRule } = require('../functions/lib/shared/src/modelMarketplaceRules.js');
  const { loadModelSetContext } = require('../functions/lib/functions/src/models/marketplaceSets.js');
  const user = { uid: 'rules-admin', token: {} };
  try {
    await db.doc('users/rules-admin').set({ active: true, role: 'admin' });
    await db.doc('users/rules-operator').set({ active: true, role: 'operador' });
    const rule = defaultModelMarketplaceRule('amazon');
    rule.aspectRatio = '4:3'; rule.main.background = 'neutral'; rule.main.lookingAtCamera = false;
    const data = { marketplaceId: 'amazon', expectedRevision: 0, rule };
    await assert.rejects(service.saveModelMarketplaceRule.run({ data, auth: { uid: 'rules-operator', token: { role: 'admin' } } }), { code: 'permission-denied' });
    const outcomes = await Promise.allSettled([
      service.saveModelMarketplaceRule.run({ data, auth: user }), service.saveModelMarketplaceRule.run({ data, auth: user }),
    ]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(o => o.status === 'rejected' && o.reason.code === 'aborted').length, 1);
    await service.saveModelMarketplaceRule.run({ data: { marketplaceId: 'shein', expectedRevision: 0, rule: defaultModelMarketplaceRule('shein') }, auth: user });
    const stored = await service.getModelMarketplaceRules();
    assert.equal(stored.amazon.aspectRatio, '4:3'); assert.equal(stored.shein.revision, 1);
    await db.doc('clients/rules-client').set({ status: 'active', marketplaces: { amazon: { enabled: true }, shein: { enabled: true } } });
    await db.doc('models/rules-model').set({ clientId: 'rules-client', name: 'Test', active: true, poses: [], identityTraits: { age: '30' } });
    const input = { modelId: 'rules-model', category: 'ordinary', bodyArea: 'upper_body', channels: ['amazon'] };
    const preview = (await loadModelSetContext(input, user.uid)).preview;
    assert.equal(preview.shots.length, 3);
    assert.equal(preview.shots[0].spec.aspectRatio, '4:3'); assert.equal(preview.shots[0].spec.background, 'neutral');
    assert.equal(preview.shots[0].spec.lookingAtCamera, false); assert.equal(preview.shots[0].spec.rulesRevision, 1);
    assert.ok(preview.issues.some((issue: string) => /identidad/.test(issue)));
    rule.shots = ['front'];
    await service.saveModelMarketplaceRule.run({ data: { ...data, expectedRevision: 1, rule }, auth: user });
    const next = (await loadModelSetContext(input, user.uid)).preview;
    assert.equal(next.shots.length, 1); assert.equal(next.shots[0].spec.rulesRevision, 2); assert.notEqual(preview.id, next.id);
    assert.equal((await db.collection('model_generation_logs').get()).size, 0);
  } finally { await cleanupEmulatorDatabase(db); }
});
