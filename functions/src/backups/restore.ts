import type { DriveBackupSettings } from '../../../shared/src/types/backups';
import type { BackupEntry, DrivePort } from './engine';
import { FOLDER, hash } from './policy';

export interface RestoreStore {
  intent(key: string, allocate: () => Promise<string>): Promise<string>;
  entriesAfter(cursor: string): Promise<BackupEntry[]>;
  entry(sourceId: string): Promise<BackupEntry | null>;
}
/** Additive restore. A request never overwrites or deletes workspace data. */
export async function restoreEntry(settings: DriveBackupSettings, entry: BackupEntry, requestId: string, backup: DrivePort, work: DrivePort,
  store: RestoreStore, restored = new Map<string, string>(), ancestors = new Set<string>()): Promise<string> {
  if (ancestors.has(entry.sourceId)) throw new Error('Jerarquía de respaldo cíclica.');
  const nextAncestors = new Set([...ancestors, entry.sourceId]);
  const cached = restored.get(entry.sourceId);
  if (cached) return cached;
  let parent = settings.workspaceFolderId;
  if (entry.parentSourceId !== settings.sourceFolderId) {
    const parentEntry = await store.entry(entry.parentSourceId);
    if (!parentEntry || parentEntry.mimeType !== FOLDER) throw new Error('Falta el directorio padre en el manifiesto.');
    parent = await restoreEntry(settings, parentEntry, requestId, backup, work, store, restored, nextAncestors);
  }
  // A separate restoration directory isolates retries and preserves any pre-existing workspace files.
  if (parent === settings.workspaceFolderId) {
    const key = hash(['restore-root', settings.clientId, requestId]);
    const id = await store.intent(key, () => work.generateId());
    parent = (await work.create(id, parent, `Restauración ${requestId}`, FOLDER,
      { backupClient: settings.clientId, backupKey: key }, settings.workspaceFolderId)).id;
  }
  const file = await backup.inRoot(entry.backupId, settings.backupFolderId);
  const bytes = file.mimeType === FOLDER ? undefined : await backup.bytes(file, settings.backupFolderId);
  const key = hash(['restore', settings.clientId, requestId, entry.sourceId, entry.contentKey]);
  const id = await store.intent(key, () => work.generateId());
  const result = await work.create(id, parent, entry.name, file.mimeType, { backupClient: settings.clientId, backupKey: key }, settings.workspaceFolderId, bytes);
  restored.set(entry.sourceId, result.id);
  return result.id;
}
