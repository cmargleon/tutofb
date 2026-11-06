import { createHash } from 'node:crypto';
import type { DriveBackupSettings } from '../../../shared/src/types/backups';

export const BACKUP_CRON = '0 9,11,13,15,17,19,21 * * 1-6';
export const BACKUP_TIMEZONE = 'America/Mexico_City';
export const FOLDER = 'application/vnd.google-apps.folder';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const checkedId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w-]{1,200}$/.test(value)) throw new Error('Identificador inválido.');
  return value;
};
export const serviceAccount = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w.-]+@[\w.-]+\.iam\.gserviceaccount\.com$/.test(value)) throw new Error('Se requiere una identidad dedicada de servicio.');
  return value;
};
export function validateSettings(input: DriveBackupSettings): DriveBackupSettings {
  if (!input || typeof input.enabled !== 'boolean' || !Array.isArray(input.operatorUids) || input.operatorUids.length > 100) throw new Error('Configuración inválida.');
  const result = { clientId: checkedId(input.clientId), sourceFolderId: checkedId(input.sourceFolderId),
    backupFolderId: checkedId(input.backupFolderId), workspaceFolderId: checkedId(input.workspaceFolderId),
    sourceReader: serviceAccount(input.sourceReader), backupWriter: serviceAccount(input.backupWriter),
    workspaceWriter: serviceAccount(input.workspaceWriter), enabled: input.enabled,
    operatorUids: [...new Set(input.operatorUids.map(checkedId))] };
  if (new Set([result.sourceFolderId, result.backupFolderId, result.workspaceFolderId]).size !== 3 ||
      new Set([result.sourceReader, result.backupWriter, result.workspaceWriter]).size !== 3) throw new Error('Las tres capas requieren carpetas e identidades distintas.');
  return result;
}
export const isBackupSlot = (date: Date, zone: string): boolean => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return parts.weekday !== 'Sun' && [9, 11, 13, 15, 17, 19, 21].includes(Number(parts.hour)) && parts.minute === '00';
};
export interface FileMetadata { id: string; name: string; mimeType: string; parents?: string[]; driveId?: string; trashed?: boolean;
  version?: string; modifiedTime?: string; md5Checksum?: string; size?: string; appProperties?: Record<string, string>; capabilities?: { canEdit?: boolean; canAddChildren?: boolean; canDownload?: boolean } }
export const contentVersion = (file: FileMetadata) => {
  const value = file.md5Checksum || file.version || file.modifiedTime;
  if (!value && file.mimeType !== FOLDER) throw new Error('No existe una versión estable del archivo.');
  return hash([file.mimeType, value || 'folder']);
};
// Export into open formats using only the source's read credential. No cross-account write or delegation.
export const EXPORT_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.drawing': 'image/svg+xml',
};
export const exportType = (mime: string) => {
  if (mime.startsWith('application/vnd.google-apps.') && mime !== FOLDER && !EXPORT_TYPES[mime]) throw new Error(`Tipo de Google Drive sin exportación segura: ${mime}`);
  return EXPORT_TYPES[mime] || mime;
};
