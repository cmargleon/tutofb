import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const endpoints = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'] as const;
const enabled = endpoints.some(key => Boolean(process.env[key]));
const required = process.env.REQUIRE_USER_LIFECYCLE_EMULATORS === '1';
const child = process.env.USER_LIFECYCLE_DATABASE_CHILD === '1';

const assertLocal = () => {
  for (const key of endpoints) {
    assert.match(process.env[key] ?? '', /^127\.0\.0\.1:\d+$/, `${key} must use IPv4 loopback`);
  }
  assert.match(process.env.GCLOUD_PROJECT ?? '', /^demo-[\w-]+$/, 'A disposable demo project is required');
};

// Each database gets a fresh process: appFirestore caches both its database ID
// at import time and the Firestore instance. Never import the production index
// or start the Functions emulator (which would enable unrelated triggers).
if (!child) {
  test('user lifecycle: isolated default and named databases (local Auth/Firestore)', {
    skip: !enabled && !required,
  }, async t => {
    assertLocal();
    for (const databaseId of ['', 'user-lifecycle-named']) {
      await t.test(databaseId || '(default)', async () => {
        const env: NodeJS.ProcessEnv = { ...process.env, FIRESTORE_DATABASE_ID: databaseId, USER_LIFECYCLE_DATABASE_CHILD: '1' };
        // Inheriting this makes Node silently skip the nested test runner.
        delete env.NODE_TEST_CONTEXT;
        const { stdout, stderr } = await promisify(execFile)(process.execPath, [
          '--import', 'tsx', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url),
        ], {
          env,
          timeout: 120_000,
        });
        t.diagnostic(stdout);
        if (stderr) t.diagnostic(stderr);
        assert.match(stdout, /# tests 4\n/);
        assert.match(stdout, /# pass 4\n/);
        assert.match(stdout, /# skipped 0\n/);
      });
    }
  });
} else {
  test(`user lifecycle handlers: ${process.env.FIRESTORE_DATABASE_ID || '(default)'}`, async t => {
    assertLocal();
    const admin = require('../functions/node_modules/firebase-admin');
    const { getFirestore } = createRequire(new URL('../functions/package.json', import.meta.url))('firebase-admin/firestore');
    const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
    const { getAppFirestore, APP_FIRESTORE_DATABASE_ID } = require('../functions/lib/functions/src/firebase/appFirestore.js');
    const db = getAppFirestore();
    const otherDb = getFirestore(app, APP_FIRESTORE_DATABASE_ID === '(default)' ? 'user-lifecycle-named' : '(default)');
    const archive = require('../functions/lib/functions/src/callables/archiveAppUser.js').archiveAppUser;
    const restore = require('../functions/lib/functions/src/callables/restoreAppUser.js').restoreAppUser;
    const remove = require('../functions/lib/functions/src/callables/permanentlyDeleteAppUser.js').permanentlyDeleteAppUser;
    const prefix = `user-lifecycle-${randomUUID()}`;
    const uids: string[] = [];
    const sentinels = new Map<string, Record<string, unknown>>();
    const ref = (uid: string) => db.collection('users').doc(uid);
    const auth = app.auth();
    const makeUser = async (name: string, role = 'operador') => {
      const uid = `${prefix}-${name}`;
      uids.push(uid);
      await auth.createUser({ uid, email: `${uid}@example.test`, password: 'emulator-only-password' });
      await auth.setCustomUserClaims(uid, { role, active: true });
      await ref(uid).set({ uid, role, active: true, status: 'active', displayName: name });
      const sentinel = { uid, role: 'revisor', active: true, status: 'active', sentinel: prefix };
      await otherDb.collection('users').doc(uid).set(sentinel);
      sentinels.set(uid, sentinel);
      return uid;
    };
    const signIn = async (uid: string) => fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${uid}@example.test`, password: 'emulator-only-password', returnSecureToken: true }),
      },
    );
    const principal = async (uid: string) => {
      const response = await signIn(uid);
      assert.equal(response.status, 200);
      const { idToken } = await response.json() as { idToken: string };
      return { uid, token: await auth.verifyIdToken(idToken) };
    };
    const unchangedSentinels = async () => {
      for (const [uid, value] of sentinels) {
        assert.deepEqual((await otherDb.collection('users').doc(uid).get()).data(), value);
      }
    };
    const disabled = async (uid: string) => {
      const record = await auth.getUser(uid);
      assert.equal(record.disabled, true);
      assert.deepEqual(record.customClaims, { role: 'operador', active: false });
      const response = await signIn(uid);
      assert.equal(response.status, 400);
      assert.equal((await response.json() as any).error.message, 'USER_DISABLED');
    };

    try {
      const adminUid = await makeUser('admin', 'admin');
      const actor = await principal(adminUid);
      const uid = await makeUser('target');
      const operator = await principal(uid);
      const call = (handler: any, target = uid, caller: any = actor) => handler.run({ data: { uid: target }, auth: caller });

      await t.test('authorization, invalid/missing users, self archive/delete and active delete are denied', async () => {
        const before = (await ref(uid).get()).data();
        const beforeAdmin = (await ref(adminUid).get()).data();
        for (const handler of [archive, restore, remove]) {
          await assert.rejects(() => call(handler, uid, null), { code: 'unauthenticated' });
          await assert.rejects(() => call(handler, uid, operator), { code: 'permission-denied' });
          await assert.rejects(() => call(handler, '  '), { code: 'invalid-argument' });
          await assert.rejects(() => call(handler, `${prefix}-missing`), { code: 'not-found' });
        }
        await assert.rejects(() => call(archive, adminUid), {
          code: 'permission-denied', message: 'No puedes archivar tu propia cuenta desde este panel.',
        });
        await assert.rejects(() => call(remove, adminUid), {
          code: 'permission-denied', message: 'No puedes borrar tu propia cuenta desde este panel.',
        });
        await assert.rejects(() => call(remove), { code: 'failed-precondition' });
        assert.deepEqual((await ref(uid).get()).data(), before);
        assert.deepEqual((await ref(adminUid).get()).data(), beforeAdmin);
        assert.equal((await auth.getUser(adminUid)).disabled, false);
        assert.equal((await auth.getUser(uid)).disabled, false);
        await unchangedSentinels();
      });

      await t.test('archive, idempotent archive, restore inactive/disabled, rearchive and permanent delete', async () => {
        assert.deepEqual(await call(archive, ` ${uid} `), { success: true, uid });
        const archived = (await ref(uid).get()).data();
        assert.equal(archived.status, 'archived');
        assert.equal(archived.active, false);
        assert.equal(archived.archivedByUid, adminUid);
        assert.ok(archived.archivedAt instanceof admin.firestore.Timestamp);
        assert.ok(archived.updatedAt instanceof admin.firestore.Timestamp);
        assert.equal(archived.displayName, 'target');
        await disabled(uid);
        await unchangedSentinels();
        assert.deepEqual(await call(archive), { success: true, uid });
        assert.deepEqual((await ref(uid).get()).data(), archived);

        assert.deepEqual(await call(restore, ` ${uid} `), { success: true, uid });
        const restored = (await ref(uid).get()).data();
        assert.equal(restored.status, 'active');
        assert.equal(restored.active, false);
        assert.equal(restored.archivedAt, null);
        assert.equal(restored.archivedByUid, null);
        assert.ok(restored.updatedAt instanceof admin.firestore.Timestamp);
        assert.equal(restored.displayName, 'target');
        await disabled(uid);
        await unchangedSentinels();
        await assert.rejects(() => call(remove), { code: 'failed-precondition' });
        await call(archive);
        assert.deepEqual(await call(remove, ` ${uid} `), { success: true, uid });
        assert.equal((await ref(uid).get()).exists, false);
        await assert.rejects(() => auth.getUser(uid), { code: 'auth/user-not-found' });
        await unchangedSentinels();
      });

      await t.test('missing Auth preserves write-before-Auth and delete-Auth-before-document behavior', async () => {
        const missingUid = await makeUser('missing-auth');
        await auth.deleteUser(missingUid);
        await assert.rejects(() => call(archive, missingUid), { code: 'auth/user-not-found' });
        assert.equal((await ref(missingUid).get()).data().status, 'archived');
        await assert.rejects(() => call(restore, missingUid), { code: 'auth/user-not-found' });
        const restored = (await ref(missingUid).get()).data();
        assert.equal(restored.status, 'active');
        assert.equal(restored.active, false);
        assert.equal(restored.archivedAt, null);
        await ref(missingUid).update({ status: 'archived' });
        const beforeDelete = (await ref(missingUid).get()).data();
        await assert.rejects(() => call(remove, missingUid), {
          code: 'not-found', message: 'El usuario ya no existe en Firebase Auth.',
        });
        assert.deepEqual((await ref(missingUid).get()).data(), beforeDelete);
        await unchangedSentinels();
      });
    } finally {
      for (const uid of uids) {
        await ref(uid).delete();
        await otherDb.collection('users').doc(uid).delete();
        await auth.deleteUser(uid).catch((error: any) => {
          if (error.code !== 'auth/user-not-found') throw error;
        });
      }
      await Promise.all([db.terminate(), otherDb.terminate()]);
      await app.delete();
    }
  });
}
