import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { authorizePilot, secret, sourceToken, cloudToken } from './auth.ts';
import { catalog, copyPlan, hash, isWorkbook, PILOT, readWorkbook } from './catalog.ts';
import { Drive, FOLDER, q, scan, SHEET, verifyInventory } from './drive.ts';
import { analyzeReferences, newSpend } from './references.ts';
import { driveFileUrl, type Prepared, type Receipt, report, sheetRequests } from './report.ts';

const { values: args } = parseArgs({ options: {
  client: { type: 'string' }, 'dry-run': { type: 'boolean' }, execute: { type: 'boolean' },
  mcp: { type: 'boolean' }, finalize: { type: 'boolean' }, 'work-dir': { type: 'string' },
  'destination-id': { type: 'string' },
} });
const workspace = resolve(args['work-dir'] || join(homedir(), '.local', 'state', 'tutofb', PILOT.id));
const planPath = join(workspace, 'plan.json');
const write = async (name: string, value: unknown) => {
  const file = join(workspace, name);
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(file + '.tmp', file);
};
async function finalize(prepared: Prepared, receipts: Receipt[], source: Drive) {
  const expected = new Map(prepared.copies.map(copy => [copy.fileId, copy]));
  const original = new Set(prepared.files.map(file => file.id));
  const seen = new Set<string>();
  const outputIds = new Set<string>();
  for (const receipt of receipts) {
    if (!expected.has(receipt.sourceFileId) || original.has(receipt.id) || original.has(receipt.parentId) ||
        seen.has(receipt.sourceFileId) || outputIds.has(receipt.id) || expected.get(receipt.sourceFileId)!.name !== receipt.name ||
        !receipt.url.startsWith('https://')) throw new Error('Recibo de copia inválido o duplicado');
    seen.add(receipt.sourceFileId);
    outputIds.add(receipt.id);
  }
  const verification = verifyInventory(prepared.files, (await scan(source)).files);
  const output = report(prepared, receipts, verification);
  await write('inventario.json', { pilot: PILOT, verification, files: prepared.files, sources: prepared.sources, receipts,
    missing: prepared.copies.filter(copy => !receipts.find(receipt => receipt.sourceFileId === copy.fileId && receipt.verified)) });
  await write('asociaciones.json', { pilot: PILOT, ...prepared.catalog, spend: prepared.spend });
  await write('tablas.json', output.tables);
  await writeFile(join(workspace, 'informe.md'), output.text, { mode: 0o600 });
  return output;
}
async function claimRun() {
  const database = encodeURIComponent(process.env.FIRESTORE_DATABASE_ID || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/tutofb-260320-1003/databases/${database}/documents/organizerPilots?documentId=${PILOT.id}`;
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${cloudToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      clientId: { stringValue: PILOT.clientId }, sourceId: { stringValue: PILOT.sourceId },
      transport: { stringValue: args.mcp ? 'mcp' : 'drive-api' }, createdAt: { timestampValue: new Date().toISOString() },
    } }), signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 409) throw new Error('El piloto ya fue iniciado. Consulta el recibo y verifica por lectura.');
  if (!response.ok) throw new Error(`No se pudo registrar la ejecución única. Firestore HTTP ${response.status}`);
}
async function main() {
  if (args.client?.toLowerCase() !== 'jishop' || [args['dry-run'], args.execute, args.finalize].filter(Boolean).length !== 1 ||
      (args.mcp && !args.execute)) throw new Error('Uso: organizer:pilot --client=jishop --dry-run | --execute [--mcp] | --finalize');
  const budget = await authorizePilot();
  const source = new Drive(sourceToken());
  if (args.finalize) {
    const prepared = JSON.parse(await readFile(planPath, 'utf8')) as Prepared;
    const receipts = JSON.parse(await readFile(join(workspace, 'recibos.json'), 'utf8')) as Receipt[];
    console.log(JSON.stringify((await finalize(prepared, receipts, source)).stats));
    return;
  }
  const { source: root, files } = await scan(source);
  const imports = await Promise.all(files.filter(isWorkbook).map(async file => readWorkbook(file, await source.download(file))));
  const result = catalog(files, imports.flatMap(book => book.rows));
  const prepared: Prepared = { files, catalog: result, sources: imports.flatMap(book => book.sources),
    copies: copyPlan(files, result), spend: newSpend(budget), errors: [] };
  if (args['dry-run']) {
    console.log(JSON.stringify({ ...report(prepared, []).stats, plannedCopies: prepared.copies.length, budgetUsd: budget,
      bytes: files.filter(file => !file.folder).reduce((total, file) => total + Number(file.size || 0), 0) }));
    return;
  }

  const destinationToken = process.env.ORGANIZER_DRIVE_ACCESS_TOKEN;
  if (!args.mcp && !destinationToken) throw new Error('Proporciona una credencial de Drive de escritura autorizada o usa --mcp');
  const destination = destinationToken ? new Drive(async () => destinationToken) : undefined;
  let parentId: string | undefined;
  if (!args.mcp && destination) {
    const candidates = args['destination-id'] ? [args['destination-id']] : [...(root.parents || []), root.id];
    const parents = await Promise.all(candidates.map(id => destination.metadata(id).catch(() => null)));
    const parent = parents.find(file => file?.capabilities?.canAddChildren && file.mimeType === FOLDER && !file.trashed &&
      (file.ownedByMe && !file.shared || Boolean(file.driveId)));
    if (!parent) throw new Error('No hay un destino privado con permiso para añadir archivos');
    if (files.some(file => file.id === parent.id)) throw new Error('El destino está dentro del inventario de origen');
    parentId = parent.id;
    const prior = await destination.list(`${q(parentId)} in parents and name = ${q(PILOT.name)}`);
    if (prior.length) throw new Error('El destino ya contiene una carpeta con el nombre del piloto');
    const about = await destination.about();
    const remaining = Number(about.storageQuota?.limit ?? Infinity) - Number(about.storageQuota?.usage ?? 0);
    const needed = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (remaining < needed + 5 * 1024 * 1024) throw new Error('No hay espacio suficiente para las copias y reportes');
  }
  if (files.some(file => !file.folder && prepared.copies.some(copy => copy.fileId === file.id) && file.canCopy === false)) {
    throw new Error('Hay archivos de origen cuyo permiso de copia está deshabilitado');
  }
  await mkdir(workspace, { mode: 0o700, recursive: true });
  const lock = await open(join(workspace, 'ejecucion.lock'), 'wx', 0o600);
  try {
    await lock.writeFile(PILOT.id + '\n');
    await claimRun();
    await write('plan.json', prepared);
    if (budget >= 0.05) {
      await analyzeReferences(files, result, source, secret('GEMINI_API_KEY'), prepared.spend, () => write('plan.json', prepared));
    }
    prepared.copies = copyPlan(files, result);
    await write('plan.json', prepared);
    if (args.mcp) {
      console.log(JSON.stringify({ pilot: PILOT.id, transport: 'mcp', plannedCopies: prepared.copies.length, calls: prepared.spend.calls }));
      return;
    }
    const target = destination!;
    const created = await target.create(PILOT.name, FOLDER, parentId!, hash(PILOT.id).slice(0, 32));
    const directories = new Map<string, string>([['[]', created.id]]);
    const folder = async (parts: string[]) => {
      let path: string[] = [];
      let parent = created.id;
      for (const name of parts) {
        path = [...path, name];
        const lookup = JSON.stringify(path);
        if (!directories.has(lookup)) {
          const result = await target.create(name, FOLDER, parent, hash(lookup).slice(0, 32));
          directories.set(lookup, result.id);
          await write('carpetas.json', Object.fromEntries(directories));
        }
        parent = directories.get(lookup)!;
      }
      return parent;
    };
    await write('carpetas.json', Object.fromEntries(directories));
    const receipts: Receipt[] = [];
    const byId = new Map(files.map(file => [file.id, file]));
    for (const operation of prepared.copies) {
      const file = byId.get(operation.fileId)!;
      const parent = await folder(operation.directories);
      const copied = await target.copy(file, operation.name, parent, hash(file.id).slice(0, 32));
      const after = await target.metadata(copied.id);
      const verified = after.id !== file.id && after.name === operation.name && after.parents?.includes(parent) === true &&
        (!file.md5Checksum || after.md5Checksum === file.md5Checksum) && (!file.size || after.size === file.size);
      receipts.push({ sourceFileId: file.id, id: copied.id, name: operation.name, parentId: parent,
        url: after.webViewLink || driveFileUrl(after.id), verified });
      await write('recibos.json', receipts);
    }
    const output = await finalize(prepared, receipts, source);
    const reports = await folder(['04 - REPORTES']);
    const sheet = await target.create(PILOT.sheet, SHEET, reports, 'control');
    const sheetMetadata = await target.sheets(sheet.id);
    const ids = Object.keys(output.tables).map((title, index) => ({ id: index + 10, title, exists: false }));
    const requests = sheetRequests(output.tables, ids, true);
    requests.push(...sheetMetadata.sheets.map((tab: { properties: { sheetId: number } }) => ({ deleteSheet: { sheetId: tab.properties.sheetId } })));
    await target.sheets(sheet.id, requests);
    await target.sheets(sheet.id);
    for (const name of ['inventario.json', 'asociaciones.json', 'informe.md']) {
      const artifact = await target.upload(name, reports, hash(name).slice(0, 32),
        name.endsWith('.json') ? 'application/json' : 'text/markdown', await readFile(join(workspace, name)));
      await target.metadata(artifact.id);
    }
    console.log(JSON.stringify(output.stats));
  } finally {
    await lock.close();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Error del piloto'); process.exitCode = 1; });
