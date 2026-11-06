import { setTimeout as delay } from 'node:timers/promises';
import { compareSource, type Entry, PILOT } from './catalog.ts';

export const FOLDER = 'application/vnd.google-apps.folder';
export const SHEET = 'application/vnd.google-apps.spreadsheet';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileFields = 'id,name,mimeType,parents,size,version,headRevisionId,modifiedTime,md5Checksum,sha256Checksum,webViewLink,capabilities(canAddChildren,canCopy,canDownload),trashed,driveId,appProperties,ownedByMe,shared';
export interface Metadata {
  id: string; name: string; mimeType: string; parents?: string[]; size?: string; version?: string;
  headRevisionId?: string; modifiedTime?: string; md5Checksum?: string; sha256Checksum?: string;
  webViewLink?: string; driveId?: string; ownedByMe?: boolean; shared?: boolean; trashed?: boolean;
  capabilities?: { canAddChildren?: boolean; canCopy?: boolean; canDownload?: boolean };
  appProperties?: Record<string, string>;
}
const idCheck = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id)) throw new Error('ID de Drive inválido');
  return id;
};
export const q = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
class DriveError extends Error {
  constructor(readonly status: number, readonly reason: string) { super(`Drive HTTP ${status} (${reason})`); }
}
export class Drive {
  constructor(private readonly token: () => Promise<string>) {}
  private async request(path: string, params: Record<string, string>, init: RequestInit = {}) {
    const method = init.method || 'GET';
    const base = path.startsWith('upload/') ? 'https://www.googleapis.com/' : 'https://www.googleapis.com/drive/v3/';
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, {
          ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...init.headers },
          signal: AbortSignal.timeout(40_000), redirect: 'error',
        });
        if (response.ok) return response;
        const error = await response.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } };
        throw new DriveError(response.status, error.error?.errors?.[0]?.reason || 'unknown');
      } catch (error) {
        const retry = !(error instanceof DriveError) || error.status >= 500 || error.status === 429 ||
          ['rateLimitExceeded', 'userRateLimitExceeded'].includes(error.reason);
        if (method !== 'GET' || !retry || attempt >= 3) throw error;
        await delay(500 * 2 ** attempt + Math.random() * 250);
      }
    }
  }
  async metadata(id: string): Promise<Metadata> {
    return (await this.request(`files/${idCheck(id)}`, { supportsAllDrives: 'true', fields: fileFields })).json();
  }
  async list(query: string): Promise<Metadata[]> {
    const files: Metadata[] = [];
    let pageToken = '';
    do {
      const response = await this.request('files', {
        q: `trashed = false and (${query})`, pageSize: '1000', pageToken, includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true', fields: `nextPageToken,incompleteSearch,files(${fileFields})`,
      });
      const page = await response.json() as { files?: Metadata[]; incompleteSearch?: boolean; nextPageToken?: string };
      if (page.incompleteSearch) throw new Error('Drive devolvió una búsqueda incompleta');
      files.push(...(page.files || []));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async children(id: string) { return this.list(`${q(idCheck(id))} in parents`); }
  async download(file: Entry) {
    if (Number(file.size) > 35 * 1024 * 1024) throw new Error('Archivo de entrada mayor de 35 MiB');
    const native = file.mimeType === SHEET;
    const path = `files/${idCheck(file.id)}${native ? '/export' : ''}`;
    const response = await this.request(path, native ? { mimeType: XLSX } : { alt: 'media', supportsAllDrives: 'true' });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Drive devolvió un cuerpo vacío');
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 35 * 1024 * 1024) throw new Error('Entrada mayor de 35 MiB');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks, length);
  }
  async about(): Promise<{ storageQuota?: { limit?: string; usage?: string }; user?: { emailAddress?: string } }> {
    return (await this.request('about', { fields: 'storageQuota,user(emailAddress)' })).json();
  }
  async create(name: string, mimeType: string, parent: string, key: string): Promise<Metadata> {
    return this.write('files', { name, mimeType, parents: [idCheck(parent)], appProperties: { pilot: PILOT.id, key } });
  }
  async copy(file: Entry, name: string, parent: string, key: string): Promise<Metadata> {
    return this.write(`files/${idCheck(file.id)}/copy`, {
      name, parents: [idCheck(parent)], appProperties: { pilot: PILOT.id, key, sourceFileId: file.id },
    });
  }
  private async write(path: string, body: object): Promise<Metadata> {
    return (await this.request(path, { supportsAllDrives: 'true', fields: fileFields }, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json();
  }
  async upload(name: string, parent: string, key: string, type: string, bytes: Buffer): Promise<Metadata> {
    const boundary = `organizer-${key}`;
    const metadata = { name, parents: [idCheck(parent)], appProperties: { pilot: PILOT.id, key } };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return (await this.request('upload/drive/v3/files', { uploadType: 'multipart', supportsAllDrives: 'true', fields: fileFields }, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: body as unknown as BodyInit,
    })).json();
  }
  async sheets(id: string, requests?: object[]) {
    const path = `https://sheets.googleapis.com/v4/spreadsheets/${idCheck(id)}`;
    const response = await fetch(requests ? `${path}:batchUpdate` : path + '?fields=spreadsheetId,spreadsheetUrl,sheets(properties,basicFilter,conditionalFormats)', {
      method: requests ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      ...(requests ? { body: JSON.stringify({ requests }) } : {}), signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Sheets HTTP ${response.status}`);
    return response.json();
  }
}

export function entry(file: Metadata, path: string[]): Entry {
  return {
    id: file.id, name: file.name, path, parentId: file.parents?.[0] || '', mimeType: file.mimeType,
    size: file.size, version: file.version, headRevisionId: file.headRevisionId, modifiedTime: file.modifiedTime,
    md5Checksum: file.md5Checksum, sha256Checksum: file.sha256Checksum, url: file.webViewLink,
    folder: file.mimeType === FOLDER, canCopy: file.capabilities?.canCopy, canDownload: file.capabilities?.canDownload,
  };
}
export async function scan(drive: Pick<Drive, 'metadata' | 'children'>, sourceId = PILOT.sourceId) {
  const source = await drive.metadata(sourceId);
  if (source.trashed || source.mimeType !== FOLDER) throw new Error('Origen de Drive inválido');
  const found = new Map<string, Entry>();
  const pending = [{ id: source.id, path: [source.name] }];
  while (pending.length) {
    const batch = pending.splice(0, 6);
    const listings = await Promise.all(batch.map(folder => drive.children(folder.id)));
    for (const [index, files] of listings.entries()) {
      const parent = batch[index];
      for (const file of files) {
        if (file.name === PILOT.name || file.appProperties?.pilot === PILOT.id || found.has(file.id) ||
            file.id === sourceId || !file.parents?.includes(parent.id)) continue;
        const path = [...parent.path, file.name];
        found.set(file.id, { ...entry(file, path), parentId: parent.id });
        if (file.mimeType === FOLDER) pending.push({ id: file.id, path });
      }
    }
  }
  return { source, files: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
export function verifyInventory(initial: Entry[], current: Entry[]) {
  const lookup = new Map(current.map(file => [file.id, file]));
  return {
    added: current.filter(file => !initial.some(old => old.id === file.id)).map(file => file.id),
    changed: initial.filter(file => {
      const now = lookup.get(file.id);
      return !now || !compareSource(file, now);
    }).map(file => file.id),
  };
}
