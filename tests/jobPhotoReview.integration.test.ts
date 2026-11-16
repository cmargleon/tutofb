import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Job } from '../shared/src/types';

const require = createRequire(import.meta.url);
const { resolveApprovedJobOutput, DEFAULT_IMAGE_PROVIDER } = require('../shared/src/domain') as typeof import('../shared/src/domain');
const local = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']
  .every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? ''));

test('output review appends concurrent feedback and directs only an explicit, authorized regeneration', { skip: !local }, async () => {
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_DATABASE_ID = '(default)';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db: FirebaseFirestore.Firestore = admin.firestore();
  const { recordJobRejection } = require('../functions/lib/functions/src/callables/recordJobRejection.js');
  const { regenerateJob } = require('../functions/lib/functions/src/callables/regenerateJob.js');
  const { selectJobOutput } = require('../functions/lib/functions/src/callables/selectJobOutput.js');
  const { persistGeneratedAttempt } = require('../functions/lib/functions/src/workers/jobWorker.persistence.js');
  const clientId = 'review-client';
  const job = db.collection('jobs').doc();
  const readJob = async (): Promise<Job> => {
    const data = (await job.get()).data();
    assert.ok(data);
    return data as Job;
  };
  const users = ['operador', 'revisor', 'operador'].map(() => db.collection('users').doc(randomUUID()));
  const auth = (i: number) => ({ uid: users[i].id, token: {} });
  const current = { id: 'latest', resultImagePath: 'generated/current.jpg', provider: DEFAULT_IMAGE_PROVIDER,
    aspectRatio: '3:4', autoReview: { verdict: 'approved' } };
  const historical = { id: 'older', resultImagePath: 'generated/earlier.jpg', provider: 'fal-gpt-image-2',
    aspectRatio: '1:1', imageConfig: { aspectRatio: '1:1' } };
  const basePrompt = 'Conservar color, silueta, logo e identidad del producto.';
  try {
    await Promise.all(users.map((ref, i) => ref.set({ role: i === 1 ? 'revisor' : 'operador', active: true,
      displayName: `Persona ${i}`, clientAccess: { mode: 'assigned', clientIds: [i === 2 ? 'foreign' : clientId] } })));
    await job.set({ batchId: 'batch', clientId, clientNameSnapshot: 'Cliente local', garmentId: 'item', garmentName: 'Artículo',
      modelId: 'model', modelNameSnapshot: 'Modelo local', poseImageId: 'pose', status: 'completed', currentOutput: current,
      currentOutputId: current.id, generationKind: 'product', provider: current.provider, aspectRatio: current.aspectRatio,
      promptBase: basePrompt, requestedPromptBase: basePrompt, manualRegenerationCount: 0 });
    await job.collection('outputs').doc(historical.id).set(historical);
    await job.collection('outputs').doc(current.id).set(current);

    const rejection = { jobId: job.id, outputId: historical.id, reasons: ['incorrect_color', 'framing'], note: ' Corrige el rojo. ' };
    await assert.rejects(recordJobRejection.run({ auth: auth(2), data: rejection }), { code: 'permission-denied' });
    await assert.rejects(recordJobRejection.run({ auth: auth(0), data: { ...rejection, outputId: 'missing' } }), { code: 'not-found' });
    await assert.rejects(recordJobRejection.run({ auth: auth(0), data: { ...rejection, reasons: ['invalid'] } }), { code: 'invalid-argument' });
    const results = await Promise.all([0, 1].map(i => recordJobRejection.run({ auth: auth(i), data: rejection })));
    assert.notEqual(results[0].feedbackId, results[1].feedbackId);
    const entries = (await job.collection('logs').where('humanFeedback.outputId', '==', historical.id).get()).docs;
    assert.equal(entries.length, 2);
    assert.deepEqual(new Set(entries.map(entry => entry.get('humanFeedback.authorUid'))), new Set(users.slice(0, 2).map(ref => ref.id)));
    for (const entry of entries) {
      assert.deepEqual(entry.get('humanFeedback.reasons'), rejection.reasons);
      assert.equal(entry.get('humanFeedback.note'), 'Corrige el rojo.');
      assert.equal(entry.get('humanFeedback.provider'), historical.provider);
      assert.deepEqual(entry.get('humanFeedback.imageConfig'), historical.imageConfig);
      assert.ok(entry.get('createdAt').toMillis() > 0);
    }
    assert.equal((await job.get()).get('status'), 'completed');
    assert.equal((await job.get()).get('manualRegenerationCount'), 0);
    assert.deepEqual((await job.get()).get('currentOutput'), current);

    const correction = { feedbackId: results[0].feedbackId, text: 'Conservar el rojo original y centrar el producto.' };
    const request = { jobId: job.id, provider: historical.provider, prompt: 'Base enviada por el navegador', correction };
    await assert.rejects(regenerateJob.run({ auth: auth(1), data: request }), { code: 'permission-denied' });
    await assert.rejects(regenerateJob.run({ auth: auth(2), data: request }), { code: 'permission-denied' });
    await assert.rejects(regenerateJob.run({ auth: auth(0), data: { ...request, correction: { ...correction, feedbackId: 'not-for-this-job' } } }), { code: 'not-found' });
    await regenerateJob.run({ auth: auth(0), data: request });
    await assert.rejects(regenerateJob.run({ auth: auth(0), data: request }), { code: 'failed-precondition' });
    const queued = await readJob();
    assert.equal(queued.status, 'pending');
    assert.equal(queued.manualRegenerationCount, 1);
    assert.equal(queued.provider, current.provider);
    assert.equal(queued.aspectRatio, current.aspectRatio);
    assert.equal(queued.currentOutputId, current.id);
    assert.ok(queued.finalPrompt.includes(basePrompt) && queued.finalPrompt.includes(correction.text));
    assert.ok(!queued.finalPrompt.includes(request.prompt));
    assert.equal(queued.retainedApprovedOutput?.id, current.id);

    // Exercise the worker's persistence with a local image and no provider call.
    const sharp = require('../functions/node_modules/sharp');
    const imageBytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#447766' } }).png().toBuffer();
    const finish = async () => {
      await job.update({ status: 'processing', claimToken: 'local-claim' });
      return persistGeneratedAttempt({
        claimedJob: { ...(await job.get()).data(), id: job.id },
        providerResult: { provider: current.provider, imageBytes, contentType: 'image/png', remoteUrl: null, requestId: null, responseSummary: null },
        durationSeconds: 1, generationAttempt: 1, nextStatus: 'completed', autoReview: null, failureInfo: null, lastError: null,
      });
    };
    assert.equal(await finish(), true);
    assert.equal(resolveApprovedJobOutput(await readJob())?.id, current.id);
    await selectJobOutput.run({ auth: auth(1), data: { jobId: job.id, outputId: historical.id } });
    const approved = await readJob();
    assert.equal(approved.retainedApprovedOutput, null);
    assert.equal(resolveApprovedJobOutput(approved)?.id, historical.id);
    await regenerateJob.run({ auth: auth(0), data: request });
    assert.equal(await finish(), true);
    const regenerated = await readJob();
    assert.equal(regenerated.userSelectedOutputId, historical.id);
    assert.equal(resolveApprovedJobOutput(regenerated)?.id, historical.id);
    assert.equal((await job.collection('outputs').get()).size, 4);
  } finally {
    await admin.storage().bucket().deleteFiles({ prefix: `generated/${clientId}/batch/${job.id}/` });
    await db.recursiveDelete(job);
    await Promise.all(users.map(ref => ref.delete()));
    await app.delete();
  }
});

test('the image endpoint serves only this client and references registered for the reviewed article', { skip: !local }, async () => {
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_DATABASE_ID = '(default)';
  const admin = require('../functions/node_modules/firebase-admin');
  const app = admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db: FirebaseFirestore.Firestore = admin.firestore();
  const user = db.collection('users').doc(randomUUID());
  const job = db.collection('jobs').doc();
  const other = db.collection('jobs').doc();
  const path = `garments/drafts/different-uploader/reviews/${job.id}/front.png`;
  const file = admin.storage().bucket().file(path);
  const express = require('../functions/node_modules/express');
  const appServer = express();
  const { publicGeneratedImage } = require('../functions/lib/functions/src/http/publicGeneratedImage.js');
  appServer.use(publicGeneratedImage);
  const server = appServer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await admin.auth().createUser({ uid: user.id, email: `${user.id}@example.test`, password: 'emulator-password' });
    await user.set({ active: true, role: 'revisor', clientAccess: { mode: 'assigned', clientIds: ['review-client'] } });
    await job.set({ clientId: 'review-client', garmentReferencePaths: [path] });
    await other.set({ clientId: 'outside', garmentReferencePaths: [path] });
    await file.save(Buffer.from('fixture'), { contentType: 'image/png' });
    const signin = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${user.id}@example.test`, password: 'emulator-password', returnSecureToken: true }),
    });
    const { idToken } = await signin.json() as { idToken: string };
    assert.ok(idToken);
    const address = server.address() as { port: number };
    const reference = (id: string, image: string, authorized = true) => fetch(
      `http://127.0.0.1:${address.port}/review-reference/${id}/${image}`,
      { headers: authorized ? { Authorization: `Bearer ${idToken}` } : {} },
    );
    assert.equal((await reference(job.id, path)).status, 200);
    assert.equal((await reference(job.id, path, false)).status, 401);
    assert.equal((await reference(other.id, path)).status, 403);
    assert.equal((await reference(job.id, path.replace('front.png', 'never-registered.png'))).status, 403);
    const directLogWrite = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/jobs/${job.id}/logs/forged`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { outputId: { stringValue: 'untrusted' } } }),
    });
    assert.equal(directLogWrite.status, 403);
  } finally {
    await Promise.allSettled([file.delete(), job.delete(), other.delete(), user.delete(), admin.auth().deleteUser(user.id)]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await app.delete();
  }
});
