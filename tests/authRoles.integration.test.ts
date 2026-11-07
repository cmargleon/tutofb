import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

test('privileged human authorization uses current users in the configured database (emulators only)', { skip: !enabled }, async (t) => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
    assert.match(process.env[key]!, /^(127\.0\.0\.1|localhost):\d+$/);
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_DATABASE_ID = 'auth-users';
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const defaultDb = admin.firestore();
  const roles = require('../functions/lib/functions/src/auth/roles.js');
  const { withManglarContext } = require('../functions/lib/functions/src/manglar/context.js');
  const { authorizeManglarInput } = require('../functions/lib/functions/src/manglar/access.js');
  const api = require('../functions/lib/functions/src/automation/api.js');
  const { getSystemConfig } = require('../functions/lib/functions/src/callables/getSystemConfig.js');
  const { syncUserClaims } = require('../functions/lib/functions/src/callables/syncUserClaims.js');
  const express = require('../functions/node_modules/express');
  const app = express();
  app.use(express.json());
  for (const name of ['downloadModelBundle', 'downloadJobImage', 'downloadBatchZip', 'downloadSelectedJobsZip'])
    app.post(`/${name}`, require(`../functions/lib/functions/src/http/${name}.js`)[name]);
  app.post('/getSystemConfig', getSystemConfig);
  app.use('/automation', api.automationHttpHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(String(url)).hostname), `External request: ${url}`);
    return nativeFetch(url, options);
  }) as typeof fetch;
  const uid = `stale-admin-${randomUUID()}`;
  const ref = db.collection('users').doc(uid);
  const request = { auth: { uid, token: { role: 'admin' } }, data: {} };
  const setUser = (data: object) => ref.set({ role: 'admin', active: true, status: 'active', clientAccess: { mode: 'global' }, ...data });
  const post = async (path: string, token?: string) => {
    const response = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(path === 'getSystemConfig' ? { data: {} } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const proto = Object.getPrototypeOf(ref);
  const originalGet = proto.get;
  let reads = 0;
  proto.get = function (...args: any[]) { if (this.parent.path === 'users') reads++; return originalGet.apply(this, args); };
  try {
    // An actual emulator-issued admin token remains unchanged through all document transitions.
    await admin.auth().createUser({ uid, email: `${uid}@example.test`, password: 'emulator-password' });
    await admin.auth().setCustomUserClaims(uid, { role: 'admin', active: true });
    const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password: 'emulator-password', returnSecureToken: true }) });
    const { idToken } = await signIn.json() as any;
    assert.ok(idToken);
    // Opposite state in default proves every authorization uses the configured user database.
    await defaultDb.collection('users').doc(uid).set({ role: 'admin', active: true });
    await t.test('active roles use the document even without claims, and return exactly its role', async () => {
      for (const role of ['admin', 'operador', 'revisor']) {
        await setUser({ role });
        assert.equal(await roles.getUserRole(uid, 'admin'), role);
        assert.equal(await roles.getRequestRole(request), role);
        assert.equal(await roles.assertCallableRoles(request, [role]), role);
        assert.equal(await roles.assertUserRoles(uid, undefined, [role]), role);
        await assert.rejects(() => roles.assertCallableRoles(request, ['automation']), { code: 'permission-denied' });
      }
    });
    await t.test('missing identity stays unauthenticated; absent or invalid app user is permission-denied', async () => {
      assert.equal(await roles.getRequestRole({ data: {} }), null);
      await assert.rejects(() => roles.assertCallableRoles({ data: {} }, ['admin']), { code: 'unauthenticated' });
      await assert.rejects(() => roles.assertUserRoles(undefined, 'admin', ['admin']), { code: 'unauthenticated' });
      for (const data of [{ active: false }, { status: 'archived' }, { active: 'true' }, { role: 'automation' }, { role: 'unknown' }]) {
        await setUser(data);
        assert.equal(await roles.getUserRole(uid, 'admin'), null);
        await assert.rejects(() => roles.assertCallableRoles(request, ['admin']), { code: 'permission-denied' });
        await assert.rejects(() => roles.assertUserRoles(uid, 'admin', ['admin']), { code: 'permission-denied' });
      }
      await ref.delete();
      await assert.rejects(() => roles.assertCallableRoles(request, ['admin']), { code: 'permission-denied' });
    });
    await t.test('stale admin token cannot authorize privileged callable or any HTTP download after demotion/disable/archive/delete', async () => {
      assert.equal((await post('getSystemConfig')).status, 401);
      for (const name of ['downloadModelBundle', 'downloadJobImage', 'downloadBatchZip', 'downloadSelectedJobsZip'])
        assert.equal((await post(name)).status, 401);
      await setUser({});
      assert.equal((await post('getSystemConfig', idToken)).status, 200);
      for (const data of [{ role: 'revisor' }, { active: false }, { status: 'archived' }, null]) {
        if (data) await setUser(data); else await ref.delete();
        const config = await post('getSystemConfig', idToken);
        assert.equal(config.status, 403); assert.equal(config.body.error.status, 'PERMISSION_DENIED');
        // Revisor still legitimately has image/ZIP access; an empty body reaches validation.
        for (const name of ['downloadModelBundle', 'downloadJobImage', 'downloadBatchZip', 'downloadSelectedJobsZip'])
          assert.equal((await post(name, idToken)).status, data?.role === 'revisor' && name !== 'downloadModelBundle' ? 400 : 403, name);
        await assert.rejects(() => syncUserClaims.run({ ...request, data: { uid: 'other-user', role: 'admin' } }), { code: 'permission-denied' });
      }
    });
    await t.test('Automation reads the user once per human entry and denies stale claims on all six callables', async () => {
      await setUser({ role: 'operador' });
      reads = 0;
      assert.equal((await api.authenticateAutomation(`Bearer ${idToken}`)).role, 'operador');
      assert.equal(reads, 1);
      reads = 0;
      await assert.rejects(() => api.getAutomationPlan.run({ ...request, data: { planId: 'invalid' } }), { code: 'invalid-argument' });
      assert.equal(reads, 1);
      for (const data of [{ role: 'revisor' }, { active: false }, { status: 'archived' }, null]) {
        if (data) await setUser(data); else await ref.delete();
        await assert.rejects(() => api.authenticateAutomation(`Bearer ${idToken}`), { code: 'permission-denied' });
        for (const name of ['createAutomationJob', 'retryAutomationJob', 'createAutomationPlan', 'getAutomationPlan', 'executeAutomationPlanCallable', 'resumeAutomationJob'])
          await assert.rejects(() => api[name].run(request), { code: 'permission-denied' }, name);
      }
      await assert.rejects(() => api.authenticateAutomation(undefined), { code: 'unauthenticated' });
      await assert.rejects(() => api.authenticateAutomation('Bearer invalid'), { code: 'unauthenticated' });
    });
    await t.test('machine tokens use their own principal path without consulting users or Firebase ID tokens', async () => {
      const machine = require('../functions/lib/functions/src/automation/machineAuth.js');
      const principalId = `machine-${randomUUID()}`;
      const secret = 'synthetic-emulator-secret-with-sufficient-entropy';
      await db.collection('automationPrincipals').doc(principalId).set({ active: true, version: 1,
        allowedClientIds: ['own-client'], allowedJobTypes: ['product'], scopes: ['jobs:read'],
        secretHashes: [{ hash: machine.credentialHash(secret), expiresAt: null }] });
      const token = await machine.issueMachineToken(principalId, secret);
      reads = 0;
      const caller = await api.authenticateAutomation(`Bearer ${token.access_token}`, async () => { throw new Error('Machine must not verify a Firebase ID token'); });
      assert.equal(caller.role, 'automation');
      assert.equal(caller.uid, `automation-${principalId}`);
      assert.equal(reads, 0);
      machine.assertMachineScope(caller, 'jobs:read');
      assert.throws(() => machine.assertMachineScope(caller, 'jobs:create'), { code: 'permission-denied' });
      assert.throws(() => machine.assertMachineClient(caller.principal, 'foreign-client', 'product'), { code: 'permission-denied' });
      await assert.rejects(() => roles.assertUserRoles(caller.uid, 'admin', ['admin']), { code: 'permission-denied' });
    });
    await t.test('delegation preserves UID binding, actual request.data authorization and foreign-client denial', async () => {
      await setUser({ role: 'revisor' });
      const caller = { uid, role: 'admin', connectionId: 'test', scopes: ['jobs:read'], allowedClientIds: ['own-client'], accessVersion: 1 };
      let authorized = 0;
      await withManglarContext({ caller, authorize: async (data: any) => { authorized++; assert.equal(data, request.data); } }, async () => {
        await assert.rejects(() => roles.assertCallableRoles({ ...request, auth: { uid: 'foreign', token: {} } }, ['admin']), { code: 'permission-denied' });
        assert.equal(authorized, 0);
        assert.equal(await roles.assertCallableRoles(request, ['revisor']), 'revisor');
        await assert.rejects(() => roles.assertCallableRoles(request, ['admin']), { code: 'permission-denied' });
        assert.equal(authorized, 2);
      });
      await withManglarContext({ caller, authorize: (data: any) => authorizeManglarInput(caller, data) }, async () => {
        await assert.rejects(() => roles.assertCallableRoles({ ...request, data: { clientId: 'foreign-client' } }, ['revisor']), { code: 'permission-denied' });
      });
    });
    await t.test('the same request object is revalidated on every decision and concurrent callers stay isolated', async () => {
      await setUser({});
      reads = 0;
      assert.equal(await roles.assertCallableRoles(request, ['admin']), 'admin');
      assert.equal(reads, 1);
      await setUser({ role: 'revisor' });
      await assert.rejects(() => roles.assertCallableRoles(request, ['admin']), { code: 'permission-denied' });
      assert.equal(reads, 2);
      await db.collection('users').doc('other-active').set({ role: 'operador', active: true, clientAccess: { mode: 'global' } });
      const result = await Promise.all([roles.getUserRole(uid, 'admin'), roles.getUserRole('other-active', 'admin')]);
      assert.deepEqual(result, ['revisor', 'operador']);
    });
  } finally {
    proto.get = originalGet;
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((error: Error | undefined) => error ? reject(error) : resolve()));
    await Promise.all([db.terminate(), defaultDb.terminate()]);
    await admin.app().delete();
  }
});
