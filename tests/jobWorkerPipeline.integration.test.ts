import { cleanupEmulatorDatabase } from './support/cleanupEmulator';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Characterization suite for the job pipeline (jobWorker.ts + jobWorker.persistence.ts).
// It records, per scenario, the call order of external effects and the full normalized Firestore/Storage
// state, and compares it against a golden file captured from the pre-refactor code.
// Regenerate the golden only on purpose: UPDATE_JOB_WORKER_GOLDEN=1.
process.env.FIRESTORE_DATABASE_ID = 'test-job-worker-pipeline';
const require = createRequire(import.meta.url);
const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST
  && process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const goldenPath = fileURLToPath(new URL('./support/jobWorkerPipeline.golden.json', import.meta.url));

const hash = (bytes: Buffer) => `<bytes:${createHash('sha1').update(bytes).digest('hex').slice(0, 10)}>`;
const VOLATILE_NUMBER_KEYS = new Set(['durationSeconds', 'totalDurationSeconds']);

const normalize = (value: any, replacements: Array<[string, string]>, key = ''): any => {
  if (value === null || value === undefined) return value ?? null;
  if (Buffer.isBuffer(value)) return hash(value);
  if (value instanceof AbortSignal) return '<signal>';
  if (typeof value === 'object' && typeof value.toMillis === 'function') return '<ts>';
  if (typeof value === 'number' && VOLATILE_NUMBER_KEYS.has(key)) return '<n>';
  // Stack traces carry source line numbers, which any edit changes; keep only the first line (the message).
  if (typeof value === 'string' && key === 'stack') return value.split('\n')[0];
  if (typeof value === 'string') {
    let out = value;
    for (const [from, to] of replacements) if (from) out = out.split(from).join(to);
    return out.replace(/^worker:(create|requeue):[0-9a-f-]{36}$/, 'worker:$1:<uuid>');
  }
  if (Array.isArray(value)) return value.map(item => normalize(item, replacements));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k], replacements, k)]));
  }
  return value;
};

test('job pipeline characterization: generation, reference reuse, review resume and every outcome', { skip: !enabled },
  async t => {
    process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
    process.env.FAL_KEY = 'test-only';
    process.env.GEMINI_API_KEY = 'test-only';
    const admin = require('../functions/node_modules/firebase-admin');
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
    const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
    const bucket = admin.storage().bucket();
    const sharp = require('../functions/node_modules/sharp');
    const { File } = require('../functions/node_modules/@google-cloud/storage');
    await cleanupEmulatorDatabase(db);
    await db.collection('system_config').doc('main').set({ batchMaxJobs: 100, jobMaxRetries: 1, jobRetryDelayMs: 0 });
    require('../functions/lib/functions/src/admin/systemConfig.js').invalidateSystemConfigCache();

    const providers = require('../functions/lib/functions/src/providers/index.js');
    const review = require('../functions/lib/functions/src/review/geminiImageReview.js');
    const budget = require('../functions/lib/functions/src/automation/budget.js');
    const claims = require('../functions/lib/functions/src/workers/jobWorker.claims.js');
    const generation = require('../functions/lib/functions/src/workers/jobWorker.js');

    const pose = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const garment = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#cc3344' } }).jpeg().toBuffer();
    const generated = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const paths = { pose: 'clients/c/models/m/poses/pose.jpg', garment: 'garments/g/front.jpg', extra: 'garments/g/back.jpg' };
    await bucket.file(paths.pose).save(pose, { metadata: { contentType: 'image/jpeg' } });
    await bucket.file(paths.garment).save(garment, { metadata: { contentType: 'image/jpeg' } });
    await bucket.file(paths.extra).save(garment, { metadata: { contentType: 'image/jpeg' } });

    // Scenario knobs and the shared effect trace.
    let trace: string[] = [];
    let providerCalls: any[] = [];
    let reviewCalls: any[] = [];
    let providerMode: 'ok' | 'throw' = 'ok';
    let reviewMode: 'approved' | 'rejected' | 'throw' = 'approved';
    let reserveMode: 'ok' | 'budget' = 'ok';
    let claimActive = true;

    t.mock.method(File.prototype, 'getSignedUrl', async function (this: any) {
      return [`https://signed.invalid/${this.name}`];
    });
    t.mock.method(providers, 'generateWithProvider', async (provider: string, request: any, keys: any) => {
      trace.push('provider');
      providerCalls.push({ provider, request, keys });
      if (providerMode === 'throw') throw new Error('Simulated provider failure');
      return { provider, imageBytes: generated, contentType: 'image/png', remoteUrl: 'https://fal.invalid/out.png',
        requestId: 'req-1', responseSummary: { simulated: true } };
    });
    t.mock.method(review, 'reviewGeneratedImageWithGemini', async (request: any) => {
      trace.push('review');
      reviewCalls.push(request);
      if (reviewMode === 'throw') throw new Error('Simulated review unavailable');
      const rejected = reviewMode === 'rejected';
      return {
        model: 'gemini-test', verdict: rejected ? 'rejected' : 'approved',
        summary: rejected ? 'No cumple' : 'Cumple', reviewPrompt: 'review prompt',
        revisedPrompt: rejected ? 'Prompt corregido' : null,
        criteria: [{ key: 'identity', label: 'Identidad', passed: !rejected, notes: 'n' }],
        marketplaceData: { title: 'Titulo' },
        ...(request.photoTask ? { photoValidation: { fidelity: true, destinations: request.photoTask.destinations
          .map((d: any) => ({ channel: d.channel, position: d.position, passed: true, notes: 'ok' })) } } : {}),
      };
    });
    t.mock.method(budget, 'reserveAutomationOperation', async (...args: any[]) => {
      trace.push(`reserve:${args[2]}:${args[1]}`);
      if (reserveMode === 'budget') throw new budget.AutomationBudgetError('Presupuesto agotado (simulado)');
      return 'op-1';
    });
    t.mock.method(budget, 'settleAutomationOperation', async (...args: any[]) => {
      trace.push(`settle:${args[1]}:${args[2]}:${args[3] ?? '-'}`);
    });
    let claimsSeen: string[] = [];
    const realClaimJob = claims.claimJob;
    t.mock.method(claims, 'claimJob', async (...args: any[]) => {
      const claimed = await realClaimJob(...args);
      trace.push(claimed ? 'claim' : 'claim:none');
      if (claimed?.claimToken) claimsSeen.push(claimed.claimToken);
      return claimed;
    });
    const realClaimCheck = claims.isClaimStillActive;
    t.mock.method(claims, 'isClaimStillActive', async (...args: any[]) => {
      trace.push('claimCheck');
      return claimActive ? realClaimCheck(...args) : false;
    });

    const photoTask = (composition: string, extra: Record<string, unknown> = {}) => ({
      id: `task-${composition}`, itemId: 'item', productId: 'p', variantId: 'v', referencePaths: [paths.garment],
      view: 'front', composition, background: 'neutral', bodyArea: 'upper_body', base: null, syntheticPerformer: false,
      instructions: 'Instrucciones del plan', ...extra,
      destinations: [{ channel: 'mercado-libre', productId: 'p', variantId: 'v', position: 2, role: 'alternative',
        required: true, ruleIds: [] }],
    });

    const baseJob = (overrides: Record<string, unknown> = {}) => ({
      batchId: 'batch-1', clientId: 'client-1', clientNameSnapshot: 'Cliente', modelId: 'model-1',
      modelNameSnapshot: 'Modelo', poseImageId: 'pose-1', poseImagePath: paths.pose, garmentId: 'garment-1',
      garmentName: 'Camisa', garmentFilePath: paths.garment, garmentPhotoId: 'photo-1', garmentView: 'front',
      provider: 'fal-nano-banana-2', aspectRatio: '3:4', imageConfig: { provider: 'fal-nano-banana-2', aspectRatio: '3:4' },
      promptBase: 'Prompt base', requestedPromptBase: 'Prompt pedido', finalPrompt: 'Prompt final',
      generationKind: 'garment', status: 'pending', retryCount: 0, maxRetries: 1, generationAttemptCount: 0,
      autoReviewMaxAttempts: 3, createdByUid: 'user-1', currentOutputId: null, currentOutput: null,
      claimToken: null, ...overrides,
    });

    const snapshot = async (jobId: string, claimTokens: string[]) => {
      const jobRef = db.collection('jobs').doc(jobId);
      const job = (await jobRef.get()).data();
      const outputs = (await jobRef.collection('outputs').get()).docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (a.generationAttempt ?? 0) - (b.generationAttempt ?? 0) || String(a.resultImagePath)
          .localeCompare(String(b.resultImagePath)));
      const replacements: Array<[string, string]> = [[jobId, '<jobId>']];
      outputs.forEach((o: any, i: number) => replacements.push([o.id, `<output${i}>`]));
      claimTokens.filter(Boolean).forEach((c, i) => replacements.push([c, `<claim${i}>`]));
      if (job?.claimToken) replacements.push([job.claimToken, '<activeClaim>']);
      const [files] = await bucket.getFiles({ prefix: `generated/client-1/batch-1/${jobId}/` });
      const storage = await Promise.all(files.map(async (f: any) => ({
        name: f.name, contentType: f.metadata.contentType, cacheControl: f.metadata.cacheControl ?? null,
        bytes: (await f.download())[0],
      })));
      const logs = (await jobRef.collection('logs').get()).docs.map((d: any) => d.data());
      const n = (v: any) => normalize(v, replacements);
      return {
        trace: [...trace].map(n),
        providerCalls: n(providerCalls),
        reviewCalls: n(reviewCalls),
        job: n(job),
        outputs: n(outputs),
        logs: n(logs).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        storage: n(storage).sort((a: any, b: any) => a.name.localeCompare(b.name)),
      };
    };

    const results: Record<string, any> = {};
    let jobCounter = 0;
    const run = async (name: string, job: Record<string, unknown>, opts: {
      provider?: typeof providerMode; review?: typeof reviewMode; reserve?: typeof reserveMode; claimActive?: boolean;
      jobId?: string; source?: 'create' | 'requeue';
    } = {}) => {
      trace = []; providerCalls = []; reviewCalls = [];
      providerMode = opts.provider ?? 'ok'; reviewMode = opts.review ?? 'approved';
      reserveMode = opts.reserve ?? 'ok'; claimActive = opts.claimActive ?? true;
      const jobId = opts.jobId ?? `job-${String(++jobCounter).padStart(2, '0')}`;
      const ref = db.collection('jobs').doc(jobId);
      if (!opts.jobId) await ref.set(job);
      if (!opts.jobId) claimsSeen = []; // a resumed job keeps the tokens of its earlier attempts
      await generation.processJob(jobId, opts.source ?? 'create', { skipBacklogSweep: true });
      results[name] = await snapshot(jobId, claimsSeen);
      return jobId;
    };

    const automation = { automationJobId: 'auto-1', automationManaged: true, automationReferencePaths: [paths.garment, paths.extra] };

    try {
      await run('garment: generate -> approved', baseJob());
      await run('garment: generate -> rejected with retry left', baseJob(), { review: 'rejected' });
      await run('garment: generate -> rejected on last attempt', baseJob({ generationAttemptCount: 2 }), { review: 'rejected' });
      await run('garment: generate -> review error', baseJob(), { review: 'throw' });
      await run('garment: provider error -> retry scheduled', baseJob(), { provider: 'throw' });
      await run('garment: provider error -> retries exhausted', baseJob({ retryCount: 1 }), { provider: 'throw' });
      await run('garment: claim lost after provider', baseJob(), { claimActive: false });
      await run('product: generate -> approved', baseJob({ generationKind: 'product', productReferencePaths: [paths.pose, paths.extra] }));
      await run('product: generate -> rejected with retry left', baseJob({ generationKind: 'product' }), { review: 'rejected' });
      const commercial = { photoProfile: 'commercial-photo-v1' };
      await run('photo: reference reuse -> approved', baseJob({ ...commercial, photoTask: photoTask('reference') }));
      await run('photo: model with background correction -> approved', baseJob({ ...commercial,
        photoTask: photoTask('model', { backgroundCorrection: 'neutral-white-perimeter' }) }));
      await run('photo: model -> rejected with retry left', baseJob({ ...commercial, photoTask: photoTask('model') }),
        { review: 'rejected' });
      await run('photo: final-file validation throws -> provider-style retry',
        baseJob({ photoTask: photoTask('model') }));
      await run('automation: generate -> approved', baseJob(automation));
      await run('automation: product generate -> approved', baseJob({ ...automation, generationKind: 'product' }));
      await run('automation: generate -> rejected with retry left', baseJob(automation), { review: 'rejected' });
      await run('automation: reference reuse skips budget', baseJob({ ...automation, photoTask: photoTask('reference') }));
      await run('automation: provider error -> settle null and retry', baseJob(automation), { provider: 'throw' });
      await run('automation: budget exhausted -> paused', baseJob(automation), { reserve: 'budget' });
      const pendingReview = await run('automation: review error -> review pending', baseJob(automation), { review: 'throw' });
      await run('automation: resume review -> approved', {}, { jobId: pendingReview, source: 'requeue' });
      const exhausted = await run('automation: review error with retries exhausted -> failed',
        baseJob({ ...automation, retryCount: 1 }), { review: 'throw' });
      await db.collection('jobs').doc(exhausted).update({ status: 'pending' });
      await run('automation: resume review after exhausted retries -> rejected', {},
        { jobId: exhausted, source: 'requeue', review: 'rejected' });

      // Inconsistent "review pending" states: only one of currentOutput / currentOutputId is set.
      const strayOutput = { provider: 'fal-nano-banana-2', resultImagePath: paths.garment, contentType: 'image/jpeg',
        remoteUrl: null, requestId: 'old-req', providerResponseSummary: {}, costUsd: 0.08, durationSeconds: 5 };
      await run('automation: review pending with currentOutput but no currentOutputId',
        baseJob({ ...automation, automationReviewPending: true, generationAttemptCount: 1, currentOutput: strayOutput }));
      await run('automation: review pending with currentOutputId but no currentOutput',
        baseJob({ ...automation, automationReviewPending: true, generationAttemptCount: 1, currentOutputId: 'ghost' }));

      const ordered = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
      if (process.env.UPDATE_JOB_WORKER_GOLDEN === '1' || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, `${JSON.stringify(ordered, null, 2)}\n`);
      }
      const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
      for (const name of Object.keys(golden)) {
        assert.deepEqual(JSON.parse(JSON.stringify(ordered[name])), golden[name], `scenario changed: ${name}`);
      }
      assert.deepEqual(Object.keys(ordered), Object.keys(golden));
    } finally {
      await cleanupEmulatorDatabase(db);
    }
  });
