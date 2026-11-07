import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, terminate,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const emulatorKeys = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'] as const;
const enabled = emulatorKeys.some(key => Boolean(process.env[key]));
const required = process.env.REQUIRE_CATALOG_DELETE_EMULATORS === '1';

// REQUIRE_CATALOG_DELETE_EMULATORS=1 makes the focused verification fail instead of skip.
test('catalog deletion protection (loopback emulators only)', { skip: !enabled && !required }, async t => {
  for (const key of emulatorKeys) {
    assert.match(process.env[key] ?? '', /^127\.0\.0\.1:\d+$/, `${key} must use IPv4 loopback`);
  }
  const projectId = process.env.GCLOUD_PROJECT ?? '';
  assert.match(projectId, /^demo-[\w-]+$/, 'A disposable demo project is required');
  assert.ok(!process.env.FIRESTORE_DATABASE_ID || process.env.FIRESTORE_DATABASE_ID === '(default)');

  // Import Admin/handlers only after checking every endpoint. No Functions emulator is
  // started: .run executes the real handlers, without scheduling unrelated triggers.
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const handlers = {
    clients: require('../functions/lib/functions/src/callables/permanentlyDeleteClient.js').permanentlyDeleteClient,
    models: require('../functions/lib/functions/src/callables/permanentlyDeleteModel.js').permanentlyDeleteModel,
  };
  const { setClientArchived, setModelArchived } = require('../functions/lib/functions/src/manglar/catalogService.js');
  const archiveHandlers = { clients: setClientArchived, models: setModelArchived };
  const prefix = `catalog-delete-${randomUUID()}`;
  const browsers: Array<{ app: ReturnType<typeof initializeApp>; db: ReturnType<typeof initializeFirestore> }> = [];
  const principals: Array<{ name: string; uid?: string; auth?: any; db: ReturnType<typeof initializeFirestore> }> = [];

  try {
    for (const name of ['admin', 'operador', 'revisor', 'inactive-admin', 'anonymous']) {
      const browserApp = initializeApp({ projectId, apiKey: 'emulator-only', authDomain: `${projectId}.firebaseapp.com` }, `${prefix}-${name}`);
      const browserDb = initializeFirestore(browserApp, {});
      const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
      connectFirestoreEmulator(browserDb, host, Number(port));
      browsers.push({ app: browserApp, db: browserDb });
      const auth = getAuth(browserApp);
      connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      if (name === 'anonymous') {
        principals.push({ name, db: browserDb });
        continue;
      }
      const uid = `${prefix}-${name}`;
      const email = `${uid}@example.test`;
      const password = 'emulator-only-password';
      const role = name === 'inactive-admin' ? 'admin' : name;
      await app.auth().createUser({ uid, email, password });
      await app.auth().setCustomUserClaims(uid, { role });
      await db.collection('users').doc(uid).set({ uid, role, active: name !== 'inactive-admin', clientAccess: { mode: 'global' }, status: 'active' });
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      principals.push({ name, uid, auth: { uid, token: (await user.getIdTokenResult()).claims }, db: browserDb });
    }
    const browserAdmin = principals.find(p => p.name === 'admin')!;
    const fixture = (name: string, status = 'active') => ({ name, status, clientId: `${prefix}-parent`, poses: [] });
    const denied = (action: () => Promise<unknown>) => assert.rejects(action, { code: 'permission-denied' });

    for (const resource of ['clients', 'models'] as const) {
      for (const principal of principals) {
        await t.test(`${resource}: browser ${principal.name} read/create/edit/archive/delete matrix`, async () => {
          const canRead = ['admin', 'operador', 'revisor'].includes(principal.name);
          const canWrite = principal.name === 'admin';
          const id = `${prefix}-${principal.name}`;
          const ref = doc(principal.db, resource, id);
          const adminRef = db.collection(resource).doc(id);
          await adminRef.set(fixture(id));
          if (canRead) {
            assert.equal((await getDoc(ref)).exists(), true);
            assert.ok((await getDocs(collection(principal.db, resource))).size > 0);
          } else {
            await denied(() => getDoc(ref));
            await denied(() => getDocs(collection(principal.db, resource)));
          }
          const create = () => setDoc(doc(principal.db, resource, `${id}-new`), fixture('Created'));
          const edit = () => updateDoc(ref, { name: 'Edited' });
          const archive = () => updateDoc(ref, { status: 'archived', archivedByUid: principal.uid ?? null });
          if (canWrite) {
            await create();
            if (resource === 'clients') await denied(edit); else await edit();
            assert.equal((await adminRef.get()).data().name, resource === 'clients' ? id : 'Edited');
            await archive();
            assert.equal((await adminRef.get()).data().status, 'archived');
            if (resource === 'clients') await denied(() => updateDoc(ref, { name: 'Edited while archived' }));
            else await updateDoc(ref, { name: 'Edited while archived' });
          } else {
            await denied(create);
            await denied(edit);
            await denied(archive);
            assert.deepEqual((await adminRef.get()).data(), fixture(id));
            assert.equal((await db.collection(resource).doc(`${id}-new`).get()).exists, false);
          }
          for (const status of ['active', 'archived']) {
            await adminRef.update({ status });
            if (canRead) assert.equal((await getDoc(ref)).data()!.status, status);
            else await denied(() => getDoc(ref));
            await denied(() => deleteDoc(ref));
            assert.equal((await adminRef.get()).data().status, status);
          }
        });
      }

      await t.test(`${resource}: admin batch and transaction cannot bypass delete denial`, async () => {
        const refs = ['active', 'archived'].map(status => doc(browserAdmin.db, resource, `${prefix}-atomic-${status}`));
        for (const [index, ref] of refs.entries()) await db.doc(ref.path).set(fixture(ref.id, index ? 'archived' : 'active'));
        const batch = writeBatch(browserAdmin.db);
        refs.forEach(ref => batch.delete(ref));
        await denied(() => batch.commit());
        for (const ref of refs) {
          await denied(() => runTransaction(browserAdmin.db, async tx => { await tx.get(ref); tx.delete(ref); }));
          assert.equal((await db.doc(ref.path).get()).exists, true);
        }
      });

      await t.test(`${resource}: callable role checks and archive-before-delete normal flow`, async () => {
        const id = `${prefix}-callable`;
        const ref = db.collection(resource).doc(id);
        const before = fixture(id);
        await ref.set(before);
        const call = (principal: typeof browserAdmin, data = { id }) => handlers[resource].run({ data, auth: principal.auth });
        for (const name of ['anonymous', 'operador', 'revisor']) {
          const principal = principals.find(p => p.name === name)!;
          await assert.rejects(() => call(principal), { code: name === 'anonymous' ? 'unauthenticated' : 'permission-denied' });
          await assert.rejects(() => archiveHandlers[resource].run({ data: { id, archived: true }, auth: principal.auth }), {
            code: name === 'anonymous' ? 'unauthenticated' : 'permission-denied',
          });
        }
        await assert.rejects(() => call(browserAdmin), { code: 'failed-precondition' });
        assert.deepEqual((await ref.get()).data(), before);
        await archiveHandlers[resource].run({ data: { id, archived: true }, auth: browserAdmin.auth });
        const archived = (await ref.get()).data();
        assert.equal(archived.status, 'archived');
        assert.equal(archived.archivedByUid, browserAdmin.uid);
        for (const name of ['anonymous', 'operador', 'revisor']) {
          await assert.rejects(() => call(principals.find(p => p.name === name)!), { code: name === 'anonymous' ? 'unauthenticated' : 'permission-denied' });
          assert.deepEqual((await ref.get()).data(), archived);
        }
        await denied(() => deleteDoc(doc(browserAdmin.db, resource, id)));
        assert.deepEqual(await call(browserAdmin, { id: ` ${id} ` }), { success: true, id });
        assert.equal((await ref.get()).exists, false);
      });

      await t.test(`${resource}: Manglar delete still delegates with authorization and archive precondition`, async () => {
        const { executeManglarTool } = require('../functions/lib/functions/src/automation/mcp.js');
        const id = `${prefix}-manglar`;
        const ref = db.collection(resource).doc(id);
        // Models access is scoped through their parent client.
        await db.collection('clients').doc(`${prefix}-parent`).set(fixture('Parent'));
        await ref.set(fixture(id));
        const caller = { uid: browserAdmin.uid, role: 'admin', connectionId: prefix, allowedClientIds: null, accessVersion: 0, scopes: ['jobs:read', 'jobs:create'] };
        const call = (action: string, data: any, extra: any = {}) => executeManglarTool(`manglar_${resource}`, { action, data, ...extra }, caller);
        const prepare = async (suffix: string) => {
          const result = await executeManglarTool('manglar_prepare_action', { domain: resource, action: 'delete', data: { id }, idempotencyKey: `${prefix}-${resource}-${suffix}` }, caller);
          return { operationId: result.operationId, confirmationToken: result.confirmationToken };
        };
        await assert.rejects(() => call('delete', { id }), { code: 'failed-precondition' });
        const activeAuthorization = await prepare('active');
        await assert.rejects(() => call('delete', { id }, { authorization: activeAuthorization }), { code: 'failed-precondition' });
        assert.equal((await ref.get()).data().status, 'active');
        await call('archive', { id }, { idempotencyKey: `${prefix}-${resource}-archive` });
        assert.equal((await ref.get()).data().status, 'archived');
        for (const role of ['operador', 'revisor']) {
          const principal = principals.find(p => p.name === role)!;
          await assert.rejects(() => executeManglarTool(`manglar_${resource}`, { action: 'delete', data: { id } }, { ...caller, uid: principal.uid, role }), { code: 'permission-denied' });
        }
        assert.deepEqual(await call('delete', { id }, { authorization: await prepare('archived') }), { success: true, id });
        assert.equal((await ref.get()).exists, false);
      });
    }
  } finally {
    for (const browser of browsers) {
      await terminate(browser.db);
      await deleteApp(browser.app);
    }
    await app.delete();
  }
});
