// Explicit, resumable provider validation. Never imported by the test suite; never writes Drive.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { secret, sourceToken } from './auth.ts';
import type { DriveEntry } from '../../functions/src/organizer/drive';
import type { OrganizerPhoto, OrganizerProductRow, OrganizerTab, OrganizerVariant } from '../../shared/src/types';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, client: { type: 'string' }, budget: { type: 'string' }, report: { type: 'string' } } });
if (!values.manifest || !values.client || !values.report || !(Number(values.budget) > 0 && Number(values.budget) <= 40))
  throw new Error('Uso: validate-hybrid.ts --manifest archivo --client ID --budget 40 --report archivo');
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, cert, deleteApp } = require('firebase-admin/app') as typeof import('firebase-admin/app');
const app = initializeApp({ projectId: 'tutofb-260320-1003', credential: cert({ projectId: 'tutofb-260320-1003', clientEmail: process.env.GOOGLE_CLIENT_EMAIL!, privateKey: secret('GOOGLE_PRIVATE_KEY').replace(/^"|"$/g, '').replace(/\\n/g, '\n') }) });
const { getAppFirestore } = require('./lib/functions/src/firebase/appFirestore.js') as typeof import('../../functions/src/firebase/appFirestore');
const { OrganizerDrive, digest, isImage, isWorkbook } = require('./lib/functions/src/organizer/drive.js') as typeof import('../../functions/src/organizer/drive');
const { readWorkbook, groupProductRows, productVariant, associationIndex, associatePhotos, ALGORITHM_VERSION } = require('./lib/functions/src/organizer/catalog.js') as typeof import('../../functions/src/organizer/catalog');
const { analyze, reconcileReservations } = require('./lib/functions/src/organizer/vision.js') as typeof import('../../functions/src/organizer/vision');
const { interpretStructure, matchObservation, rankCandidates } = require('./lib/functions/src/organizer/interpretation.js') as typeof import('../../functions/src/organizer/interpretation');
const db = getAppFirestore();
const model = 'gemini-3.1-flash-lite';
const manifest = JSON.parse(await readFile(values.manifest, 'utf8')) as { files: DriveEntry[] };
for (const file of manifest.files) {
  const parents: string[] = []; let parent = file.parents?.[0];
  while (parent && !parents.includes(parent)) { parents.unshift(parent); if (parent === file.sourceId) break; parent = manifest.files.find(value => value.id === parent)?.parents?.[0]; }
  file.ancestorIds = parents;
}
const root = db.collection('organizerValidations').doc(values.client);
const runId = digest([ALGORITHM_VERSION, manifest.files.map(file => [file.id, file.version]), 'hybrid-validation-1']);
const run = root.collection('runs').doc(runId);
const lease = randomUUID();
const drive = new OrganizerDrive(sourceToken());
let claimed = false;
try {
  const client = (await db.collection('clients').doc(values.client).get()).data();
  if (!client || manifest.files.some(file => !(client.automation?.driveFolderIds || []).includes(file.sourceId)))
    throw new Error('El manifiesto contiene un origen que no está autorizado en el cliente.');
  process.env.GEMINI_API_KEY = secret('GEMINI_API_KEY');
  const available = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000),
  });
  if (!available.ok) throw new Error(`Modelo no disponible: HTTP ${available.status}`);
  const metadata = await available.json() as { supportedGenerationMethods?: string[] };
  if (!metadata.supportedGenerationMethods?.includes('generateContent')) throw new Error('Modelo sin generateContent.');
  await db.runTransaction(async tx => {
    const previous = (await tx.get(run)).data();
    if (previous?.status === 'running' && previous.leaseUntil > Date.now()) throw new Error('Validación ya en curso.');
    if (previous && previous.budgetUsd !== Number(values.budget)) throw new Error('Conserva el presupuesto original para reanudar.');
    tx.set(run, { ...(previous || { id: runId, clientId: values.client, createdAt: Date.now(), budgetUsd: Number(values.budget), estimatedUsd: 0,
      reservedUsd: 0, uncertainUsd: 0, calls: 0, alerts: [], maxCalls: 150 }), status: 'running', lease, leaseUntil: Date.now() + 3600_000, model, maxCalls: 300, error: null });
  });
  claimed = true;
  await reconcileReservations(run);
  const rows: OrganizerProductRow[] = []; const tabs: OrganizerTab[] = [];
  for (const file of manifest.files.filter(isWorkbook)) {
    await drive.assertSource(file);
    for await (const imported of readWorkbook(drive, file)) { rows.push(...imported.rows); tabs.push(imported.tab); }
  }
  const grouped = groupProductRows(rows);
  const variants: OrganizerVariant[] = [...grouped.groups].map(([id, items]) => productVariant(id, items, undefined, grouped.anchors.get(id)));
  const writes: { ref: FirebaseFirestore.DocumentReference; value: object }[] = [];
  for (const variant of variants) {
    writes.push({ ref: root.collection('products').doc(variant.id), value: variant });
    for (const row of (grouped.groups.get(variant.id) || []).slice(0, 3)) writes.push({
      ref: root.collection('products').doc(variant.id).collection('provenance').doc(digest([row.fileId, row.tab, row.line])), value: row });
  }
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch(); for (const item of writes.slice(offset, offset + 400)) batch.set(item.ref, item.value); await batch.commit();
  }
  console.log(JSON.stringify({ stage: 'catalog', rows: rows.length, variants: variants.length, tabs: tabs.map(tab => ({ name: tab.name, imported: tab.imported, skipped: tab.skipped })) }));
  // Structure validation uses compact pertinent groups, without sending the entire inventory in each call.
  const structure = await interpretStructure(root, run, lease, model, manifest.files, tabs, variants, Date.now() + 20 * 60_000);
  if (!structure.complete) throw new Error('Interpretación pendiente; reanuda con el mismo manifiesto.');
  console.log(JSON.stringify({ stage: 'structure', calls: (await run.get()).data()!.calls }));
  const images = manifest.files.filter(isImage);
  const associations = associatePhotos(images, associationIndex(variants), new Map());
  const selected = images.filter(file => /^(A137 \(40\)\.png|A216 Y A217|A021-4\.webp|A091-2\.jpg|A159-ROpng)$/.test(file.name) ||
    file.path.at(-2)?.trim() === 'COCINA' && /^\d+\.png$/.test(file.name));
  const results = [];
  const beforePixels = (await run.get()).data()!.calls;
  for (const file of selected) {
    console.log(JSON.stringify({ stage: 'vision', file: file.name }));
    await drive.assertSource(file);
    const association = associations.get(file.id)!;
    const photo: OrganizerPhoto = { id: file.id, name: file.name, path: file.path, sourceUrl: '', copyUrl: null, reviewedBy: null, view: null, ...association };
    const observation = await analyze(drive, root, run, lease, model, [{ file, candidateIds: photo.candidates }], [], false);
    const match = observation && !photo.variantId && photo.identityState !== 'shared' ? await matchObservation(root, run, lease, model, photo, variants, observation) : null;
    const id = photo.variantId || match?.variantId;
    results.push({ id: file.id, name: file.name, path: file.path, identityState: photo.identityState, ruleVariantIds: photo.variantIds,
      result: id ? variants.find(v => v.id === id)?.visual : null, baseId: match?.baseId || null, observation,
      candidates: (match?.ranked || rankCandidates(photo, variants)).slice(0, 12),
      // Only the historical independently reviewed French-press fixture has verified visual truth.
      supervised: file.name === 'A137 (40).png' ? { expectedBase: 'A174', outcome: !id ? 'pending' : variants.find(v => v.id === id)?.base === 'A174' ? 'correct' : 'incorrect' } : null });
  }
  const afterFirstPass = (await run.get()).data()!.calls;
  for (const file of selected) await analyze(drive, root, run, lease, model, [{ file, candidateIds: [] }], [], false);
  const afterSecondPass = (await run.get()).data()!.calls;
  if (afterSecondPass !== afterFirstPass) throw new Error('La segunda pasada repitió análisis pagados.');
  const ledger = (await run.collection('ledger').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const data = (await run.get()).data()!;
  const report = { runId, model, budgetUsd: data.budgetUsd, confirmedUsd: data.estimatedUsd, reservedUsd: data.reservedUsd, uncertainUsd: data.uncertainUsd,
    calls: data.calls, pixelAndAssociationCalls: afterFirstPass - beforePixels, repeatedPixelCalls: afterSecondPass - afterFirstPass,
    inventory: { images: images.length, folders: manifest.files.filter(file => file.mimeType.endsWith('.folder')).length, workbooks: manifest.files.filter(isWorkbook).length },
    tabs, rows: rows.length, variants: variants.length,
    metrics: { correct: results.filter(r => r.supervised?.outcome === 'correct').length, incorrect: results.filter(r => r.supervised?.outcome === 'incorrect').length,
      pending: results.filter(r => r.supervised?.outcome === 'pending').length, visuallyUnverified: results.filter(r => !r.supervised).length }, results, ledger };
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await run.update({ status: 'completed', completedAt: Date.now(), lease: null, leaseUntil: 0, metrics: report.metrics });
  console.log(JSON.stringify({ ...report, tabs: report.tabs.map(tab => ({ name: tab.name, imported: tab.imported, skipped: tab.skipped })), results: results.map(result => ({ name: result.name, result: result.result, supervised: result.supervised, observation: result.observation?.label })), ledger: undefined }));
} catch (error) {
  if (claimed) await run.update({ status: 'failed', error: error instanceof Error ? error.message : 'Error', lease: null, leaseUntil: 0 });
  throw error;
} finally { delete process.env.GEMINI_API_KEY; await deleteApp(app); }
