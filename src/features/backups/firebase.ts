import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { DriveBackupRequest, DriveBackupResponse, DriveBackupStatus } from '../../../shared/src/types/backups';
import { db, functions } from '../../firebase';
export const subscribeBackups = (next: (items: DriveBackupStatus[]) => void, error: (error: Error) => void) =>
  onSnapshot(collection(db, 'driveBackups'), snapshot => next(snapshot.docs.map(d => ({ ...d.data(), clientId: d.id } as DriveBackupStatus))), error);
export const manageBackup = async (data: DriveBackupRequest) =>
  (await httpsCallable<DriveBackupRequest, DriveBackupResponse>(functions, 'manageDriveBackup')(data)).data;
export interface BackupAudit { id: string; action: string; at: number; message?: string }
export const subscribeBackupAudit = (clientId: string, next: (items: BackupAudit[]) => void, error: (error: Error) => void) =>
  onSnapshot(query(collection(db, 'driveBackups', clientId, 'audit'), orderBy('at', 'desc'), limit(20)), snapshot => next(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as BackupAudit))), error);
export interface BackupFile { sourceId: string; name: string; mimeType: string; missing?: boolean }
export interface BackupFileVersion { id: string; sourceId: string; name: string; at: number }
export interface BackupRestore { id: string; status: string; at: number; completedAt?: number }
export const subscribeBackupFiles = (clientId: string, next: (items: BackupFile[]) => void, error: (error: Error) => void) =>
  onSnapshot(query(collection(db, 'driveBackups', clientId, 'entries'), limit(100)), snapshot => next(snapshot.docs.map(d => d.data() as BackupFile)), error);
export const subscribeBackupVersions = (clientId: string, next: (items: BackupFileVersion[]) => void, error: (error: Error) => void) =>
  onSnapshot(query(collection(db, 'driveBackups', clientId, 'versions'), orderBy('at', 'desc'), limit(100)), snapshot => next(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as BackupFileVersion))), error);
export const subscribeBackupRestores = (clientId: string, next: (items: BackupRestore[]) => void, error: (error: Error) => void) =>
  onSnapshot(query(collection(db, 'driveBackups', clientId, 'restores'), orderBy('at', 'desc'), limit(10)), snapshot => next(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as BackupRestore))), error);
