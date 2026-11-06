import type { DriveBackupSettings } from '../../../shared/src/types/backups';
import { BackupDrive, BackupDriveError } from './drive';
import { FOLDER } from './policy';

export async function assertIsolation(settings: DriveBackupSettings, custodians: string[], make = (email: string, readOnly: boolean) => new BackupDrive(email, readOnly)) {
  if (!custodians.length) throw new Error('Configura DRIVE_BACKUP_CUSTODIANS con la cuenta independiente de Tuto.');
  const source = make(settings.sourceReader, true);
  const target = make(settings.backupWriter, false);
  const workspace = make(settings.workspaceWriter, false);
  const [original, backup, work] = await Promise.all([
    source.metadata(settings.sourceFolderId), target.metadata(settings.backupFolderId), workspace.metadata(settings.workspaceFolderId),
  ]);
  if ([original, backup, work].some(f => f.trashed || f.mimeType !== FOLDER) || original.capabilities?.canEdit !== false ||
      !backup.capabilities?.canAddChildren || !work.capabilities?.canAddChildren) throw new Error('Se requiere origen lector y destinos editables.');
  // Separate Shared Drive roots: no ambiguous My Drive ownership/quota or inherited parent access.
  if (backup.driveId !== backup.id || work.driveId !== work.id || backup.driveId === work.driveId ||
      original.driveId && [backup.driveId, work.driveId].includes(original.driveId)) throw new Error('Respaldo y trabajo requieren raíces de unidades compartidas independientes.');
  for (const [drive, forbidden] of [[workspace, settings.sourceFolderId], [workspace, settings.backupFolderId],
    [target, settings.sourceFolderId], [target, settings.workspaceFolderId], [source, settings.backupFolderId], [source, settings.workspaceFolderId]] as const) {
    try { await drive.metadata(forbidden); }
    catch (error) { if (error instanceof BackupDriveError && error.status === 404) continue; throw error; }
    throw new Error('Una identidad puede acceder a otra capa; separa los permisos antes de activar.');
  }
  const sourcePermissions = await source.permissions(original.id);
  if (!sourcePermissions.some(p => p.emailAddress?.toLowerCase() === settings.sourceReader && p.role === 'reader') ||
      sourcePermissions.some(p => p.emailAddress?.toLowerCase() === settings.sourceReader && p.role !== 'reader'))
    throw new Error('La identidad de origen debe tener un permiso lector verificable, incluso fuera del scope OAuth.');
  const backupPermissions = await target.permissions(backup.id);
  const allowed = new Set([settings.backupWriter, ...custodians].map(s => s.toLowerCase()));
  if (!backupPermissions.some(p => p.emailAddress?.toLowerCase() === settings.backupWriter && p.role === 'fileOrganizer') ||
      backupPermissions.some(p => !p.deleted && (p.type !== 'user' || !p.emailAddress || !allowed.has(p.emailAddress.toLowerCase()))))
    throw new Error('El respaldo solo admite la identidad de respaldo como gestor de contenido y custodios explícitos; sin grupos, dominios ni agentes.');
  const workPermissions = await workspace.permissions(work.id);
  const workAllowed = new Set([settings.workspaceWriter, ...custodians].map(s => s.toLowerCase()));
  if (!workPermissions.some(p => p.emailAddress?.toLowerCase() === settings.workspaceWriter && p.role === 'fileOrganizer') || workPermissions.some(p => !p.deleted && (p.type !== 'user' || !p.emailAddress || !workAllowed.has(p.emailAddress.toLowerCase()))))
    throw new Error('La unidad de trabajo contiene identidades no autorizadas.');
}
