import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { checkedId, contentVersion, exportType, FOLDER, serviceAccount, type FileMetadata } from './policy';

const BASE = 'https://www.googleapis.com/drive/v3/';
const FIELDS = 'id,name,mimeType,parents,driveId,trashed,version,modifiedTime,md5Checksum,size,appProperties,capabilities(canEdit,canAddChildren,canDownload)';
export class BackupDriveError extends Error {
  constructor(readonly status: number, readonly reason = '') { super(`Drive ${status}${reason ? ` (${reason})` : ''}`); }
}
const tokens = new Map<string, { value: string; until: number }>();
export async function identityToken(email: string, readonly: boolean): Promise<string> {
  serviceAccount(email);
  const key = `${email}:${readonly}`;
  const cached = tokens.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const credential = admin.app().options.credential;
  if (!credential) throw new Error('Identidad de ejecución no disponible.');
  const access = await credential.getAccessToken();
  const response = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`, {
    method: 'POST', headers: { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: [`https://www.googleapis.com/auth/drive${readonly ? '.readonly' : ''}`], lifetime: '600s' }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Impersonación denegada; verifica IAM de la identidad dedicada.');
  const value = (await response.json() as { accessToken: string }).accessToken;
  if (!value) throw new Error('Token ausente.');
  tokens.set(key, { value, until: Date.now() + 8 * 60000 });
  return value;
}
export class BackupDrive {
  constructor(readonly email: string, protected readonly readOnly: boolean, protected readonly token = identityToken, protected readonly request = fetch) {}
  // Deliberately no DELETE, permission mutation, source copy, arbitrary URL, or arbitrary PATCH API.
  protected async api(path: string, query: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
    if (this.readOnly && init.method && init.method !== 'GET') throw new Error('Origen de solo lectura.');
    for (let attempt = 0; ; attempt++) {
      const response = await this.request(`${BASE}${path}?${new URLSearchParams({ supportsAllDrives: 'true', ...query })}`, {
        ...init, headers: { Authorization: `Bearer ${await this.token(this.email, this.readOnly)}`, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(60000),
      });
      if (response.ok) return response;
      const body = await response.json().catch(() => null) as { error?: { errors?: { reason: string }[] } } | null;
      const reason = body?.error?.errors?.[0]?.reason || '';
      if (attempt >= 3 || !(response.status === 429 || response.status >= 500 || ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason))) throw new BackupDriveError(response.status, reason);
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  async metadata(fileId: string): Promise<FileMetadata> { return (await this.api(`files/${checkedId(fileId)}`, { fields: FIELDS })).json() as Promise<FileMetadata>; }
  async maybe(fileId: string) {
    try { return await this.metadata(fileId); } catch (e) { if (e instanceof BackupDriveError && e.status === 404) return null; throw e; }
  }
  async children(parent: string, pageToken = ''): Promise<{ files: FileMetadata[]; nextPageToken?: string }> {
    const result = await (await this.api('files', { q: `'${checkedId(parent)}' in parents and trashed=false`, pageSize: '100',
      fields: `files(${FIELDS}),nextPageToken,incompleteSearch`, includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })).json();
    if (result.incompleteSearch) throw new Error('Inventario incompleto; cursor conservado.');
    return result;
  }
  async start(driveId?: string): Promise<string> {
    const body = await (await this.api('changes/startPageToken', driveId ? { driveId: checkedId(driveId) } : {})).json();
    if (!body.startPageToken) throw new Error('Cursor ausente.');
    return body.startPageToken;
  }
  async changes(cursor: string, driveId?: string): Promise<{ changed: boolean; cursor: string }> {
    let changed = false;
    for (let pages = 0; pages < 500; pages++) {
      const page = await (await this.api('changes', { pageToken: cursor, pageSize: '1000', fields: 'nextPageToken,newStartPageToken,changes(fileId,removed)',
        includeItemsFromAllDrives: 'true', includeRemoved: 'true', ...(driveId ? { driveId: checkedId(driveId) } : {}) })).json();
      changed ||= Boolean(page.changes?.length);
      if (!page.nextPageToken) {
        if (!page.newStartPageToken) throw new Error('Cursor incremental ausente.');
        return { changed, cursor: page.newStartPageToken };
      }
      cursor = page.nextPageToken;
    }
    throw new Error('Demasiadas páginas de cambios; reconciliación requerida.');
  }
  async inRoot(fileId: string, root: string): Promise<FileMetadata> {
    const file = await this.metadata(fileId);
    let current = file;
    const seen = new Set<string>();
    for (let depth = 0; depth < 100; depth++) {
      if (current.trashed) throw new Error('Archivo en papelera.');
      if (current.id === root) return file;
      if (seen.has(current.id) || current.parents?.length !== 1) break;
      seen.add(current.id); current = await this.metadata(current.parents[0]);
    }
    throw new Error('Acceso fuera del espacio autorizado.');
  }
  async generateId(): Promise<string> {
    const result = await (await this.api('files/generateIds', { count: '1', space: 'drive', type: 'files' })).json();
    return checkedId(result.ids?.[0]);
  }
  async create(id: string, parent: string, name: string, mimeType: string, properties: Record<string, string>, root: string, bytes?: Buffer) {
    if (this.readOnly) throw new Error('Origen de solo lectura.');
    await this.inRoot(parent, root);
    const prior = await this.maybe(id);
    if (prior) {
      await this.inRoot(id, root);
      if (prior.appProperties?.backupKey !== properties.backupKey || prior.appProperties?.backupClient !== properties.backupClient || prior.mimeType !== mimeType) throw new Error('Conflicto de identidad de copia.');
      return prior;
    }
    const metadata = { id: checkedId(id), parents: [checkedId(parent)], name, mimeType, appProperties: properties };
    try {
      if (!bytes) await this.api('files', { fields: FIELDS }, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
      else {
        // Resumable upload with a preallocated ID: replay cannot create a second file after an ambiguous timeout.
        const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
          method: 'POST', headers: { Authorization: `Bearer ${await this.token(this.email, false)}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mimeType },
          body: JSON.stringify(metadata), redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new BackupDriveError(response.status);
        const location = response.headers.get('location');
        if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('URL de carga inválida.');
        const upload = await this.request(location, { method: 'PUT', headers: { Authorization: `Bearer ${await this.token(this.email, false)}`, 'Content-Type': mimeType },
          body: bytes as unknown as BodyInit, redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (!upload.ok) throw new BackupDriveError(upload.status);
      }
    } catch (error) {
      const existing = await this.maybe(id);
      if (!existing || existing.trashed || !existing.parents?.includes(parent) || existing.appProperties?.backupKey !== properties.backupKey) throw error;
    }
    const created = await this.inRoot(id, root);
    if (created.mimeType !== mimeType || created.appProperties?.backupKey !== properties.backupKey) throw new Error('Copia no verificable.');
    return created;
  }
  async relocate(fileId: string, root: string, parent: string, name: string, tenant: string) {
    if (this.readOnly) throw new Error('Origen de solo lectura.');
    const [file] = await Promise.all([this.inRoot(fileId, root), this.inRoot(parent, root)]);
    if (fileId === root || file.appProperties?.backupClient !== tenant || !file.parents?.length) throw new Error('Destino no administrado.');
    if (file.name === name && file.parents.includes(parent)) return;
    await this.api(`files/${checkedId(fileId)}`, { addParents: parent, removeParents: file.parents.filter(p => p !== parent).join(',') }, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  }
  async bytes(file: FileMetadata, root: string, limit = 100 * 1024 * 1024): Promise<Buffer> {
    const current = await this.inRoot(file.id, root);
    if (contentVersion(current) !== contentVersion(file) || current.capabilities?.canDownload === false) throw new Error('Origen cambió o no permite descargar.');
    const mime = exportType(file.mimeType);
    if (Number(file.size) > limit) throw new Error('Archivo supera 100 MiB; respaldo pendiente, requiere transferencia por streaming.');
    const response = await this.api(`files/${checkedId(file.id)}${mime !== file.mimeType ? '/export' : ''}`, mime !== file.mimeType ? { mimeType: mime } : { alt: 'media' });
    const chunks: Buffer[] = []; let size = 0;
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) { stream.destroy(); throw new Error('Archivo supera el límite seguro de transferencia.'); }
      chunks.push(Buffer.from(chunk));
    }
    const after = await this.inRoot(file.id, root);
    if (contentVersion(after) !== contentVersion(file)) throw new Error('Origen cambió durante la lectura; se reintentará.');
    const bytes = Buffer.concat(chunks, size);
    if (file.md5Checksum && createHash('md5').update(bytes).digest('hex') !== file.md5Checksum) throw new Error('Checksum del origen no coincide; cursor conservado.');
    return bytes;
  }
  async permissions(fileId: string): Promise<{ type: string; role: string; emailAddress?: string; deleted?: boolean }[]> {
    const permissions: { type: string; role: string; emailAddress?: string; deleted?: boolean }[] = [];
    let pageToken = '';
    do {
      const page = await (await this.api(`files/${checkedId(fileId)}/permissions`, { fields: 'nextPageToken,permissions(type,role,emailAddress,deleted)', pageSize: '100', ...(pageToken ? { pageToken } : {}) })).json();
      permissions.push(...page.permissions); pageToken = page.nextPageToken || '';
    } while (pageToken);
    return permissions;
  }
}
// This class is bound only to the workspace runtime; the backup engine never receives this capability.
export class WorkspaceDrive extends BackupDrive {
  async replaceWorkspace(fileId: string, root: string, bytes: Buffer, mimeType: string) {
    if (this.readOnly) throw new Error('Solo lectura.');
    await this.inRoot(fileId, root);
    if (fileId === root) throw new Error('Raíz protegida.');
    const response = await this.request(`https://www.googleapis.com/upload/drive/v3/files/${checkedId(fileId)}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${await this.token(this.email, false)}`, 'Content-Type': mimeType }, body: bytes as unknown as BodyInit,
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new BackupDriveError(response.status);
  }
  async trashWorkspace(fileId: string, root: string) {
    if (this.readOnly || fileId === root) throw new Error('Raíz protegida.');
    await this.inRoot(fileId, root);
    await this.api(`files/${checkedId(fileId)}`, {}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
}
export { FOLDER };
