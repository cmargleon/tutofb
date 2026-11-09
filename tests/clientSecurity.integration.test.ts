import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? ''));

test('current human permissions, direct Firebase access, transaction conflicts and server pagination', { skip: !enabled }, async t => {
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_DATABASE_ID = '(default)';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const uid = `security-${randomUUID()}`;
  const clientA = `${uid}-a`, clientB = `${uid}-b`;
  const userRef = db.collection('users').doc(uid);
  const { saveClientMarketplace, updateClientMarketplace } = require('../functions/lib/functions/src/callables/updateClientMarketplace.js');
  const { saveClientService, saveClient } = require('../functions/lib/functions/src/manglar/catalogService.js');
  const { listClientsPage } = require('../functions/lib/functions/src/callables/listClients.js');
  const express = require('../functions/node_modules/express');
  const serverApp = express(); serverApp.use(express.json());
  serverApp.post('/marketplace', updateClientMarketplace); serverApp.post('/client', saveClient);
  const { publicGeneratedImage } = require('../functions/lib/functions/src/http/publicGeneratedImage.js');
  serverApp.use('/image', publicGeneratedImage);
  const server = serverApp.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const rest = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents`;
  const files: string[] = [];
  const clientAssets = (id: string) => [
    `models/${id}/${id}/poses/upload.jpg`,
    `model_generations/${id}/legacy/image.jpg`,
    `model_generations/${id}/${id}/identity/session/image.jpg`,
    `model_generations/${id}/${id}/pose/session/image.jpg`,
    `client_spreadsheets/${id}/template/source.xlsx`,
    `client_spreadsheet_exports/${id}/${id}/export.xlsx`,
  ];
  const ownDrafts = [
    `garments/drafts/${uid}/draft/photo.jpg`,
    `garments/drafts/${uid}/draft/item/photo.jpg`,
    `wizard_source_spreadsheets/${uid}/upload/source.xlsx`,
  ];
  const setUser = (patch = {}) => userRef.set({ uid, role: 'admin', active: true, status: 'active', ...patch });
  let token: string;
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const get = (path: string) => fetch(`${rest}/${path}`, { headers: headers() });
  const patch = (path: string, field: string, value: object) => fetch(`${rest}/${path}?updateMask.fieldPaths=${field}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ fields: { [field]: value } }) });
  const post = (path: string, data: object) => fetch(`${base}/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify({ data }) });
  const asset = (path: string, authenticated = true) => fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(path)}?alt=media`, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
  try {
    await admin.auth().createUser({ uid, email: `${uid}@example.test`, password: 'emulator-password' });
    await admin.auth().setCustomUserClaims(uid, { role: 'admin', active: true });
    const signin = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password: 'emulator-password', returnSecureToken: true }) });
    token = (await signin.json() as any).idToken; assert.ok(token);
    await setUser();
    for (const id of [clientA, clientB]) {
      await db.collection('clients').doc(id).set({ name: id, status: 'active', generationPromptBase: 'original', marketplaces: { amazon: { enabled: false, settings: { region: 'MX', sellerId: 'seller-old' }, future: 'keep' }, shein: { enabled: true } }, automation: { enabled: false } });
      await db.collection('jobs').doc(id).set({ clientId: id, batchId: id });
      await db.collection('batches').doc(id).set({ clientId: id });
      await db.collection('models').doc(id).set({ clientId: id });
      await db.collection('clients').doc(id).collection('spreadsheetTemplates').doc('template').set({ clientId: id });
      await db.collection('batches').doc(id).collection('productDrafts').doc('product').set({ name: 'Product' });
      const path = `generated/${id}/${id}/${id}/image.jpg`; files.push(path);
      await admin.storage().bucket().file(path).save(Buffer.from('emulator-fixture'), { metadata: { contentType: 'image/jpeg' } });
      for (const assetPath of clientAssets(id)) {
        files.push(assetPath);
        await admin.storage().bucket().file(assetPath).save(Buffer.from('emulator-fixture'));
      }
    }
    for (const path of ownDrafts) {
      files.push(path);
      await admin.storage().bucket().file(path).save(Buffer.from('emulator-fixture'));
    }
    await t.test('old admin token cannot edit clients or restore its role after demotion', async () => {
      assert.equal((await get(`clients/${clientA}`)).status, 200);
      assert.equal((await patch(`clients/${clientA}`, 'note', { stringValue: 'legitimate' })).status, 200);
      assert.equal((await asset(files[0])).status, 200);
      await setUser({ role: 'revisor', clientAccess: { mode: 'assigned', clientIds: [clientA] } });
      assert.equal((await patch(`clients/${clientA}`, 'note', { stringValue: 'forbidden' })).status, 403);
      assert.equal((await patch(`users/${uid}`, 'role', { stringValue: 'admin' })).status, 403);
      const response = await post('marketplace', { clientId: clientA, marketplaceId: 'amazon', enabled: true, expected: { enabled: false } });
      assert.equal(response.status, 403);
      assert.equal((await post('client', { id: clientA, name: 'forbidden', expected: { name: clientA } })).status, 403);
    });
    await t.test('assigned A can read A but cannot forge B IDs, nested paths, queries or image routes', async () => {
      for (const [collection, suffix] of [['clients',''], ['jobs',''], ['models',''], ['batches',''], ['clients','/spreadsheetTemplates/template'], ['batches','/productDrafts/product']]) {
        assert.equal((await get(`${collection}/${clientA}${suffix}`)).status, 200, `A ${collection}${suffix}`);
        assert.equal((await get(`${collection}/${clientB}${suffix}`)).status, 403, `B ${collection}${suffix}`);
      }
      assert.equal((await asset(files[0])).status, 200);
      assert.equal((await asset(`generated/${clientB}/${clientB}/${clientB}/image.jpg`)).status, 403);
      for (const path of clientAssets(clientA)) assert.equal((await asset(path)).status, 200, path);
      for (const path of clientAssets(clientB)) assert.equal((await asset(path)).status, 403, path);
      for (const path of ownDrafts) assert.equal((await asset(path)).status, 200, path);
      assert.equal((await asset(files[0], false)).status, 403);
      assert.equal((await fetch(`${base}/image/${files[0]}`, { headers: headers() })).status, 200);
      assert.equal((await fetch(`${base}/image/generated/${clientB}/${clientB}/${clientB}/image.jpg`, { headers: headers() })).status, 403);
      assert.equal((await fetch(`${base}/image/${files[0]}`)).status, 401);
      const { selectJobOutput } = require('../functions/lib/functions/src/callables/selectJobOutput.js');
      await assert.rejects(() => selectJobOutput.run({ auth: { uid, token: { role: 'admin' } }, data: { clientId: clientA, jobId: clientB, outputId: 'x' } }), { code: 'permission-denied' });
      const query = await fetch(`${rest}:runQuery`, { method: 'POST', headers: headers(), body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'jobs' }] } }) });
      assert.equal(query.status, 403);
      const scoped = await fetch(`${rest}:runQuery`, { method: 'POST', headers: headers(), body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'jobs' }], where: { fieldFilter: { field: { fieldPath: 'clientId' }, op: 'EQUAL', value: { stringValue: clientA } } } } }) });
      assert.equal(scoped.status, 200);
      assert.equal((await patch(`jobs/${clientA}`, 'userSelectedOutputId', { stringValue: 'legitimate-output' })).status, 200);
      assert.equal((await patch(`jobs/${clientB}`, 'userSelectedOutputId', { stringValue: 'forbidden-output' })).status, 403);
    });
    await t.test('disabled, archived, missing and newly unassigned users cannot continue with their old token', async () => {
      for (const state of [{ active: false }, { status: 'archived' }, { role: 'operador' }, null]) {
        if (state) await setUser(state); else await userRef.delete();
        assert.equal((await get(`clients/${clientA}`)).status, 403);
        assert.equal((await asset(files[0])).status, 403);
        for (const path of clientAssets(clientA)) assert.equal((await asset(path)).status, 403, path);
        if (state?.role !== 'operador') for (const path of ownDrafts) assert.equal((await asset(path)).status, 403, path);
        assert.equal((await patch(`users/${uid}`, 'role', { stringValue: 'admin' })).status, 403);
        assert.equal((await post('marketplace', { clientId: clientA, marketplaceId: 'amazon', enabled: true, expected: { enabled: false } })).status, 403);
      }
      await setUser();
    });
    await t.test('different fields merge, same-field conflicts abort and metadata survives transaction retries', async () => {
      await Promise.all([
        saveClientMarketplace({ clientId: clientA, marketplaceId: 'amazon', settings: { region: 'US' }, expected: { region: 'MX' } }),
        saveClientMarketplace({ clientId: clientA, marketplaceId: 'amazon', settings: { sellerId: 'seller-new' }, expected: { sellerId: 'seller-old' } }),
      ]);
      const saved = (await db.collection('clients').doc(clientA).get()).data();
      assert.deepEqual(saved.marketplaces.amazon.settings, { region: 'US', sellerId: 'seller-new' });
      assert.equal(saved.marketplaces.amazon.future, 'keep'); assert.equal(saved.marketplaces.shein.enabled, true);
      const results = await Promise.allSettled(['CA', 'FR'].map(region => saveClientMarketplace({ clientId: clientA, marketplaceId: 'amazon', settings: { region }, expected: { region: 'US' } })));
      assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal((results.find(item => item.status === 'rejected') as PromiseRejectedResult).reason.code, 'aborted');
      await assert.rejects(() => saveClientMarketplace({ clientId: clientA, marketplaceId: 'amazon', settings: { region: 'XX' } }), { code: 'aborted' });
      await Promise.all([saveClientService({ id: clientA, name: 'new name', expected: { name: clientA } }, uid), saveClientService({ id: clientA, generationPromptBase: 'new prompt', expected: { generationPromptBase: 'original' } }, uid)]);
      const client = (await db.collection('clients').doc(clientA).get()).data(); assert.equal(client.name, 'new name'); assert.equal(client.generationPromptBase, 'new prompt');
      await assert.rejects(() => saveClientService({ id: clientA, name: 'stale', expected: { name: clientA } }, uid), { code: 'aborted' });
      await assert.rejects(() => saveClientService({ id: clientA, generationPromptBase: 'stale', expected: { generationPromptBase: 'original' } }, uid), { code: 'aborted' });
    });
    await t.test('administrators assign scope explicitly and stale administrative sessions cannot change it', async () => {
      const target = db.collection('users').doc(`${uid}-target`);
      const { setUserClientAccess } = require('../functions/lib/functions/src/callables/setUserClientAccess.js');
      const assigned = { mode: 'assigned', clientIds: [clientA] };
      const request = { auth: { uid, token: { role: 'admin' } }, data: { uid: target.id, clientAccess: assigned, expected: null } };
      await target.set({ uid: target.id, active: true, role: 'operador' });
      try {
        await setUserClientAccess.run(request);
        assert.deepEqual((await target.get()).data().clientAccess, assigned);
        await assert.rejects(() => setUserClientAccess.run(request), { code: 'aborted' });
        await setUserClientAccess.run({ ...request, data: { uid: target.id, clientAccess: { mode: 'global' }, expected: assigned } });
        await setUser({ role: 'revisor', clientAccess: { mode: 'global' } });
        await assert.rejects(() => setUserClientAccess.run({ ...request, data: { ...request.data, expected: { mode: 'global' } } }), { code: 'permission-denied' });
      } finally { await setUser(); await target.delete(); }
    });
    await t.test('45 clients paginate at the server; substring and combined status filters find beyond page one', async () => {
      const ids = Array.from({ length: 45 }, (_, i) => `${uid}-page-${String(i).padStart(2, '0')}`);
      await Promise.all(ids.map((id, i) => db.collection('clients').doc(id).set({ name: `Search-${uid}-Client ${i}`, status: i === 44 ? 'archived' : 'active' })));
      const prototype = Object.getPrototypeOf(db.collection('clients').orderBy('name'));
      const originalGet = prototype.get;
      let reads = 0;
      prototype.get = async function (...args: unknown[]) { const snapshot = await originalGet.apply(this, args); reads++; assert.ok(snapshot.size <= 20, 'Each list query must stay bounded'); return snapshot; };
      try {
      const first = await listClientsPage({}, ids); assert.equal(first.clients.length, 20); assert.equal(first.hasMore, true);
      const second = await listClientsPage({ page: 2 }, ids); assert.equal(second.clients.length, 20); assert.equal(second.page, 2);
      const third = await listClientsPage({ page: 3 }, ids); assert.equal(third.clients.length, 4); assert.equal(third.hasMore, false);
      assert.equal((await listClientsPage({ search: 'Client 43' }, ids)).clients[0].id, ids[43]);
      assert.equal((await listClientsPage({ search: 'ient 44', status: 'archived', showArchived: true }, ids)).clients[0].id, ids[44]);
      assert.equal((await listClientsPage({ search: 'ient 44' }, ids)).clients.length, 0);
      assert.equal((await listClientsPage({ page: 99 }, ids)).page, 3);
      assert.equal((await listClientsPage({}, [])).clients.length, 0);
      assert.ok(reads > 3);
      } finally { prototype.get = originalGet; }
      await Promise.all(ids.map(id => db.collection('clients').doc(id).delete()));
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const collection of ['clients','jobs','batches','models']) for (const id of [clientA, clientB]) await db.recursiveDelete(db.collection(collection).doc(id));
    await userRef.delete(); await admin.auth().deleteUser(uid);
    await Promise.all(files.map(path => admin.storage().bucket().file(path).delete()));
    await app.delete();
  }
});
