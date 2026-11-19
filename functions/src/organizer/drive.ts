import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { getOrganizerDriveToken } from '../google/drive';

export const FOLDER = 'application/vnd.google-apps.folder';
export const SHEET = 'application/vnd.google-apps.spreadsheet';
const FIELDS = 'id,name,mimeType,parents,trashed,driveId,owners(permissionId),ownedByMe,shared,version,modifiedTime,size,md5Checksum,sha256Checksum,appProperties,capabilities(canAddChildren,canCopy),webViewLink,thumbnailLink';
export const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const versionOf = (file: DriveFile) => file.version || file.sha256Checksum || file.md5Checksum || file.modifiedTime || '';
export const isImage = (file: DriveFile) => file.mimeType.startsWith('image/');
export const isWorkbook = (file: DriveFile) => file.mimeType === SHEET || /spreadsheet|ms-excel/.test(file.mimeType) || /\.(?:xls|xlsx|xlsm)$/i.test(file.name);
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
export class OrganizerDrive {
  constructor(private readonly token = getOrganizerDriveToken, private readonly request = fetch) {}

  private async google(path: string, query: Record<string, string> = {}) {
    const response = await this.request(`${path}?${new URLSearchParams(query)}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new OrganizerDriveError(response.status, body?.error?.errors?.[0]?.reason || 'unknown');
    }
    return response;
  }
  private api(path: string, query?: Record<string, string>) {
    return this.google(`https://www.googleapis.com/drive/v3/${path}`, query);
  }
  async metadata(fileId: string): Promise<DriveFile> {
    return (await this.api(`files/${id(fileId)}`, { fields: FIELDS, supportsAllDrives: 'true' })).json();
  }
  async children(parent: DriveFile, pageToken = ''): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
    const result = await (await this.api('files', {
      q: `'${id(parent.id)}' in parents and trashed = false`,
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
        !versionOf(file) || versionOf(chain[0]) !== versionOf(file) ||
        (file.md5Checksum && chain[0].md5Checksum !== file.md5Checksum) ||
        (file.sha256Checksum && chain[0].sha256Checksum !== file.sha256Checksum)) {
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
      headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) return null;
    return this.readBytes(response, 2 * 1024 * 1024);
  }
  async sourceWorkbook(file: DriveFile): Promise<Buffer> {
    return this.bytes(file.id, 50 * 1024 * 1024);
  }
  async image(fileId: string): Promise<Buffer> {
    return this.bytes(fileId, 35 * 1024 * 1024);
  }
  async sourceImage(file: DriveEntry): Promise<Buffer> {
    await this.assertSource(file);
    const bytes = await this.image(file.id);
    await this.assertSource(file);
    for (const [algorithm, expected] of [['sha256', file.sha256Checksum], ['md5', file.md5Checksum]] as const) {
      if (expected && createHash(algorithm).update(bytes).digest('hex') !== expected)
        throw new HttpsError('failed-precondition', 'El contenido del original no coincide con la versión inventariada.');
    }
    return bytes;
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

  private async sourceChains(sources: string[]) {
    const chains = await Promise.all(sources.map(source => this.lineage(source)));
    for (const chain of chains) if (chain[0].mimeType !== FOLDER || chain.some(item => item.appProperties?.organizerTenant) ||
      chain.slice(1).some(item => sources.includes(item.id))) {
      throw new HttpsError('failed-precondition', 'Los orígenes deben ser carpetas independientes y fuera del espacio administrado.');
    }
    return chains;
  }

  async originals(sources: string[]) {
    return (await this.sourceChains(sources)).map(chain => chain[0]);
  }

}
