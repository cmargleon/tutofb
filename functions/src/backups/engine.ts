import { createHash } from 'node:crypto';
import type { DriveBackupSettings } from '../../../shared/src/types/backups';
import { BackupDrive, BackupDriveError } from './drive';
import { contentVersion, exportType, FOLDER, hash, type FileMetadata } from './policy';

export interface BackupEntry {
  sourceId: string; backupId: string; name: string; parentSourceId: string; mimeType: string;
  contentKey: string; seenRun: string; missing?: boolean;
}
export interface ScanTask { sourceId: string; backupId: string; pageToken: string; offset: number }
export interface ScanState { id: string; cursor: string; missingCursor?: string; phase: 'scan' | 'missing'; startedAt: number }
export interface BackupVersion { sourceId: string; backupId: string; contentKey: string; name: string; mimeType: string; at: number; parentSourceId: string }
export interface EngineStore {
  entry(sourceId: string): Promise<BackupEntry | null>;
  saveEntry(entry: BackupEntry): Promise<void>;
  version(key: string, value: BackupVersion): Promise<void>;
  /** Persist a preallocated Drive ID BEFORE the network write. */
  intent(key: string, allocate: () => Promise<string>): Promise<string>;
  task(): Promise<ScanTask | null>;
  saveTask(task: ScanTask): Promise<void>;
  addTask(task: ScanTask): Promise<void>;
  doneTask(sourceId: string): Promise<void>;
  entriesAfter(cursor: string): Promise<BackupEntry[]>;
  event(key: string, value: { action: string; sourceId?: string; message?: string }): Promise<void>;
  saveState(state: ScanState): Promise<void>;
  count(kind: 'created' | 'updated' | 'unchanged' | 'failed' | 'retained', sourceId: string): Promise<void>;
}
export interface DrivePort {
  metadata: BackupDrive['metadata']; children: BackupDrive['children']; start: BackupDrive['start']; changes: BackupDrive['changes'];
  inRoot: BackupDrive['inRoot']; generateId: BackupDrive['generateId']; create: BackupDrive['create']; relocate: BackupDrive['relocate']; bytes: BackupDrive['bytes'];
}
export class BackupEngine {
  constructor(readonly settings: DriveBackupSettings, readonly source: DrivePort, readonly target: DrivePort, readonly store: EngineStore) {}
  private async create(key: string, parent: string, name: string, mimeType: string, bytes?: Buffer) {
    const id = await this.store.intent(key, () => this.target.generateId());
    const file = await this.target.create(id, parent, name, mimeType, { backupClient: this.settings.clientId, backupKey: key }, this.settings.backupFolderId, bytes);
    if (bytes && (file.size && Number(file.size) !== bytes.length || file.md5Checksum && file.md5Checksum !== createHash('md5').update(bytes).digest('hex'))) throw new Error('Checksum/tamaño del respaldo no coincide.');
    return file.id;
  }
  async begin(runId: string, cursor?: string, reconcile = false): Promise<ScanState | null> {
    const root = await this.source.metadata(this.settings.sourceFolderId);
    if (root.trashed || root.mimeType !== FOLDER) throw new Error('Origen eliminado o inaccesible; respaldos conservados.');
    const start = await this.source.start(root.driveId);
    if (cursor && !reconcile) {
      try {
        const changes = await this.source.changes(cursor, root.driveId);
        if (!changes.changed) return null;
      } catch (error) { if (!(error instanceof BackupDriveError && error.status === 410)) throw error; }
    }
    // Cursor captured BEFORE inventory. Events arriving during a scan are replayed next time.
    const state: ScanState = { id: runId, cursor: start, phase: 'scan', startedAt: Date.now() };
    await this.store.saveState(state);
    await this.store.addTask({ sourceId: root.id, backupId: this.settings.backupFolderId, pageToken: '', offset: 0 });
    return state;
  }
  async syncFile(file: FileMetadata, task: ScanTask, runId: string) {
    if (file.trashed) return;
    if (!file.parents?.includes(task.sourceId)) throw new Error('Pertenencia al origen no verificable.');
    await this.source.inRoot(file.id, this.settings.sourceFolderId);
    const previous = await this.store.entry(file.id);
    const contentKey = contentVersion(file);
    let backupId = previous?.backupId;
    const changed = !previous || previous.contentKey !== contentKey;
    if (file.mimeType === FOLDER) {
      backupId ||= await this.create(hash(['folder', file.id]), task.backupId, file.name, FOLDER);
      await this.target.relocate(backupId, this.settings.backupFolderId, task.backupId, file.name, this.settings.clientId);
      await this.store.addTask({ sourceId: file.id, backupId, pageToken: '', offset: 0 });
    } else if (changed) {
      const bytes = await this.source.bytes(file, this.settings.sourceFolderId);
      // Independent files, not Drive revisions subject to automatic expiry.
      const history = await this.create(hash(['history', this.settings.clientId]), this.settings.backupFolderId, '.tuto-versions', FOLDER);
      const fileHistory = await this.create(hash(['history-file', file.id]), history, file.id, FOLDER);
      // Create in history first. A crash cannot leave a new current file without a durable version reference.
      backupId = await this.create(hash(['version', file.id, contentKey]), fileHistory, file.name, exportType(file.mimeType), bytes);
      await this.store.version(hash([file.id, contentKey]), { sourceId: file.id, backupId, contentKey, name: file.name, mimeType: exportType(file.mimeType), at: Date.now(), parentSourceId: task.sourceId });
      if (previous && previous.backupId !== backupId) await this.target.relocate(previous.backupId, this.settings.backupFolderId, fileHistory, previous.name, this.settings.clientId);
      await this.target.relocate(backupId, this.settings.backupFolderId, task.backupId, file.name, this.settings.clientId);
    } else {
      await this.target.relocate(backupId!, this.settings.backupFolderId, task.backupId, file.name, this.settings.clientId);
    }
    await this.store.saveEntry({ sourceId: file.id, backupId: backupId!, name: file.name, parentSourceId: task.sourceId,
      mimeType: file.mimeType, contentKey, seenRun: runId, missing: false });
    const action = !previous ? 'created' : changed || previous.name !== file.name || previous.parentSourceId !== task.sourceId ? 'updated' : 'unchanged';
    await this.store.count(action, file.id);
    if (action !== 'unchanged') await this.store.event(hash([runId, file.id, contentKey, file.name, task.sourceId]), { action, sourceId: file.id });
  }
  /** One bounded slice; all side effects are replayable using persisted Drive IDs. */
  async step(state: ScanState, deadline: number): Promise<boolean> {
    while (Date.now() < deadline && state.phase === 'scan') {
      const task = await this.store.task();
      if (!task) { state.phase = 'missing'; await this.store.saveState(state); break; }
      let folder: FileMetadata;
      try { folder = await this.source.inRoot(task.sourceId, this.settings.sourceFolderId); }
      catch (error) {
        // A previously queued folder can disappear or move while inventory is running. Never touch its backup.
        if (task.sourceId === this.settings.sourceFolderId || !(error instanceof BackupDriveError && error.status === 404 || error instanceof Error && error.message === 'Acceso fuera del espacio autorizado.')) throw error;
        await this.store.event(hash([state.id, task.sourceId, 'inaccessible']), { action: 'retained', sourceId: task.sourceId, message: 'Carpeta movida, eliminada o sin permiso. Respaldo conservado.' });
        await this.store.doneTask(task.sourceId); continue;
      }
      if (folder.mimeType !== FOLDER) throw new Error('La carpeta de inventario cambió.');
      const page = await this.source.children(task.sourceId, task.pageToken);
      for (let offset = task.offset; offset < page.files.length; offset++) {
        if (Date.now() >= deadline) return false;
        const file = page.files[offset];
        try { await this.syncFile(file, task, state.id); }
        catch (error) {
          await this.store.count('failed', file.id);
          await this.store.event(hash([state.id, file.id, 'failed']), { action: 'error', sourceId: file.id, message: error instanceof Error ? error.message : 'Error de respaldo' });
          // Do not advance past a failed file or commit the changes token.
          throw error;
        }
        await this.store.saveTask({ ...task, offset: offset + 1 });
      }
      if (page.nextPageToken) await this.store.saveTask({ ...task, pageToken: page.nextPageToken, offset: 0 });
      else await this.store.doneTask(task.sourceId);
    }
    while (Date.now() < deadline && state.phase === 'missing') {
      const page = await this.store.entriesAfter(state.missingCursor || '');
      if (!page.length) return true;
      for (const entry of page) {
        if (entry.seenRun !== state.id && !entry.missing) {
          await this.store.saveEntry({ ...entry, missing: true });
          await this.store.count('retained', entry.sourceId);
          await this.store.event(hash([state.id, entry.sourceId, 'retained']), { action: 'retained', sourceId: entry.sourceId,
            message: 'Ausente del inventario: eliminado, movido fuera del origen o permiso perdido. Respaldo conservado.' });
        }
      }
      state.missingCursor = page[page.length - 1].sourceId; await this.store.saveState(state);
    }
    return false;
  }
}
