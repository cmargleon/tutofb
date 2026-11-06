/** Server-managed Drive safety boundary. Credentials never cross this contract. */
export interface DriveBackupSettings {
  clientId: string;
  sourceFolderId: string;
  backupFolderId: string;
  workspaceFolderId: string;
  sourceReader: string;
  backupWriter: string;
  workspaceWriter: string;
  operatorUids: string[];
  enabled: boolean;
}
export interface DriveBackupStatus extends DriveBackupSettings {
  status: 'disabled' | 'idle' | 'running' | 'error';
  timeZone?: string;
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastReconcileAt?: number;
  lastError?: string | null;
  counts?: { created: number; updated: number; unchanged: number; failed: number; retained: number };
}
export type DriveBackupRequest =
  | { action: 'configure'; settings: DriveBackupSettings }
  | { action: 'sync'; clientId: string }
  | { action: 'restore'; clientId: string; sourceFileId?: string; versionKey?: string; requestId: string };
export interface DriveBackupResponse { accepted: boolean; message: string }
export interface DriveWorkspaceRequest {
  clientId: string;
  action: 'list' | 'read' | 'create' | 'update' | 'trash';
  fileId?: string;
  parentId?: string;
  name?: string;
  mimeType?: string;
  base64?: string;
  requestId?: string;
}
export interface DriveWorkspaceResponse {
  files?: { id: string; name: string; mimeType: string }[];
  fileId?: string;
  base64?: string;
}
