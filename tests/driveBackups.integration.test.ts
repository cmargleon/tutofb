import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const local = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST].every(v => /^(127\.0\.0\.1|localhost):\d+$/.test(v || ''));
test('backup persistence, authorization and Firestore security rules (local emulators only)', { skip: !local, timeout: 60000 }, async t => {
  process.env.DRIVE_BACKUPS_ENABLED = 'true';
  const admin: typeof import('../functions/node_modules/firebase-admin') = require('firebase-admin');
  const projectId = process.env.GCLOUD_PROJECT || 'demo-tuto-drive-backups';
  const app = admin.initializeApp({ projectId }); const db = admin.firestore();
  const { FirestoreBackupStore, backupRef } = require('./lib/functions/src/backups/store.js') as typeof import('../functions/src/backups/store');
  const { manageDriveBackup, agentDriveWorkspace } = require('./lib/functions/src/backups/functions.js') as typeof import('../functions/src/backups/functions');
  const { withManglarContext } = require('./lib/functions/src/manglar/context.js') as typeof import('../functions/src/manglar/context');
  const { assertLegacyDriveDestination } = require('./lib/functions/src/backups/legacyGuard.js') as typeof import('../functions/src/backups/legacyGuard');
  const suffix = String(Date.now()); const clientId = `backup-fixture-${suffix}`;
  const settings = { clientId, sourceFolderId: `source-${suffix}`, backupFolderId: `backup-${suffix}`, workspaceFolderId: `workspace-${suffix}`, sourceReader: 'reader@test.iam.gserviceaccount.com', backupWriter: 'backup@test.iam.gserviceaccount.com', workspaceWriter: 'work@test.iam.gserviceaccount.com', operatorUids: [], enabled: false };
  const request = (uid: string, data: unknown, role = 'admin') => ({ auth: { uid, token: { role } }, data }) as never;
  try {
    await db.collection('users').doc(`admin-${suffix}`).set({ uid: `admin-${suffix}`, active: true, role: 'admin' });
    await db.collection('clients').doc(clientId).set({ name: 'Synthetic backup fixture', automation: { driveFolderIds: [settings.sourceFolderId] } });
    await t.test('only active administrators configure; no agent or frontend can choose new boundaries for an existing client', async () => {
      await assert.rejects(() => manageDriveBackup.run(request(`op-${suffix}`, { action: 'configure', settings }, 'operador')), /permisos/);
      await assert.rejects(() => manageDriveBackup.run(request(`stale-admin-${suffix}`, { action: 'configure', settings })), /activo/);
      await manageDriveBackup.run(request(`admin-${suffix}`, { action: 'configure', settings }));
      assert.equal((await backupRef(clientId).get()).data()!.status, 'disabled');
      await assert.rejects(() => manageDriveBackup.run(request(`admin-${suffix}`, { action: 'configure', settings: { ...settings, sourceFolderId: 'unauthorized' } })), /Autoriza/);
      await assert.rejects(() => manageDriveBackup.run(request(`admin-${suffix}`, { action: 'configure', settings: { ...settings, backupFolderId: 'another-root' } })), /inmutables/);
      await assert.rejects(() => agentDriveWorkspace.run(request(`op-${suffix}`, { action: 'trash', clientId, fileId: settings.backupFolderId }, 'operador')), /no autorizado/);
      await db.collection('users').doc(`op-${suffix}`).set({ active: true, role: 'operador' });
      await backupRef(clientId).update({ enabled: true });
      // The client is active, but this operator has no assignment. Rejected before any Google request.
      await assert.rejects(() => agentDriveWorkspace.run(request(`op-${suffix}`, { action: 'trash', clientId, fileId: settings.backupFolderId }, 'operador')), /no autorizado/);
      await backupRef(clientId).update({ operatorUids: [`op-${suffix}`] });
      await assert.rejects(() => withManglarContext({ caller: { uid: `op-${suffix}`, role: 'operador', connectionId: 'fixture-connection', scopes: [], allowedClientIds: ['different-client'], accessVersion: 1 } },
        () => agentDriveWorkspace.run(request(`op-${suffix}`, { action: 'list', clientId }, 'operador'))), /no autorizado/);
      await backupRef(clientId).update({ enabled: false, operatorUids: [] });
    });
    await t.test('durable intents, queue progress and counters survive a new store instance without double counting', async () => {
      const ref = backupRef(clientId); await ref.update({ counts: { created: 0, failed: 0 } });
      const store = new FirestoreBackupStore(ref, 'run', async () => undefined);
      let allocations = 0;
      const ids = await Promise.all(Array.from({ length: 4 }, () => store.intent('same-operation', async () => `allocated-${++allocations}`)));
      assert.equal(new Set(ids).size, 1);
      await store.addTask({ sourceId: 'folder', backupId: 'copy-folder', offset: 0, pageToken: '' });
      await store.saveTask({ sourceId: 'folder', backupId: 'copy-folder', offset: 2, pageToken: '' });
      await store.addTask({ sourceId: 'folder', backupId: 'copy-folder', offset: 0, pageToken: '' });
      const resumed = new FirestoreBackupStore(ref, 'run', async () => undefined); assert.equal((await resumed.task())!.offset, 2);
      await resumed.count('failed', 'file'); await resumed.count('created', 'file'); await resumed.count('unchanged', 'file');
      assert.equal((await ref.get()).data()!.counts.created, 1); assert.equal((await ref.get()).data()!.counts.failed, 0);
      await resumed.doneTask('folder'); assert.equal(await resumed.task(), null);
      const expired = new FirestoreBackupStore(ref, 'run', async () => { throw Error('lease expired'); });
      await assert.rejects(() => expired.saveEntry({ sourceId: 'file' } as never), /lease expired/);
    });
    await t.test('legacy writer guard blocks originals, backup shared drives and descendants before mutation', async () => {
      const files: Record<string, { id: string; parents?: string[]; driveId?: string }> = {
        originalChild: { id: 'originalChild', parents: [settings.sourceFolderId] }, backupChild: { id: 'backupChild', driveId: settings.backupFolderId },
        other: { id: 'other' },
      };
      for (const id of ['originalChild', 'backupChild', settings.sourceFolderId, settings.backupFolderId])
        await assert.rejects(() => assertLegacyDriveDestination(id, async current => files[current] || { id: current }), /protegido|protegidos/);
      await assertLegacyDriveDestination('other', async id => id === 'root' ? files.other : files[id]);
      await assert.rejects(() => assertLegacyDriveDestination('hiddenParent', async id => ({ id: id === 'root' ? 'other' : id })), /probar la raíz/);
    });
    await t.test('rules deny operators all backup data and deny even admins all direct backup and queue writes', async () => {
      const authURL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`;
      for (const role of ['admin', 'operador']) {
        const account = await (await fetch(authURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `backup-${role}-${suffix}@example.test`, password: 'test-password-only', returnSecureToken: true }) })).json() as { localId: string; idToken: string };
        await db.collection('users').doc(account.localId).set({ active: true, role });
        await admin.auth().setCustomUserClaims(account.localId, { role });
        const signed = await (await fetch(authURL.replace('accounts:signUp', 'accounts:signInWithPassword'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `backup-${role}-${suffix}@example.test`, password: 'test-password-only', returnSecureToken: true }) })).json() as { idToken: string };
        account.idToken = signed.idToken;
        const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents`;
        const headers = { Authorization: `Bearer ${account.idToken}`, 'Content-Type': 'application/json' };
        assert.equal((await fetch(`${base}/driveBackups/${clientId}`, { headers })).status, role === 'admin' ? 200 : 403);
        for (const path of [`driveBackups/${clientId}`, `driveBackups/${clientId}/versions/arbitrary`, `driveBackupQueue/${clientId}`, 'driveBackupControl/configuration']) {
          assert.equal((await fetch(`${base}/${path}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: { status: { stringValue: 'hijacked' } } }) })).status, 403);
        }
      }
    });
  } finally { await app.delete(); }
});
