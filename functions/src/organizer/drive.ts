import { assertLegacyDriveDestination } from '../backups/legacyGuard';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { getOrganizerDriveToken } from '../google/drive';

export const FOLDER = 'application/vnd.google-apps.folder';
export const SHEET = 'application/vnd.google-apps.spreadsheet';
const FIELDS = 'id,name,mimeType,parents,trashed,driveId,owners(permissionId),ownedByMe,shared,version,modifiedTime,size,md5Checksum,sha256Checksum,appProperties,capabilities(canAddChildren,canCopy),webViewLink,thumbnailLink';
export const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const versionOf = (file: DriveFile) => file.version || file.sha256Checksum || file.md5Checksum || file.modifiedTime || '';
export const isImage = (file: DriveFile) => file.mimeType.startsWith('image/');
export const isWorkbook = (file: DriveFile) => file.mimeType === SHEET || /spreadsheet|ms-excel/.test(file.mimeType) || /\.xlsx?$/i.test(file.name);
export const fileUrl = (file: DriveFile) => file.webViewLink || `https://drive.google.com/open?id=${file.id}`;
const id = (value: string) => {
  if (!/^[\w-]{1,200}$/.test(value)) throw new HttpsError('invalid-argument', 'Identificador de Drive inválido.');
  return value;
};
export interface DriveFile {
  id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean;
  driveId?: string; owners?: { permissionId: string }[]; ownedByMe?: boolean; shared?: boolean;
  version?: string; modifiedTime?: string; size?: string; md5Checksum?: string; sha256Checksum?: string;
  appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean; canCopy?: boolean };
  webViewLink?: string; thumbnailLink?: string;
}
export interface DriveEntry extends DriveFile { path: string[]; sourceId: string; ancestorIds?: string[] }
export class OrganizerDriveError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(`Google Drive respondió ${status} (${reason}).`); }
}
export type DriveWriteAttempt = ((key: string) => Promise<boolean>) & { rejected?: (key: string, status: number) => Promise<void> };
export class OrganizerDrive {
  constructor(private readonly token = getOrganizerDriveToken, private readonly request = fetch, private readonly destinationGuard = assertLegacyDriveDestination) {}

  private async google(path: string, query: Record<string, string> = {}, init?: RequestInit) {
    const response = await this.request(`${path}?${new URLSearchParams(query)}`, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${await this.token(!init)}`, ...init?.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new OrganizerDriveError(response.status, body?.error?.errors?.[0]?.reason || 'unknown');
    }
    return response;
  }
  private api(path: string, query?: Record<string, string>, init?: RequestInit) {
    return this.google(`https://www.googleapis.com/drive/v3/${path}`, query, init);
  }
  async metadata(fileId: string): Promise<DriveFile> {
    return (await this.api(`files/${id(fileId)}`, { fields: FIELDS, supportsAllDrives: 'true' })).json();
  }
  async children(parent: DriveFile, pageToken = '', key?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const result = await (await this.api('files', {
      q: `'${id(parent.id)}' in parents and trashed = false${key ? ` and appProperties has { key='organizerKey' and value='${id(key)}' }` : ''}`,
      fields: `nextPageToken,incompleteSearch,files(${FIELDS})`, pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}), ...(parent.driveId ? { corpora: 'drive', driveId: id(parent.driveId) } : { corpora: 'user' }),
    })).json();
    if (result.incompleteSearch) throw new Error('Drive devolvió un inventario incompleto.');
    return result;
  }
  async startChanges(driveId?: string): Promise<string> {
    const result = await (await this.api('changes/startPageToken', { supportsAllDrives: 'true', ...(driveId ? { driveId: id(driveId) } : {}) })).json();
    if (typeof result.startPageToken !== 'string') throw new Error('Drive no devolvió un cursor de cambios.');
    return result.startPageToken;
  }
  async changes(cursor: string, driveId?: string): Promise<{ changed: boolean; cursor: string }> {
    let token = cursor;
    let changed = false;
    do {
      const result = await (await this.api('changes', { pageToken: token, pageSize: '100',
        fields: 'nextPageToken,newStartPageToken,changes(removed,fileId,file(appProperties))',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', includeRemoved: 'true',
        ...(driveId ? { driveId: id(driveId) } : {}),
      })).json();
      changed ||= (result.changes || []).some((change: { removed?: boolean; file?: DriveFile }) =>
        change.removed || !change.file?.appProperties?.organizerTenant);
      if (!result.nextPageToken) {
        if (!result.newStartPageToken) throw new Error('Drive no devolvió un cursor de reconciliación.');
        return { changed, cursor: result.newStartPageToken };
      }
      token = result.nextPageToken;
    } while (token);
    return { changed, cursor };
  }
  async lineage(fileId: string): Promise<DriveFile[]> {
    const queue = [fileId];
    const found = new Map<string, DriveFile>();
    while (queue.length) {
      const current = queue.pop()!;
      if (found.has(current)) continue;
      const file = await this.metadata(current);
      if (file.trashed) throw new HttpsError('failed-precondition', 'Un archivo o carpeta de Drive está en la papelera.');
      found.set(current, file);
      queue.push(...(file.parents || []));
    }
    return [...found.values()];
  }
  async assertSource(file: DriveEntry) {
    const chain = await this.lineage(file.id);
    let inSource = chain.some(item => item.id === file.sourceId);
    // Some delegated/shared Drive reads expose parents in files.list but omit them in files.get.
    // In that case re-prove every recorded edge by a fresh parent-membership query.
    if (!inSource && !chain[0].parents?.length && file.ancestorIds?.[0] === file.sourceId) {
      const ids = [...file.ancestorIds, file.id];
      inSource = true;
      for (let index = 0; index < ids.length - 1; index++) {
        const parent = await this.metadata(ids[index]);
        if (parent.trashed || parent.mimeType !== FOLDER || parent.appProperties?.organizerTenant) { inSource = false; break; }
        let token = ''; let found: DriveFile | undefined;
        do {
          const page = await this.children(parent, token);
          found = page.files.find(child => child.id === ids[index + 1]);
          token = page.nextPageToken || '';
        } while (!found && token);
        if (!found || found.trashed || found.appProperties?.organizerTenant || (index === ids.length - 2 && versionOf(found) !== versionOf(file))) { inSource = false; break; }
      }
    }
    if (!inSource || chain.some(item => item.appProperties?.organizerTenant) ||
        !versionOf(file) || versionOf(chain[0]) !== versionOf(file)) {
      throw new HttpsError('failed-precondition', 'El origen cambió o salió de su zona.');
    }
    return chain[0];
  }
  async thumbnail(fileId: string) {
    const file = await this.metadata(fileId);
    if (!file.thumbnailLink) return null;
    const url = new URL(file.thumbnailLink);
    if (url.protocol !== 'https:' || !/^lh[1-9]\.googleusercontent\.com$/.test(url.hostname)) return null;
    const response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${await this.token(true)}` } });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) return null;
    return this.readBytes(response, 2 * 1024 * 1024);
  }
  async sourceWorkbook(file: DriveFile): Promise<Buffer> {
    return this.bytes(file.id, 50 * 1024 * 1024);
  }
  async image(fileId: string): Promise<Buffer> {
    return this.bytes(fileId, 35 * 1024 * 1024);
  }
  private async bytes(fileId: string, limit: number) {
    return this.readBytes(await this.api(`files/${id(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }), limit);
  }
  private async readBytes(response: Response, limit: number) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Drive devolvió un archivo vacío.');
    const buffers: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return Buffer.concat(buffers, total);
        total += value.byteLength;
        if (total > limit) throw new Error('El archivo excede el tamaño permitido para su análisis.');
        buffers.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
  }
  async tabs(fileId: string): Promise<{ sheetId: number; title: string; sheetType: string; merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[] }[]> {
    const body = await (await this.google(`https://sheets.googleapis.com/v4/spreadsheets/${id(fileId)}`, {
      fields: 'sheets(properties(sheetId,title,sheetType),merges)',
    })).json();
    return (body.sheets || []).map((sheet: { properties: object; merges?: { startRowIndex?: number; startColumnIndex?: number; endRowIndex: number; endColumnIndex: number }[] }) => ({
      ...sheet.properties, merges: (sheet.merges || []).map(range => ({ s: { r: range.startRowIndex || 0, c: range.startColumnIndex || 0 },
        e: { r: range.endRowIndex - 1, c: range.endColumnIndex - 1 } })),
    }));
  }
  private async sheetValues(fileId: string, tab: string, valueRenderOption: 'FORMATTED_VALUE' | 'FORMULA'): Promise<(string | number | boolean)[][]> {
    const range = encodeURIComponent(`'${tab.replaceAll("'", "''")}'`);
    const body = await (await this.google(`https://sheets.googleapis.com/v4/spreadsheets/${id(fileId)}/values/${range}`, {
      valueRenderOption, majorDimension: 'ROWS',
    })).json();
    return (body.values || []).map((row: unknown[]) => row.map(value =>
      typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? value : ''));
  }
  async tabValues(fileId: string, tab: string): Promise<string[][]> {
    return (await this.sheetValues(fileId, tab, 'FORMATTED_VALUE')).map(row => row.map(String));
  }
  tabOriginalValues(fileId: string, tab: string) {
    return this.sheetValues(fileId, tab, 'FORMULA');
  }

  async zone(sources: string[], parentId: string, allowInheritedAccess: boolean) {
    const [parentChain, ...sourceChains] = await Promise.all([parentId, ...sources].map(value => this.lineage(value)));
    const parent = parentChain[0];
    await this.destinationGuard(parent.id, id => this.metadata(id));
    if (parent.mimeType !== FOLDER || !parent.capabilities?.canAddChildren ||
        parentChain.some(item => sources.includes(item.id) || item.appProperties?.organizerTenant) ||
        (!allowInheritedAccess && (parent.driveId || parentChain.some(item => item.shared)))) {
      throw new HttpsError('failed-precondition', 'El destino debe estar fuera de los orígenes, ser escribible y respetar la política de acceso heredado.');
    }
    for (const chain of sourceChains) {
      const source = chain[0];
      const sameDrive = source.driveId ? source.driveId === parent.driveId : !parent.driveId &&
        Boolean(source.owners?.some(owner => parent.owners?.some(other => owner.permissionId === other.permissionId)));
      if (source.mimeType !== FOLDER || !sameDrive || chain.some(item => item.appProperties?.organizerTenant) ||
          chain.slice(1).some(item => sources.includes(item.id))) {
        throw new HttpsError('failed-precondition', 'Los orígenes deben ser independientes y pertenecer al mismo Drive que el destino.');
      }
    }
    return { parent, sources: sourceChains.map(chain => chain[0]) };
  }

  private async find(parent: DriveFile, tenant: string, key: string) {
    const matches: DriveFile[] = [];
    let token = '';
    do {
      const page = await this.children(parent, token, key);
      matches.push(...page.files);
      token = page.nextPageToken || '';
    } while (token);
    if (matches.length > 1 || matches.some(file => file.appProperties?.organizerTenant !== tenant || !file.parents?.includes(parent.id))) {
      throw new HttpsError('failed-precondition', 'Se detectaron copias o carpetas administradas en conflicto.');
    }
    return matches[0];
  }
  private async createOrFind(parent: DriveFile, tenant: string, key: string, create: () => Promise<DriveFile>, attempt: DriveWriteAttempt) {
    const existing = await this.find(parent, tenant, key);
    if (existing) return existing;
    if (!await attempt(key)) throw new HttpsError('failed-precondition', 'Hay una escritura anterior sin confirmar. Verifica el destino antes de volver a intentar.');
    try { return await create(); } catch (error) {
      const reconciled = await this.find(parent, tenant, key);
      if (reconciled) return reconciled;
      if (error instanceof OrganizerDriveError && [400, 401, 403, 404, 413, 415, 422, 429].includes(error.status))
        await attempt.rejected?.(key, error.status);
      throw error;
    }
  }
  private async write(path: string, payload: object, method = 'POST', query: Record<string, string> = {}) {
    return (await this.api(path, { fields: FIELDS, supportsAllDrives: 'true', ...query }, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })).json() as Promise<DriveFile>;
  }
  async root(tenant: string, sources: string[], parentId: string, name: string, allowInherited: boolean, attempt: DriveWriteAttempt) {
    const { parent } = await this.zone(sources, parentId, allowInherited);
    const key = digest(['root', tenant, parent.id]);
    return this.createOrFind(parent, tenant, key, () => this.write('files', {
      name, mimeType: FOLDER, parents: [parent.id], appProperties: { organizerTenant: tenant, organizerKey: key },
    }), attempt);
  }
  async managed(rootId: string, parentId: string, sources: string[], tenant: string, allowedParent: string): Promise<DriveFile> {
    await this.destinationGuard(parentId, id => this.metadata(id));
    const chain = await this.lineage(parentId);
    const root = chain.find(file => file.id === rootId);
    const managedParent = chain[0];
    if (!root || root.mimeType !== FOLDER || !root.parents?.includes(allowedParent) ||
        root.appProperties?.organizerTenant !== tenant || managedParent.mimeType !== FOLDER ||
        managedParent.appProperties?.organizerTenant !== tenant || chain.some(file => sources.includes(file.id))) {
      throw new HttpsError('permission-denied', 'Escritura fuera de la carpeta administrada.');
    }
    return managedParent;
  }
  async folder(zone: ManagedZone, parentId: string, name: string, attempt: DriveWriteAttempt) {
    const parent = await this.managed(zone.root, parentId, zone.sources, zone.tenant, zone.parent);
    const key = digest(['folder', parent.id, name]);
    return this.createOrFind(parent, zone.tenant, key, () => this.write('files', {
      name, mimeType: FOLDER, parents: [parent.id], appProperties: { organizerTenant: zone.tenant, organizerKey: key },
    }), attempt);
  }
  async copy(zone: ManagedZone, parentId: string, file: DriveEntry, attempt: DriveWriteAttempt) {
    const [parent, original] = await Promise.all([
      this.managed(zone.root, parentId, zone.sources, zone.tenant, zone.parent), this.assertSource(file),
    ]);
    if (!zone.sources.includes(file.sourceId) || original.capabilities?.canCopy === false) {
      throw new HttpsError('failed-precondition', 'El origen cambió, salió de su zona o no permite copias.');
    }
    const key = digest(['copy', file.id, versionOf(file)]);
    const copied = await this.createOrFind(parent, zone.tenant, key, () => this.write(`files/${id(file.id)}/copy`, {
      name: file.name, parents: [parent.id], appProperties: { organizerTenant: zone.tenant, organizerKey: key },
    }), attempt);
    await this.assertSource(file);
    return this.verifyCopy(copied.id, parent.id, file, zone.tenant);
  }
  async verifyCopy(copyId: string, parentId: string, file: DriveEntry, tenant: string) {
    const copy = await this.metadata(copyId);
    if (copy.id === file.id || copy.trashed || !copy.parents?.includes(parentId) || copy.mimeType !== file.mimeType ||
        copy.appProperties?.organizerTenant !== tenant || copy.appProperties?.organizerKey !== digest(['copy', file.id, versionOf(file)]) ||
        (file.size && copy.size !== file.size) || (file.sha256Checksum && file.sha256Checksum !== copy.sha256Checksum) ||
        (file.md5Checksum && file.md5Checksum !== copy.md5Checksum)) throw new Error('La copia no pudo verificarse.');
    return { id: copy.id, url: fileUrl(copy), verification: file.sha256Checksum ? 'sha256' : file.md5Checksum ? 'md5' : file.size ? 'size_mime' : 'metadata' };
  }
  async moveCopy(zone: ManagedZone, copyId: string, file: DriveEntry, parentId: string) {
    const [copy, parent] = await Promise.all([this.metadata(copyId), this.managed(zone.root, parentId, zone.sources, zone.tenant, zone.parent)]);
    const current = copy.parents?.[0];
    if (!current || copyId === file.id || copy.trashed || copy.appProperties?.organizerTenant !== zone.tenant ||
        copy.appProperties?.organizerKey !== digest(['copy', file.id, versionOf(file)])) {
      throw new HttpsError('permission-denied', 'El archivo no es una copia administrada de esta versión.');
    }
    await this.managed(zone.root, current, zone.sources, zone.tenant, zone.parent);
    if (current !== parent.id) await this.write(`files/${id(copyId)}`, {}, 'PATCH', { addParents: parent.id, removeParents: current });
    return this.verifyCopy(copyId, parent.id, file, zone.tenant);
  }
  async report(zone: ManagedZone, parentId: string, key: string, name: string, mimeType: string, bytes: Buffer, attempt: DriveWriteAttempt) {
    const parent = await this.managed(zone.root, parentId, zone.sources, zone.tenant, zone.parent);
    return this.createOrFind(parent, zone.tenant, key, async () => {
      const boundary = `organizer-${key}`;
      const metadata = { name, mimeType, parents: [parent.id], appProperties: { organizerTenant: zone.tenant, organizerKey: key } };
      const mediaType = mimeType === SHEET ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : mimeType;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return (await this.google('https://www.googleapis.com/upload/drive/v3/files', {
        uploadType: 'multipart', supportsAllDrives: 'true', fields: FIELDS,
      }, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as unknown as BodyInit })).json();
    }, attempt);
  }
}
export interface ManagedZone { tenant: string; root: string; parent: string; sources: string[] }
