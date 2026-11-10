// Backfill thumbnails (generated/.../{outputId}_thumb.jpg) for existing completed/failed jobs.
// Dry run by default: lists what it would do and writes nothing. Use --apply to write.
//
//   node --import tsx scripts/backfill-generated-thumbnails.ts [--limit=50] [--client=<id>] [--start-after=<jobId>] [--apply]
//
// Uses Application Default Credentials (gcloud auth application-default login).
// Only touches jobs in completed/failed so it never races the worker. Each job is updated in a
// transaction that re-checks the output id, and only the nested `thumbnailPath` field is written,
// so no status, counter or analytics trigger reacts to it.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Job, JobOutput } from '../shared/src/types';
import { createRequire } from 'node:module';

// functions/ is CommonJS: load the compiled module (run `npm --prefix functions run build` first),
// the same code the worker runs in production.
const { createGeneratedThumbnail } = createRequire(new URL('../functions/package.json', import.meta.url))(
  './lib/functions/src/media/generatedThumbnail.js',
) as typeof import('../functions/src/media/generatedThumbnail');

const MAX_LIMIT = 500;
const PAGE_SIZE = 200;

const { values: args } = parseArgs({ options: {
  apply: { type: 'boolean', default: false },
  limit: { type: 'string', default: '50' },
  client: { type: 'string' },
  'start-after': { type: 'string' },
  project: { type: 'string' },
} });

const limit = Number(args.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
  throw new Error(`--limit debe ser un entero entre 1 y ${MAX_LIMIT}.`);
}

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8')) as {
  projectId: string; storageBucket: string;
};
const projectId = args.project || config.projectId;
initializeApp({ credential: applicationDefault(), projectId, storageBucket: config.storageBucket });
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID || '(default)');
const bucket = getStorage().bucket();

type OutputSlot = 'currentOutput' | 'userSelectedOutput';
interface Candidate { jobId: string; output: JobOutput; slots: OutputSlot[] }

const needsThumbnail = (output: JobOutput | null | undefined): output is JobOutput =>
  Boolean(output?.id && output.resultImagePath && !output.thumbnailPath && !output.storageDeletedAt);

const candidatesForJob = (snapshot: DocumentSnapshot): Candidate[] => {
  const job = snapshot.data() as Job;
  const byOutputId = new Map<string, Candidate>();
  for (const slot of ['currentOutput', 'userSelectedOutput'] as const) {
    const output = job[slot];
    if (!needsThumbnail(output)) continue;
    const existing = byOutputId.get(output.id!);
    if (existing) existing.slots.push(slot);
    else byOutputId.set(output.id!, { jobId: snapshot.id, output, slots: [slot] });
  }
  return [...byOutputId.values()];
};

const applyCandidate = async ({ jobId, output, slots }: Candidate): Promise<'done' | 'skipped' | 'error'> => {
  const [exists] = await bucket.file(output.resultImagePath).exists();
  if (!exists) {
    console.warn(`  - ${jobId}/${output.id}: imagen original no existe (${output.resultImagePath}), se omite.`);
    return 'skipped';
  }
  const [bytes] = await bucket.file(output.resultImagePath).download();
  const thumbnailPath = await createGeneratedThumbnail({ bucket, bytes, resultImagePath: output.resultImagePath });
  if (!thumbnailPath) return 'error';

  const jobRef = db.collection('jobs').doc(jobId);
  const outputRef = jobRef.collection('outputs').doc(output.id!);
  const updated = await db.runTransaction(async (tx) => {
    const [jobSnap, outputSnap] = await Promise.all([tx.get(jobRef), tx.get(outputRef)]);
    if (!jobSnap.exists) return false;
    const job = jobSnap.data() as Job;
    const jobUpdate: Record<string, string> = {};
    for (const slot of slots) {
      if (job[slot]?.id === output.id && job[slot]?.resultImagePath === output.resultImagePath) {
        jobUpdate[`${slot}.thumbnailPath`] = thumbnailPath;
      }
    }
    if (Object.keys(jobUpdate).length) tx.update(jobRef, jobUpdate);
    if (outputSnap.exists && (outputSnap.data() as JobOutput).resultImagePath === output.resultImagePath) {
      tx.update(outputRef, { thumbnailPath });
    }
    return Object.keys(jobUpdate).length > 0 || outputSnap.exists;
  });
  if (!updated) {
    // Job changed underneath us; drop the orphan thumbnail.
    await bucket.file(thumbnailPath).delete({ ignoreNotFound: true });
    return 'skipped';
  }
  return 'done';
};

const main = async () => {
  console.log(`${args.apply ? 'APLICANDO' : 'DRY RUN (sin escrituras)'} · proyecto=${projectId} · límite=${limit}${args.client ? ` · cliente=${args.client}` : ''}`);
  let query = db.collection('jobs').where('status', 'in', ['completed', 'failed']);
  if (args.client) query = query.where('clientId', '==', args.client);
  query = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);

  let cursor = args['start-after'];
  let scannedJobs = 0;
  let lastJobId: string | undefined;
  const counts = { done: 0, skipped: 0, error: 0, planned: 0 };

  outer: while (true) {
    const page = await (cursor ? query.startAfter(cursor) : query).get();
    if (page.empty) { lastJobId = undefined; break; }
    for (const snapshot of page.docs) {
      const candidates = candidatesForJob(snapshot);
      if (counts.planned + candidates.length > limit && counts.planned > 0) break outer;
      scannedJobs += 1;
      lastJobId = snapshot.id;
      for (const candidate of candidates) {
        counts.planned += 1;
        console.log(`  • ${candidate.jobId}/${candidate.output.id} → ${candidate.output.resultImagePath} [${candidate.slots.join(', ')}]`);
        if (args.apply) {
          try { counts[await applyCandidate(candidate)] += 1; } catch (error) {
            counts.error += 1;
            console.error(`  ! ${candidate.jobId}/${candidate.output.id}:`, error);
          }
        }
      }
    }
    cursor = page.docs[page.docs.length - 1].id;
    if (page.size < PAGE_SIZE) { lastJobId = undefined; break; }
  }

  console.log(`\nJobs revisados: ${scannedJobs} · outputs sin miniatura: ${counts.planned}`);
  if (args.apply) console.log(`Creadas: ${counts.done} · omitidas: ${counts.skipped} · errores: ${counts.error}`);
  else console.log('Dry run: no se escribió nada. Agrega --apply para generar las miniaturas.');
  if (lastJobId) console.log(`Hay más jobs. Continúa con --start-after=${lastJobId}`);
  else console.log('No quedan más jobs por revisar con estos filtros.');
};

await main();
