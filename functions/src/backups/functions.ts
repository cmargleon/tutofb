import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { DriveBackupRequest, DriveBackupResponse, DriveBackupSettings, DriveWorkspaceRequest, DriveWorkspaceResponse } from '../../../shared/src/types/backups';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore, APP_FIRESTORE_DATABASE_ID } from '../firebase/appFirestore';
import { getManglarContext } from '../manglar/context';
import { BackupDrive, WorkspaceDrive } from './drive';
import { BackupEngine, type BackupVersion, type ScanState } from './engine';
import { assertIsolation } from './isolation';
import { BACKUP_CRON, checkedId, FOLDER, hash, validateSettings } from './policy';
import { BACKUPS_ENABLED, BACKUPS_ZONE, BACKUP_RUNTIME, WORKSPACE_RUNTIME, custodians } from './runtime';
import { backupConfigs, backupRef, FirestoreBackupStore } from './store';
import { restoreEntry } from './restore';

type Stored = DriveBackupSettings & { scan?: ScanState | null; cursor?: string; lease?: string | null; leaseUntil?: number; lastReconcileAt?: number; retries?: number };
const queue = (id: string) => getAppFirestore().collection('driveBackupQueue').doc(checkedId(id));
const enabled = () => { if (!BACKUPS_ENABLED.value()) throw new HttpsError('failed-precondition', 'Los respaldos están desactivados hasta completar la configuración de identidades y permisos.'); };
const enqueue = async (clientId: string) => queue(clientId).set({ nonce: randomUUID(), at: Date.now() }, { merge: true });

export const manageDriveBackup = onCall<DriveBackupRequest, Promise<DriveBackupResponse>>({ serviceAccount: BACKUP_RUNTIME, timeoutSeconds: 120, memory: '256MiB' }, async request => {
  await assertCallableRoles(request, ['admin']);
  if (getManglarContext()?.caller) throw new HttpsError('permission-denied', 'La administración de respaldos no está disponible para conexiones de agentes.');
  // Check current user document, even when a stale custom claim says admin.
  const user = (await getAppFirestore().collection('users').doc(request.auth!.uid).get()).data();
  if (!user?.active || user.role !== 'admin') throw new HttpsError('permission-denied', 'Se requiere un administrador activo.');
  try {
    const input = request.data;
    if (input.action === 'configure') {
      const settings = validateSettings(input.settings);
      const client = (await getAppFirestore().collection('clients').doc(settings.clientId).get()).data();
      if (!client || client.status === 'archived' || !client.automation?.driveFolderIds?.includes(settings.sourceFolderId)) throw new Error('Autoriza primero la carpeta original en la ficha de este cliente.');
      if (settings.enabled) { enabled(); await assertIsolation(settings, custodians()); }
      const ref = backupRef(settings.clientId);
      await getAppFirestore().runTransaction(async tx => {
        const lock = getAppFirestore().collection('driveBackupControl').doc('configuration');
        await tx.get(lock);
        const all = await tx.get(backupConfigs());
        const current = all.docs.find(d => d.id === settings.clientId)?.data() as Stored | undefined;
        if (current?.leaseUntil && current.leaseUntil > Date.now()) throw new Error('Espera a que termine la ejecución activa.');
        if (current && ['sourceFolderId', 'backupFolderId', 'workspaceFolderId', 'sourceReader', 'backupWriter', 'workspaceWriter'].some(k => current[k as keyof Stored] !== settings[k as keyof DriveBackupSettings])) throw new Error('Las fronteras de una protección existente son inmutables; requiere una migración administrativa revisada.');
        const folders = [settings.sourceFolderId, settings.backupFolderId, settings.workspaceFolderId];
        const identities = [settings.sourceReader, settings.backupWriter, settings.workspaceWriter];
        if (all.docs.some(d => d.id !== settings.clientId && (folders.some(f => [d.data().sourceFolderId, d.data().backupFolderId, d.data().workspaceFolderId].includes(f)) || identities.some(e => [d.data().sourceReader, d.data().backupWriter, d.data().workspaceWriter].includes(e))))) throw new Error('Carpeta o identidad ya asignada a otro cliente.');
        tx.set(ref, { ...settings, status: settings.enabled ? 'idle' : 'disabled', updatedAt: Date.now(), timeZone: BACKUPS_ZONE.value(), configuredBy: request.auth!.uid }, { merge: true });
        tx.set(lock, { at: Date.now() });
        tx.create(ref.collection('audit').doc(), { action: 'configure', uid: request.auth!.uid, at: Date.now(), enabled: settings.enabled });
      });
      if (settings.enabled) await enqueue(settings.clientId);
      return { accepted: true, message: settings.enabled ? 'Protección verificada y sincronización inicial en cola.' : 'Configuración guardada; protección desactivada.' };
    }
    enabled();
    const clientId = checkedId(input.clientId);
    const config = (await backupRef(clientId).get()).data() as Stored | undefined;
    if (!config?.enabled) throw new Error('Protección no configurada o desactivada.');
    if (input.action === 'sync') {
      await backupRef(clientId).update({ requested: true, retries: 0 }); await enqueue(clientId);
    } else if (input.action === 'restore') {
      const requestId = checkedId(input.requestId);
      const sourceFileId = input.sourceFileId ? checkedId(input.sourceFileId) : null;
      const versionKey = input.versionKey ? checkedId(input.versionKey) : null;
      if (versionKey && !sourceFileId) throw new Error('Selecciona un archivo para restaurar una versión.');
      const doc = backupRef(clientId).collection('restores').doc(requestId);
      await getAppFirestore().runTransaction(async tx => {
        const current = (await tx.get(doc)).data();
        if (current && (current.sourceFileId !== sourceFileId || current.versionKey !== versionKey)) throw new Error('requestId reutilizado con otra solicitud.');
        if (!current) tx.create(doc, { requestId, sourceFileId, versionKey, status: 'queued', cursor: '', at: Date.now(), uid: request.auth!.uid });
      });
      await backupRef(clientId).update({ retries: 0 }); await enqueue(clientId);
    } else throw new Error('Acción inválida.');
    await backupRef(clientId).collection('audit').add({ action: input.action, uid: request.auth!.uid, at: Date.now() });
    return { accepted: true, message: 'Solicitud en cola; consulta el resultado y las alertas en este panel.' };
  } catch (error) { if (error instanceof HttpsError) throw error; throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'Solicitud inválida.'); }
});

export const scheduledDriveBackup = onSchedule({ serviceAccount: BACKUP_RUNTIME, schedule: BACKUP_CRON, timeZone: BACKUPS_ZONE, retryCount: 2,
  timeoutSeconds: 120, memory: '256MiB', maxInstances: 1, concurrency: 1 }, async () => {
  if (!BACKUPS_ENABLED.value()) return;
  let after = '';
  for (;;) {
    const base = backupConfigs().orderBy('__name__');
    const page = await (after ? base.startAfter(after) : base).limit(100).get();
    for (const doc of page.docs) if (doc.data().enabled) {
      await doc.ref.update({ requested: true, retries: 0 }); await enqueue(doc.id);
    }
    if (page.size < 100) return;
    after = page.docs[page.docs.length - 1].id;
  }
});

async function restoreWork(config: Stored, store: FirestoreBackupStore, deadline: number): Promise<boolean> {
  const pending = await store.ref.collection('restores').where('status', '==', 'queued').limit(1).get();
  const doc = pending.docs[0]; if (!doc) return false;
  const job = doc.data();
  const backup = new BackupDrive(config.backupWriter, true);
  const work = new WorkspaceDrive(config.workspaceWriter, false);
  const selected = job.sourceFileId ? await store.entry(job.sourceFileId) : null;
  if (job.sourceFileId && !selected) throw new Error('Archivo no respaldado para este cliente.');
  const restored = new Map<string, string>();
  let cursor = job.cursor as string;
  while (Date.now() < deadline) {
    const page = await store.entriesAfter(cursor);
    if (!page.length) { await doc.ref.update({ status: 'completed', completedAt: Date.now() }); return false; }
    for (let entry of page) {
      if (Date.now() >= deadline) return true;
      let include = !selected || entry.sourceId === selected.sourceId;
      if (selected?.mimeType === FOLDER && !include) {
        let parent = entry.parentSourceId; const seen = new Set<string>();
        while (parent !== config.sourceFolderId && !seen.has(parent)) {
          if (parent === selected.sourceId) { include = true; break; }
          seen.add(parent); parent = (await store.entry(parent))?.parentSourceId || config.sourceFolderId;
        }
      }
      if (include) {
        if (job.versionKey && entry.sourceId === selected?.sourceId) {
          const version = (await store.ref.collection('versions').doc(job.versionKey).get()).data() as BackupVersion | undefined;
          if (!version || version.sourceId !== entry.sourceId) throw new Error('Versión no pertenece al archivo de este cliente.');
          entry = { ...entry, ...version };
        }
        await restoreEntry(config, entry, job.requestId, backup, work, store, restored);
      }
      cursor = entry.sourceId; await doc.ref.update({ cursor });
    }
  }
  return true;
}

export const driveBackupWorker = onDocumentWritten({ serviceAccount: BACKUP_RUNTIME, document: 'driveBackupQueue/{clientId}', database: APP_FIRESTORE_DATABASE_ID,
  timeoutSeconds: 540, memory: '1GiB', maxInstances: 3, concurrency: 1, retry: true }, async event => {
  if (!event.data?.after.exists || !BACKUPS_ENABLED.value()) return;
  const ref = backupRef(event.params.clientId); const lease = randomUUID(); const started = Date.now();
  const config = await getAppFirestore().runTransaction(async tx => {
    const value = (await tx.get(ref)).data() as Stored | undefined;
    if (!value?.enabled || (value.retries || 0) >= 4) return null;
    if ((value.leaseUntil || 0) > started) throw new Error('Otra ejecución mantiene la concesión; Eventarc reintentará esta solicitud.');
    tx.update(ref, { lease, leaseUntil: started + 12 * 60000, status: 'running', lastRunAt: started, timeZone: BACKUPS_ZONE.value() }); return value;
  });
  if (!config) return;
  let again = false;
  const check = async () => { const current = (await ref.get()).data(); if (current?.lease !== lease || !current.enabled || current.leaseUntil < Date.now()) throw new Error('Concesión de ejecución perdida.'); };
  const runId = config.scan?.id || randomUUID();
  const store = new FirestoreBackupStore(ref, runId, check);
  try {
    const client = (await getAppFirestore().collection('clients').doc(config.clientId).get()).data();
    if (!client || client.status === 'archived') throw new Error('Cliente inexistente o archivado.');
    await assertIsolation(config, custodians());
    const engine = new BackupEngine(config, new BackupDrive(config.sourceReader, true), new BackupDrive(config.backupWriter, false), store);
    let state = config.scan;
    if (!state) {
      await ref.update({ counts: { created: 0, updated: 0, unchanged: 0, failed: 0, retained: 0 } });
      state = await engine.begin(runId, config.cursor, !config.lastReconcileAt || started - config.lastReconcileAt >= 24 * 3600000);
    }
    if (state) {
      // Recreate the initial queue item if a process stopped between state creation and queue creation.
      await store.addTask({ sourceId: config.sourceFolderId, backupId: config.backupFolderId, pageToken: '', offset: 0 });
      if (await engine.step(state, started + 420000)) {
        await ref.update({ cursor: state.cursor, scan: null, lastSuccessAt: Date.now(), lastReconcileAt: Date.now(), requested: false });
        await ref.collection('runs').doc(runId).set({ status: 'completed', at: Date.now(), counts: (await ref.get()).data()?.counts }, { merge: true });
      } else again = true;
    } else await ref.update({ lastSuccessAt: Date.now(), requested: false });
    if (!again && Date.now() < started + 420000) again = await restoreWork(config, store, started + 420000);
    if (!again) again = !(await ref.collection('restores').where('status', '==', 'queued').limit(1).get()).empty;
    await check(); await ref.update({ status: 'idle', lastError: null, retries: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error de respaldo';
    const retries = (config.retries || 0) + 1;
    // Bounded retries. The scheduled/manual request resets this budget; no infinite trigger loop.
    again = retries < 4;
    await check(); await ref.update({ status: 'error', lastError: message, retries });
    await ref.collection('runs').doc(runId).set({ status: 'error', error: message, at: Date.now() }, { merge: true });
    await ref.collection('audit').add({ action: 'error', message, at: Date.now() });
    console.error('drive_backup_error', { clientId: config.clientId, runId, message });
  } finally {
    await getAppFirestore().runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (current?.lease === lease) tx.update(ref, { lease: null, leaseUntil: 0 }); });
  }
  if (again) await enqueue(config.clientId);
});

export const agentDriveWorkspace = onCall<DriveWorkspaceRequest, Promise<DriveWorkspaceResponse>>({ serviceAccount: WORKSPACE_RUNTIME, timeoutSeconds: 120, memory: '256MiB' }, async request => {
  await assertCallableRoles(request, ['admin', 'operador']); enabled();
  try {
    const data = request.data; const clientId = checkedId(data.clientId);
    const config = (await backupRef(clientId).get()).data() as Stored | undefined;
    const user = (await getAppFirestore().collection('users').doc(request.auth!.uid).get()).data();
    const delegated = getManglarContext()?.caller;
    if (!config?.enabled || !user?.active || user.role !== 'admin' && !config.operatorUids.includes(request.auth!.uid) ||
        delegated?.allowedClientIds && !delegated.allowedClientIds.includes(clientId)) throw new Error('Cliente no autorizado.');
    const client = (await getAppFirestore().collection('clients').doc(clientId).get()).data();
    if (!client || client.status === 'archived') throw new Error('Cliente inactivo.');
    const drive = new WorkspaceDrive(config.workspaceWriter, false); const root = config.workspaceFolderId;
    const fileId = checkedId(data.fileId || root);
    // Every read and write re-proves current ancestry; no caller-supplied root or identity is used.
    const file = await drive.inRoot(fileId, root);
    const bytes = data.base64 ? Buffer.from(data.base64, 'base64') : Buffer.alloc(0);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Carga de trabajo de más de 8 MiB.');
    let result: DriveWorkspaceResponse = {};
    if (data.action === 'list') {
      if (file.mimeType !== FOLDER) throw new Error('Se requiere una carpeta.');
      // Bounded response; clients must use narrow working folders.
      const page = await drive.children(fileId); if (page.nextPageToken) throw new Error('Divide la carpeta de trabajo en subcarpetas de hasta 100 entradas.');
      result = { files: page.files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType })) };
    } else if (data.action === 'read') result = { base64: (await drive.bytes(file, root, 8 * 1024 * 1024)).toString('base64') };
    else if (data.action === 'create') {
      const parent = checkedId(data.parentId || root); await drive.inRoot(parent, root);
      if (!data.name || data.name.length > 250 || !data.requestId) throw new Error('Nombre y requestId obligatorios.');
      const key = hash(['workspace', request.auth!.uid, checkedId(data.requestId), parent, data.name, data.mimeType, bytes.toString('base64')]);
      const intent = backupRef(clientId).collection('workspaceIntents').doc(key);
      const id = await getAppFirestore().runTransaction(async tx => {
        const existing = (await tx.get(intent)).data()?.driveId; if (existing) return existing as string;
        const value = await drive.generateId(); tx.create(intent, { driveId: value, at: Date.now() }); return value;
      });
      const mime = data.mimeType === FOLDER ? FOLDER : 'application/octet-stream';
      result = { fileId: (await drive.create(id, parent, data.name, mime, { backupClient: clientId, backupKey: key }, root, mime === FOLDER ? undefined : bytes)).id };
    } else if (data.action === 'update') { await drive.replaceWorkspace(fileId, root, bytes, 'application/octet-stream'); result = { fileId }; }
    else if (data.action === 'trash') { await drive.trashWorkspace(fileId, root); result = { fileId }; }
    else throw new Error('Acción inválida.');
    await backupRef(clientId).collection('workspaceAudit').add({ action: data.action, fileId: result.fileId || fileId, uid: request.auth!.uid, at: Date.now() });
    return result;
  } catch (error) { throw new HttpsError('permission-denied', error instanceof Error ? error.message : 'Acceso denegado.'); }
});
