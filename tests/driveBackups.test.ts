import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DriveBackupSettings } from '../shared/src/types/backups';
import type { BackupEntry, BackupVersion, EngineStore, ScanState, ScanTask, DrivePort } from '../functions/src/backups/engine';
import type { FileMetadata } from '../functions/src/backups/policy';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { BackupEngine } = require('./lib/functions/src/backups/engine.js') as typeof import('../functions/src/backups/engine');
const { BackupDrive, WorkspaceDrive, BackupDriveError } = require('./lib/functions/src/backups/drive.js') as typeof import('../functions/src/backups/drive');
const { restoreEntry } = require('./lib/functions/src/backups/restore.js') as typeof import('../functions/src/backups/restore');
const { assertIsolation } = require('./lib/functions/src/backups/isolation.js') as typeof import('../functions/src/backups/isolation');
const { FOLDER, BACKUP_CRON, isBackupSlot, validateSettings, exportType } = require('./lib/functions/src/backups/policy.js') as typeof import('../functions/src/backups/policy');
const settings: DriveBackupSettings = { clientId: 'fixture', sourceFolderId: 'source', backupFolderId: 'backup', workspaceFolderId: 'workspace',
  sourceReader: 'reader@test.iam.gserviceaccount.com', backupWriter: 'backup@test.iam.gserviceaccount.com', workspaceWriter: 'work@test.iam.gserviceaccount.com', enabled: true, operatorUids: ['operator'] };
class MemoryStore implements EngineStore {
  entries = new Map<string, BackupEntry>(); versions = new Map<string, BackupVersion>(); intents = new Map<string, string>();
  tasks = new Map<string, ScanTask & { done?: boolean }>(); events: unknown[] = []; state: ScanState | null = null; counts: string[] = [];
  async entry(id: string) { return this.entries.get(id) || null; }
  async saveEntry(entry: BackupEntry) { this.entries.set(entry.sourceId, structuredClone(entry)); }
  async version(key: string, value: BackupVersion) { if (!this.versions.has(key)) this.versions.set(key, value); }
  async intent(key: string, allocate: () => Promise<string>) { if (!this.intents.has(key)) this.intents.set(key, await allocate()); return this.intents.get(key)!; }
  async task() { return [...this.tasks.values()].find(t => !t.done) || null; }
  async saveTask(task: ScanTask) { this.tasks.set(task.sourceId, structuredClone(task)); }
  async addTask(task: ScanTask) { if (!this.tasks.has(task.sourceId)) await this.saveTask(task); }
  async doneTask(id: string) { this.tasks.get(id)!.done = true; }
  async entriesAfter(cursor: string) { return [...this.entries.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)).filter(e => e.sourceId > cursor).slice(0, 2); }
  async event(_key: string, value: unknown) { this.events.push(value); }
  async saveState(state: ScanState) { this.state = structuredClone(state); }
  async count(kind: string) { this.counts.push(kind); }
  newRun() { this.tasks.clear(); }
}
class MemoryDrive implements DrivePort {
  files = new Map<string, FileMetadata>(); data = new Map<string, Buffer>(); writes: string[] = []; reads = 0; serial = 0; change = true; crash = false;
  constructor(readonly root: string, readonly readonly = false) { this.put(root, FOLDER); }
  put(id: string, mimeType: string, parent?: string, body = id, name = id) {
    this.files.set(id, { id, name, mimeType, parents: parent ? [parent] : [], version: String(++this.serial), ...(mimeType !== FOLDER ? { md5Checksum: createHash('md5').update(body).digest('hex'), size: String(Buffer.byteLength(body)) } : {}) });
    this.data.set(id, Buffer.from(body));
  }
  async metadata(id: string): Promise<FileMetadata> { const file = this.files.get(id); if (!file || file.trashed) throw new BackupDriveError(404); return structuredClone(file); }
  async children(parent: string) { return { files: [...this.files.values()].filter(f => !f.trashed && f.parents?.includes(parent)).map(f => structuredClone(f)) }; }
  async start() { return String(this.serial); }
  async changes() { return { changed: this.change, cursor: String(this.serial) }; }
  async inRoot(id: string, root: string) { const file = await this.metadata(id); let f = file; const seen = new Set<string>();
    while (f.id !== root) { if (!f.parents?.[0] || seen.has(f.id)) throw Error('Acceso fuera del espacio autorizado.'); seen.add(f.id); f = await this.metadata(f.parents[0]); } return file; }
  async generateId() { return `${this.root}-${++this.serial}`; }
  async create(id: string, parent: string, name: string, mimeType: string, appProperties: Record<string, string>, root: string, bytes?: Buffer) {
    assert.equal(this.readonly, false); await this.inRoot(parent, root);
    if (this.files.has(id)) { assert.equal(this.files.get(id)!.appProperties!.backupKey, appProperties.backupKey); return this.metadata(id); }
    this.put(id, mimeType, parent, bytes?.toString() || '', name); this.files.get(id)!.appProperties = appProperties;
    this.writes.push(`create:${id}`);
    if (this.crash && bytes) { this.crash = false; throw Error('Process stopped after Drive commit'); }
    return this.metadata(id);
  }
  async relocate(id: string, root: string, parent: string, name: string) { assert.equal(this.readonly, false); await this.inRoot(id, root); await this.inRoot(parent, root); this.files.get(id)!.parents = [parent]; this.files.get(id)!.name = name; }
  async bytes(file: FileMetadata, root: string) { await this.inRoot(file.id, root); this.reads++; return this.data.get(file.id)!; }
}
const fixture = () => { const source = new MemoryDrive('source', true); const target = new MemoryDrive('backup'); const store = new MemoryStore(); return { source, target, store, engine: new BackupEngine(settings, source, target, store) }; };
async function scan(f: ReturnType<typeof fixture>, id: string) { f.store.newRun(); const state = await f.engine.begin(id); assert.ok(state); assert.equal(await f.engine.step(state, Date.now() + 60000), true); return state; }

test('initial full copy preserves names and hierarchy; repeated and unchanged executions do not recopy', async () => {
  const f = fixture(); f.source.put('dir', FOLDER, 'source', '', 'Catálogo'); f.source.put('file', 'text/plain', 'dir', 'first', 'hola.txt');
  await scan(f, 'run1'); assert.equal(f.store.entries.size, 2); assert.equal(f.store.versions.size, 1);
  const folder = f.store.entries.get('dir')!; const file = f.store.entries.get('file')!;
  assert.equal(f.target.files.get(file.backupId)!.parents![0], folder.backupId); assert.equal(f.target.files.get(file.backupId)!.name, 'hola.txt');
  const writes = f.target.writes.length; await scan(f, 'run2'); assert.equal(f.target.writes.length, writes); assert.equal(f.source.reads, 1); assert.equal(f.source.writes.length, 0);
  f.source.change = false; assert.equal(await f.engine.begin('empty', 'old-cursor'), null);
});
test('updates preserve prior bytes and versions; rename and move update only the mirror location', async () => {
  const f = fixture(); f.source.put('dir', FOLDER, 'source'); f.source.put('file', 'text/plain', 'source', 'one'); await scan(f, 'first');
  const old = f.store.entries.get('file')!.backupId;
  f.source.put('file', 'text/plain', 'dir', 'two', 'renamed'); await scan(f, 'second');
  const latest = f.store.entries.get('file')!; assert.notEqual(latest.backupId, old); assert.equal(f.target.data.get(old)!.toString(), 'one'); assert.equal(f.store.versions.size, 2);
  assert.equal(f.target.files.get(latest.backupId)!.parents![0], f.store.entries.get('dir')!.backupId);
  f.source.files.get('file')!.parents = ['source']; f.source.files.get('file')!.name = 'third'; const reads = f.source.reads; await scan(f, 'third');
  assert.equal(f.source.reads, reads); assert.equal(f.target.files.get(latest.backupId)!.name, 'third'); assert.equal(f.store.versions.size, 2);
});
test('deleted original files and entire folders remain recoverable, including all backed-up descendants', async () => {
  const f = fixture(); f.source.put('dir', FOLDER, 'source'); f.source.put('file', 'text/plain', 'dir', 'keep'); await scan(f, 'first');
  const before = structuredClone([...f.target.files]); f.source.files.get('dir')!.trashed = true; await scan(f, 'deleted');
  assert.deepEqual([...f.target.files], before); assert.equal(f.store.entries.get('file')!.missing, true);
  const workspace = new MemoryDrive('workspace'); const restored = new Map<string, string>();
  for (const entry of f.store.entries.values()) await restoreEntry(settings, entry, 'restore1', f.target, workspace, f.store, restored);
  assert.equal(workspace.data.get(restored.get('file')!)!.toString(), 'keep');
  // Simulated agent removes all work content. Originals and every protected backup remain unchanged.
  for (const id of workspace.files.keys()) if (id !== 'workspace') workspace.files.delete(id);
  assert.deepEqual([...f.target.files], before); const rebuilt = new Map<string, string>();
  for (const entry of f.store.entries.values()) await restoreEntry(settings, entry, 'restore2', f.target, workspace, f.store, rebuilt);
  assert.equal(workspace.data.get(rebuilt.get('file')!)!.toString(), 'keep');
});
test('interruption after copy commit reuses durable ID and preserves cursor until completion', async () => {
  const f = fixture(); f.source.put('file', 'text/plain', 'source', 'safe'); f.target.crash = true;
  const state = await f.engine.begin('interrupted'); assert.ok(state);
  await assert.rejects(() => f.engine.step(state, Date.now() + 60000), /Process stopped/);
  assert.equal(f.store.versions.size, 0); const writes = f.target.writes.length;
  assert.equal(await f.engine.step(f.store.state!, Date.now() + 60000), true); assert.equal(f.target.writes.length, writes); assert.equal(f.store.versions.size, 1);
});
test('permission/auth errors leave previous backup and checkpoints intact; missing queued folders are retained', async () => {
  const f = fixture(); f.source.put('dir', FOLDER, 'source'); f.source.put('file', 'text/plain', 'dir'); await scan(f, 'first');
  const before = structuredClone([...f.target.files]); f.store.newRun(); const state = await f.engine.begin('permissions'); assert.ok(state);
  const original = f.source.children.bind(f.source); f.source.children = async () => { throw new BackupDriveError(401); };
  await assert.rejects(() => f.engine.step(state, Date.now() + 60000), /401/); assert.deepEqual([...f.target.files], before);
  f.source.children = original; await f.store.doneTask('source'); await f.store.addTask({ sourceId: 'dir', backupId: f.store.entries.get('dir')!.backupId, offset: 0, pageToken: '' });
  f.source.files.delete('dir'); assert.equal(await f.engine.step(state, Date.now() + 60000), true); assert.deepEqual([...f.target.files], before);
});
test('readonly transport cannot write; workspace rejects backup IDs and root destruction before sending any mutation', async () => {
  const mutations: string[] = [];
  const request: typeof fetch = async (input, init) => { if (init?.method && init.method !== 'GET') mutations.push(String(input));
    const id = new URL(String(input)).pathname.split('/').at(-1)!;
    const files: Record<string, FileMetadata> = { source: { id: 'source', name: 's', mimeType: FOLDER }, workspace: { id: 'workspace', name: 'w', mimeType: FOLDER }, backup: { id: 'backup', name: 'b', mimeType: FOLDER } };
    return Response.json(files[id] || {}, { status: files[id] ? 200 : 404 }); };
  const source = new BackupDrive(settings.sourceReader, true, async () => 'fake', request);
  await assert.rejects(() => source.create('new', 'source', 'bad', FOLDER, {}, 'source'), /solo lectura/);
  const workspace = new WorkspaceDrive(settings.workspaceWriter, false, async () => 'fake', request);
  await assert.rejects(() => workspace.trashWorkspace('backup', 'workspace'), /fuera/);
  await assert.rejects(() => workspace.replaceWorkspace('source', 'workspace', Buffer.from('bad'), 'text/plain'), /fuera/);
  await assert.rejects(() => workspace.trashWorkspace('workspace', 'workspace'), /protegida/);
  assert.deepEqual(mutations, []); assert.equal('trashWorkspace' in source, false);
});
test('Drive retries transient errors within a bounded budget, without swallowing permission errors', async () => {
  let attempts = 0; const request: typeof fetch = async () => ++attempts === 1 ? Response.json({}, { status: 429 }) : Response.json({ id: 'source', name: 's', mimeType: FOLDER });
  await new BackupDrive(settings.sourceReader, true, async () => 'fake', request).metadata('source'); assert.equal(attempts, 2);
  attempts = 0; const denied = new BackupDrive(settings.sourceReader, true, async () => 'fake', async () => { attempts++; return Response.json({}, { status: 403 }); });
  await assert.rejects(() => denied.metadata('source'), /403/); assert.equal(attempts, 1);
});
test('schedule has all seven slots, timezone conversion and no Sunday execution', () => {
  assert.equal(BACKUP_CRON, '0 9,11,13,15,17,19,21 * * 1-6');
  for (let day = 2; day <= 7; day++) for (let hour = 0; hour < 24; hour++) {
    const instant = new Date(`2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00-06:00`);
    assert.equal(isBackupSlot(instant, 'America/Mexico_City'), [9,11,13,15,17,19,21].includes(hour));
  }
  for (let hour = 0; hour < 24; hour++) assert.equal(isBackupSlot(new Date(`2026-11-08T${String(hour).padStart(2,'0')}:00:00-06:00`), 'America/Mexico_City'), false);
  assert.equal(isBackupSlot(new Date('2026-11-06T15:00:00Z'), 'America/Mexico_City'), true);
  assert.equal(isBackupSlot(new Date('2026-11-06T15:01:00Z'), 'America/Mexico_City'), false);
});
test('settings reject shared identities/roots; unsupported native types are explicit failures', () => {
  assert.deepEqual(validateSettings(settings), settings);
  assert.throws(() => validateSettings({ ...settings, workspaceWriter: settings.backupWriter }), /distintas/);
  assert.throws(() => validateSettings({ ...settings, workspaceFolderId: settings.sourceFolderId }), /distintas/);
  assert.throws(() => exportType('application/vnd.google-apps.shortcut'), /sin exportación/);
  assert.match(exportType('application/vnd.google-apps.document'), /wordprocessingml/);
});
test('isolation rejects My Drive service-account storage and cross-tier access', async () => {
  const make = (email: string) => ({
    async metadata(id: string) {
      if (email === settings.sourceReader && id === 'source') return { id, name: id, mimeType: FOLDER, capabilities: { canEdit: false } };
      if (email === settings.backupWriter && id === 'backup' || email === settings.workspaceWriter && id === 'workspace') return { id, name: id, mimeType: FOLDER, capabilities: { canEdit: true, canAddChildren: true } };
      throw new BackupDriveError(404);
    },
  }) as unknown as import('../functions/src/backups/drive').BackupDrive;
  await assert.rejects(() => assertIsolation(settings, ['custodian@example.test'], make), /unidades compartidas/);
  const accessible = () => ({ async metadata(id: string) { return { id, name: id, mimeType: FOLDER, driveId: id, capabilities: { canEdit: id !== 'source', canAddChildren: id !== 'source' } }; } }) as unknown as import('../functions/src/backups/drive').BackupDrive;
  await assert.rejects(() => assertIsolation(settings, ['custodian@example.test'], accessible), /otra capa/);
});
test('verified ACLs use the least role that supports folder moves; contributors and unexpected members fail closed', async () => {
  let role = 'fileOrganizer'; let extra = false; let sourceRole = 'reader';
  const make = (email: string) => ({
    async metadata(id: string) {
      const own = email === settings.sourceReader ? 'source' : email === settings.backupWriter ? 'backup' : 'workspace';
      if (id !== own) throw new BackupDriveError(404);
      return { id, name: id, mimeType: FOLDER, driveId: id === 'source' ? undefined : id, capabilities: { canEdit: id !== 'source', canAddChildren: id !== 'source' } };
    },
    async permissions() { return [{ type: 'user', emailAddress: email, role: email === settings.sourceReader ? sourceRole : email === settings.backupWriter ? role : 'fileOrganizer' },
      ...(extra && email === settings.backupWriter ? [{ type: 'group', emailAddress: 'agents@example.test', role: 'reader' }] : [])]; },
  }) as unknown as import('../functions/src/backups/drive').BackupDrive;
  await assertIsolation(settings, ['custodian@example.test'], make);
  role = 'writer'; await assert.rejects(() => assertIsolation(settings, ['custodian@example.test'], make), /gestor/);
  role = 'fileOrganizer'; extra = true; await assert.rejects(() => assertIsolation(settings, ['custodian@example.test'], make), /sin grupos/);
  extra = false; sourceRole = 'writer'; await assert.rejects(() => assertIsolation(settings, ['custodian@example.test'], make), /lector/);
});
test('whole source-root loss preserves all backup data and reports failure instead of an empty successful sync', async () => {
  const f = fixture(); f.source.put('file', 'text/plain', 'source', 'original'); await scan(f, 'first');
  const before = structuredClone([...f.target.files]); f.source.files.get('source')!.trashed = true;
  await assert.rejects(() => f.engine.begin('deleted-root'), /404/); assert.deepEqual([...f.target.files], before);
});
test('failure after version creation and relocation replays without a duplicate version or losing the previous bytes', async () => {
  const f = fixture(); f.source.put('file', 'text/plain', 'source', 'first'); await scan(f, 'initial');
  const old = f.store.entries.get('file')!.backupId; f.source.put('file', 'text/plain', 'source', 'second');
  const save = f.store.saveEntry.bind(f.store); let fail = true;
  f.store.saveEntry = async entry => { if (fail) { fail = false; throw Error('Firestore interruption'); } await save(entry); };
  f.store.newRun(); const state = await f.engine.begin('updated'); assert.ok(state);
  await assert.rejects(() => f.engine.step(state, Date.now() + 60000), /Firestore interruption/);
  const count = f.target.writes.length;
  assert.equal(await f.engine.step(state, Date.now() + 60000), true); assert.equal(f.target.writes.length, count);
  assert.equal(f.store.versions.size, 2); assert.equal(f.target.data.get(old)!.toString(), 'first');
});
