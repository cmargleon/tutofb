import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const local = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST].every(value => /^(127\.0\.0\.1|localhost):\d+$/.test(value ?? ''));

test('marketplaces persist independently and client rules reject browser writes even for admins (local emulators)', { skip: !local }, async t => {
  const admin = require('../functions/node_modules/firebase-admin');
  const projectId = process.env.GCLOUD_PROJECT || 'demo-clients-redesign';
  const app = admin.initializeApp({ projectId }); const db = admin.firestore();
  const { saveClientMarketplace } = require('../functions/lib/functions/src/callables/updateClientMarketplace.js');
  const clientId = 'marketplace-fixture';
  try {
    await db.collection('clients').doc(clientId).set({ name: 'Emulator fixture', status: 'active', automation: { enabled: false } });
    await Promise.all([
      saveClientMarketplace({ clientId, marketplaceId: 'amazon', enabled: true }, db),
      saveClientMarketplace({ clientId, marketplaceId: 'shein', settings: { region: 'MX' } }, db),
      saveClientMarketplace({ clientId, marketplaceId: 'mercado-libre', settings: { sellerId: 'seller' } }, db),
      saveClientMarketplace({ clientId, marketplaceId: 'tiktok-shop', enabled: true }, db),
    ]);
    const saved = (await db.collection('clients').doc(clientId).get()).data();
    assert.equal(saved.marketplaces.amazon.enabled, true);
    assert.equal(saved.marketplaces.shein.enabled, false);
    assert.equal(saved.marketplaces.shein.settings.region, 'MX');
    assert.equal(saved.marketplaces['mercado-libre'].enabled, false);
    assert.equal(saved.marketplaces['mercado-libre'].settings.sellerId, 'seller');
    assert.equal(saved.marketplaces['tiktok-shop'].enabled, true);
    assert.deepEqual(saved.automation, { enabled: false });
    const { saveClientAutomation } = require('../functions/lib/functions/src/automation/clientConfig.js');
    const { googleDrive } = require('../functions/lib/functions/src/automation/drive.js');
    t.mock.method(googleDrive, 'metadata', async () => ({ mimeType: 'application/vnd.google-apps.folder' }));
    const clientRef = db.collection('clients').doc(clientId);
    await clientRef.update({ 'automation.defaultBudgetUsd': 8 });
    const sources = await saveClientAutomation({ clientId, section: 'sources', expectedAutomation: { enabled: false }, automation: { driveFolderIds: ['folder-a'] } }, db);
    assert.deepEqual(sources, { enabled: false, defaultBudgetUsd: 8, driveFolderIds: ['folder-a'] });
    await clientRef.update({ 'automation.driveFolderIds': ['folder-b'] });
    const automation = await saveClientAutomation({ clientId, section: 'automation', expectedAutomation: sources, automation: { enabled: false, defaultBudgetUsd: 6 } }, db);
    assert.deepEqual(automation.driveFolderIds, ['folder-b']);
    assert.equal(automation.defaultBudgetUsd, 6);
    await db.collection('organizers').doc(clientId).set({ sourceIds: ['folder-b'] });
    await assert.rejects(() => saveClientAutomation({ clientId, section: 'sources', automation: { driveFolderIds: [] } }, db), { code: 'failed-precondition' });

    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'marketplace@example.test', password: 'emulator-only-password', returnSecureToken: true }) });
    const { localId: uid } = await response.json() as any;
    await admin.auth().setCustomUserClaims(uid, { role: 'admin' });
    const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'marketplace@example.test', password: 'emulator-only-password', returnSecureToken: true }) });
    const { idToken } = await signIn.json() as any;
    assert.ok(uid); assert.ok(idToken);
    await db.collection('users').doc(uid).set({ active: true, role: 'admin' });
    const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/clients`;
    const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    const get = await fetch(`${endpoint}/${clientId}`, { headers }); assert.equal(get.status, 200);
    for (const field of ['marketplaces', 'automation']) {
      const result = await fetch(`${endpoint}/${clientId}?updateMask.fieldPaths=${field}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { [field]: { mapValue: { fields: {} } } } }) });
      assert.equal(result.status, 403);
      const create = await fetch(`${endpoint}?documentId=forbidden-${field}`, { method: 'POST', headers, body: JSON.stringify({ fields: { name: { stringValue: 'Invalid' }, [field]: { mapValue: { fields: {} } } } }) });
      assert.equal(create.status, 403);
    }
    const allowedName = await fetch(`${endpoint}/${clientId}?updateMask.fieldPaths=name`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { name: { stringValue: 'Updated emulator fixture' } } }) });
    assert.equal(allowedName.status, 200);
    await db.collection('users').doc(uid).update({ role: 'operador' });
    await admin.auth().setCustomUserClaims(uid, { role: 'operador' });
    const operator = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'marketplace@example.test', password: 'emulator-only-password', returnSecureToken: true }) });
    headers.Authorization = `Bearer ${(await operator.json() as any).idToken}`;
    // Read access follows existing canReview rules; privileged writes remain denied.
    const denied = await fetch(`${endpoint}/${clientId}?updateMask.fieldPaths=marketplaces`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { marketplaces: { mapValue: { fields: {} } } } }) });
    assert.equal(denied.status, 403);
    assert.equal((await db.collection('jobs').get()).size, 0);
  } finally { await app.delete(); }
});
