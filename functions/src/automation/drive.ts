import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { defineString } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import type { AutomationInput } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { MAX_INPUT_BYTES, normalizeInputImage } from './imports';

const DRIVE_IDENTITY = defineString('AUTOMATION_DRIVE_SERVICE_ACCOUNT', { default: 'disabled' });
export const parseDriveFolderId = (value: string): string => {
  const match = typeof value === 'string' && value.match(/^(?:https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/)?([A-Za-z0-9_-]{1,200})(?:\?[^#]*)?$/);
  if (!match) throw new HttpsError('invalid-argument', 'Usa un ID o enlace de carpeta de Google Drive.');
  return match[1];
};
export interface DriveMetadata { id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean; size?: string; version?: string; headRevisionId?: string; md5Checksum?: string }
export interface DriveClient {
  metadata(fileId: string): Promise<DriveMetadata>;
  download(fileId: string, revisionId?: string): Promise<Buffer>;
  list(folderId: string): Promise<DriveMetadata[]>;
}
// Short-lived impersonation of a dedicated identity shared ONLY on configured folders.
// No private key, user impersonation, or domain-wide delegation is used.
let cachedDriveToken: { email: string; token: string; expiresAt: number } | null = null;
const driveToken = async (): Promise<string> => {
  const email = DRIVE_IDENTITY.value();
  if (!/^[\w.-]+@[\w.-]+\.iam\.gserviceaccount\.com$/.test(email)) throw new HttpsError('failed-precondition', 'Configura AUTOMATION_DRIVE_SERVICE_ACCOUNT y comparte las carpetas con esa identidad.');
  if (cachedDriveToken?.email === email && cachedDriveToken.expiresAt > Date.now() + 60000) return cachedDriveToken.token;
  const credential = admin.app().options.credential;
  if (!credential) throw new HttpsError('failed-precondition', 'Identidad de integración no disponible.');
  const { access_token } = await credential.getAccessToken();
  const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:generateAccessToken`, {
    method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/drive.readonly'], lifetime: '600s' }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new HttpsError('failed-precondition', 'No se pudo autenticar la identidad de Drive. Revisa su permiso de impersonación.');
  const token = (await response.json() as { accessToken?: string }).accessToken;
  if (!token) throw new HttpsError('failed-precondition', 'La identidad de Drive no devolvió una credencial válida.');
  cachedDriveToken = { email, token, expiresAt: Date.now() + 9 * 60000 };
  return token;
};
const driveGet = async (path: string): Promise<Response> => {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${await driveToken()}` }, signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok) throw new HttpsError('failed-precondition', 'Archivo o carpeta de Drive inaccesible, eliminado o sin permiso.');
  return response;
};
const fields = 'id,name,mimeType,parents,trashed,size,version,headRevisionId,md5Checksum';
export const googleDrive: DriveClient = {
  async metadata(id) { return (await (await driveGet(`files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${fields}`)).json()) as DriveMetadata; },
  async download(id, revision) {
    const route = revision ? `files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}?alt=media` : `files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
    const response = await driveGet(route);
    if (Number(response.headers.get('content-length')) >= MAX_INPUT_BYTES) throw new HttpsError('invalid-argument', 'Imagen Drive de más de 10 MB.');
    const reader = response.body!.getReader(); const chunks: Buffer[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size >= MAX_INPUT_BYTES) throw new HttpsError('invalid-argument', 'Imagen Drive de más de 10 MB.');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  },
  async list(folderId) {
    const files: DriveMetadata[] = []; let pageToken = '';
    do {
      const query = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, fields: `nextPageToken,files(${fields})`, pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) });
      const page = await (await driveGet(`files?${query}`)).json() as { files: DriveMetadata[]; nextPageToken?: string };
      files.push(...page.files); pageToken = page.nextPageToken || '';
      if (files.length > 1000) throw new HttpsError('resource-exhausted', 'Carpeta demasiado grande; solicita archivos por ID.');
    } while (pageToken);
    return files;
  },
};
export const validateDriveFolder = async (id: string, drive: DriveClient = googleDrive): Promise<void> => {
  const folder = await drive.metadata(id);
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') throw new HttpsError('failed-precondition', 'El ID no corresponde a una carpeta de Drive accesible.');
};
export const authorizeDriveFile = async (clientId: string, image: AutomationInput, drive: DriveClient = googleDrive): Promise<DriveMetadata> => {
  const source = image.driveFile!;
  const client = (await getAppFirestore().collection('clients').doc(clientId).get()).data();
  if (!client || client.status === 'archived' || client.automation?.enabled === false || !client.automation?.driveFolderIds?.includes(source.folderId)) throw new HttpsError('permission-denied', 'Carpeta de Drive no autorizada para este cliente.');
  await validateDriveFolder(source.folderId, drive);
  const file = await drive.metadata(source.fileId);
  if (file.trashed || !file.parents?.includes(source.folderId) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType) || Number(file.size) >= MAX_INPUT_BYTES) throw new HttpsError('permission-denied', 'La fotografía no pertenece a la carpeta autorizada o no es compatible.');
  if (source.version && file.version !== source.version) throw new HttpsError('failed-precondition', 'El archivo de Drive cambió; prepara un nuevo plan.');
  return file;
};
export const importDriveImage = async (clientId: string, uid: string, image: AutomationInput, drive: DriveClient = googleDrive): Promise<AutomationInput> => {
  const file = await authorizeDriveFile(clientId, image, drive);
  const source = image.driveFile!;
  const revision = source.revisionId || file.headRevisionId;
  if (!revision && !file.version && !file.md5Checksum) throw new HttpsError('failed-precondition', 'Drive no proporciona una versión estable para importar.');
  const key = createHash('sha256').update(JSON.stringify([clientId, source.folderId, source.fileId, revision || file.version, file.md5Checksum])).digest('hex');
  const storagePath = `garments/drafts/${uid}/drive-${key}/source/image.jpg`;
  const target = admin.storage().bucket().file(storagePath);
  if (!(await target.exists())[0]) {
    const bytes = await drive.download(source.fileId, revision);
    if (!revision) {
      const after = await authorizeDriveFile(clientId, image, drive);
      if (after.version !== file.version || after.md5Checksum !== file.md5Checksum) throw new HttpsError('failed-precondition', 'El archivo cambió durante la importación.');
    }
    await target.save(await normalizeInputImage(bytes), { resumable: false, metadata: { contentType: 'image/jpeg' } });
  }
  return { ...image, storagePath, driveFile: { ...source, ...(revision ? { revisionId: revision } : {}), ...(file.version ? { version: file.version } : {}) } };
};
