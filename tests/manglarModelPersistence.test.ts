import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createEmptyModelIdentityTraits, normalizeModelIdentityTraits } from '../src/features/models/identityTraits';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);

test('model persistence through authenticated HTTP MCP and callable endpoints (emulators only)', { skip: !enabled }, async (t) => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'])
    assert.match(process.env[key]!, /^(127\.0\.0\.1|localhost):/);
  const projectId = 'demo-manglar-automation';
  process.env.GCLOUD_PROJECT = projectId;
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const bucket = admin.storage().bucket();
  const oauth = require('../functions/lib/functions/src/automation/mcpOAuth.js');
  const helpers = require('../functions/lib/functions/src/automation/mcpOAuth.helpers.js');
  const { manglarMcpHandler } = require('../functions/lib/functions/src/automation/mcp.js');
  const { saveModel } = require('../functions/lib/functions/src/manglar/catalogService.js');
  const express = require('../functions/node_modules/express');
  const app = express();
  app.use(express.json({ verify: (req: any, _res: any, bytes: Buffer) => { req.rawBody = bytes; } }));
  app.post('/saveModel', saveModel);
  app.post('/decideManglarConnection', oauth.decideManglarConnection);
  app.use(manglarMcpHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = globalThis.fetch;
  const clientId = 'https://chatgpt.com/oauth/client.json';
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
  // Only OAuth client metadata is simulated. No paid providers or production HTTP are allowed.
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url) === clientId)
      return Response.json({ client_id: clientId, redirect_uris: [redirectUri], token_endpoint_auth_methods_supported: ['none'] });
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(String(url)).hostname), `External request: ${url}`);
    return nativeFetch(url, options);
  }) as typeof fetch;
  const post = async (path: string, body: any, token?: string) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  let serial = 0;
  const rpc = (name: string, args: any, token?: string) => post('/api/manglar/mcp', { jsonrpc: '2.0', id: ++serial, method: 'tools/call', params: { name, arguments: args } }, token);
  const ok = (response: any) => {
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.ok(!response.body.result?.isError, JSON.stringify(response.body));
    return response.body.result.structuredContent;
  };
  const error = (response: any, code: string) => {
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.body.result?.isError, true, JSON.stringify(response.body));
    assert.equal(response.body.result.structuredContent.error.code, code, JSON.stringify(response.body));
  };
  const connect = async (role: string) => {
    const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `model-persistence-${role}-${Date.now()}@example.test`, password: 'emulator-password', returnSecureToken: true }) });
    const { localId: uid, idToken } = await signup.json() as any;
    assert.ok(uid);
    await db.collection('users').doc(uid).set({ role, active: true, status: 'active' });
    await db.collection('manglarAccess').doc(uid).set({ enabled: true, clientIds: ['persistence-client'], version: 1 });
    const verifier = 'persistence-verifier-'.repeat(4);
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state: 'test-state', resource: helpers.MANGLAR_MCP_RESOURCE, response_type: 'code', code_challenge: helpers.pkceChallenge(verifier), code_challenge_method: 'S256', scope: 'jobs:read jobs:create' });
    const redirect = await fetch(`${base}/api/manglar/oauth/authorize?${params}`, { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    const requestId = new URL(redirect.headers.get('location')!).searchParams.get('request');
    const consent = await post('/decideManglarConnection', { data: { requestId, approve: true, authorizationModel: 'user-v1' } }, idToken);
    assert.equal(consent.status, 200, JSON.stringify(consent));
    const code = new URL(consent.body.result.redirectUrl).searchParams.get('code');
    const tokens = await post('/api/manglar/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, resource: helpers.MANGLAR_MCP_RESOURCE, code, code_verifier: verifier });
    assert.equal(tokens.status, 200, JSON.stringify(tokens));
    return { uid, idToken, token: tokens.body.access_token };
  };
  const prepare = async (token: string, domain: string, action: string, data: any) => {
    const paid = domain === 'models';
    const result = ok(await rpc('manglar_prepare_action', { domain, action, data, idempotencyKey: `persistence-${Date.now()}-${++serial}`, ...(paid ? { budgetUsd: 1, allowEstimatedCosts: true } : {}) }, token));
    return { operationId: result.operationId, confirmationToken: result.confirmationToken, ...(paid ? { confirmedBudgetUsd: 1 } : {}) };
  };
  const save = async (token: string, data: any) => {
    const authorization = await prepare(token, 'models', 'save', data);
    const args = { action: 'save', data, authorization };
    return { result: ok(await rpc('manglar_models', args, token)), args };
  };
  const discard = async (token: string, path: string) => {
    const data = { storagePath: path };
    const authorization = await prepare(token, 'files', 'discard', data);
    return { response: await rpc('manglar_files', { action: 'discard', data, authorization }, token), args: { action: 'discard', data, authorization } };
  };
  const upload = async (path: string) => { await bucket.file(path).save(png, { metadata: { contentType: 'image/png' } }); return path; };
  const traits = { sex: 'femenino', age: '30', skin: null, hairColor: null, hairLength: null, build: null };
  try {
    await db.collection('clients').doc('persistence-client').set({ name: 'Persistence emulator', status: 'active' });
    const a = await connect('admin');
    const operator = await connect('operador');
    const reviewer = await connect('revisor');

    await t.test('temporary photo survives authorized discard through a permanent model copy; retries are idempotent', async () => {
      const path = await upload(`garments/drafts/${a.uid}/persistence/new/source.png`);
      const data = { clientId: 'persistence-client', name: 'Permanent photo', posesToAdd: [{ storagePath: path, fileName: 'source.png' }] };
      const saved = await save(a.token, data);
      assert.deepEqual(ok(await rpc('manglar_models', saved.args, a.token)), saved.result);
      const cleanup = await discard(a.token, path);
      ok(cleanup.response);
      assert.deepEqual(ok(await rpc('manglar_files', cleanup.args, a.token)), { discarded: true });
      assert.equal((await bucket.file(path).exists())[0], false);
      const model = (await db.collection('models').doc(saved.result.id).get()).data();
      assert.equal(model.poses.length, 1);
      assert.match(model.poses[0].storagePath, new RegExp(`^models/persistence-client/${saved.result.id}/poses/`));
      assert.equal(model.coverPosePath, model.poses[0].storagePath);
      assert.deepEqual((await bucket.file(model.poses[0].storagePath).download())[0], png);
      assert.equal((await bucket.getFiles({ prefix: `models/persistence-client/${saved.result.id}/poses/` }))[0].length, 1);
      error((await discard(a.token, model.poses[0].storagePath)).response, 'permission-denied');
    });

    await t.test('identity traits: omitted preserves, values replace, explicit null clears via MCP and empty UI fields via callable', async () => {
      const path = await upload(`garments/drafts/${a.uid}/persistence/identity/source.png`);
      const created = await save(a.token, { clientId: 'persistence-client', name: 'Identity', identityTraits: traits, posesToAdd: [{ storagePath: path, fileName: 'source.png' }] });
      const ref = db.collection('models').doc(created.result.id);
      const data = { id: ref.id, clientId: 'persistence-client', name: 'Identity edited' };
      await save(a.token, data);
      assert.deepEqual((await ref.get()).data().identityTraits, traits);
      const changed = { ...traits, age: '40', hairColor: 'castaño' };
      await save(a.token, { ...data, identityTraits: changed });
      assert.deepEqual((await ref.get()).data().identityTraits, changed);
      await save(a.token, { ...data, identityTraits: null });
      assert.equal((await ref.get()).data().identityTraits, null);
      await save(a.token, { ...data, identityTraits: changed });
      const emptyUi = normalizeModelIdentityTraits(createEmptyModelIdentityTraits());
      assert.equal(emptyUi, null);
      assert.equal((await post('/saveModel', { data: { ...data, identityTraits: emptyUi } }, a.idToken)).status, 200);
      assert.equal((await ref.get()).data().identityTraits, null);
    });

    await t.test('foreign drafts are denied; unused own temporaries can be discarded', async () => {
      const foreign = await upload(`garments/drafts/${operator.uid}/persistence/foreign/source.png`);
      error(await rpc('manglar_prepare_action', { domain: 'files', action: 'discard', data: { storagePath: foreign }, idempotencyKey: 'foreign-draft' }, a.token), 'permission-denied');
      assert.deepEqual((await bucket.file(foreign).download())[0], png);
      for (const path of [`garments/drafts/${operator.uid}/persistence/unused.png`, `wizard_source_spreadsheets/${operator.uid}/persistence/source.xlsx`, `model_imports/${operator.uid}/persistence/model.zip`]) {
        await upload(path);
        ok((await discard(operator.token, path)).response);
        assert.equal((await bucket.file(path).exists())[0], false);
      }
    });

    await t.test('all four job reference fields still block confirmed discard and preserve Firestore and Storage', async () => {
      for (const field of ['garmentFilePath', 'poseImagePath', 'productReferencePaths', 'automationReferencePaths']) {
        const path = await upload(`garments/drafts/${a.uid}/persistence/jobs/${field}.png`);
        const ref = db.collection('jobs').doc(`persistence-${a.uid}-${field}`);
        const job = { clientId: 'persistence-client', createdByUid: a.uid, status: 'completed', [field]: field.endsWith('Paths') ? [path] : path };
        await ref.set(job);
        error((await discard(a.token, path)).response, 'failed-precondition');
        assert.deepEqual((await ref.get()).data(), job);
        assert.deepEqual((await bucket.file(path).download())[0], png);
      }
    });

    await t.test('historical non-cover poses, previews and archived models are protected without an index or migration', async () => {
      for (const kind of ['pose', 'preview', 'cover']) {
        const path = await upload(`garments/drafts/${a.uid}/persistence/historical/${kind}.png`);
        const ref = db.collection('models').doc(`persistence-${a.uid}-${kind}`);
        const model = { clientId: 'foreign-client', name: 'Historical archived model', status: 'archived', poses: [
          { id: 'first', storagePath: 'models/old-client/old-model/poses/first.png' },
          { id: 'second', storagePath: kind === 'pose' ? path : 'models/old-client/old-model/poses/second.png', ...(kind === 'preview' ? { previewStoragePath: path } : {}) },
        ], coverPosePath: kind === 'cover' ? path : 'models/old-client/old-model/poses/first.png' };
        await ref.set(model);
        error((await discard(a.token, path)).response, 'failed-precondition');
        assert.deepEqual((await ref.get()).data(), model);
        assert.deepEqual((await bucket.file(path).download())[0], png);
      }
    });

    await t.test('editing a moved historical model keeps its Storage root and existing poses', async () => {
      const ref = db.collection('models').doc(`persistence-${a.uid}-moved`);
      const root = `models/old-client/${ref.id}`;
      const existing = await upload(`${root}/poses/old.png`);
      const pose = { id: 'old', storagePath: existing, fileName: 'old.png' };
      await ref.set({ name: 'Moved model', clientId: 'persistence-client', status: 'active', storageRootPath: root, poses: [pose] });
      const path = await upload(`garments/drafts/${a.uid}/persistence/moved/new.png`);
      await save(a.token, { id: ref.id, clientId: 'persistence-client', name: 'Moved edited', posesToAdd: [{ storagePath: path, fileName: 'new.png' }] });
      ok((await discard(a.token, path)).response);
      const model = (await ref.get()).data();
      assert.equal(model.storageRootPath, root);
      assert.deepEqual(model.poses[0], pose);
      assert.ok(model.poses[1].storagePath.startsWith(`${root}/poses/`));
      for (const saved of model.poses) assert.deepEqual((await bucket.file(saved.storagePath).download())[0], png);
    });

    await t.test('save/discard concurrency: discard wins after validation, so no broken model is committed', async (race) => {
      const path = await upload(`garments/drafts/${a.uid}/persistence/race-delete/source.png`);
      const id = `persistence-${a.uid}-discard-wins`;
      const data = { id, clientId: 'persistence-client', name: 'Discard wins', posesToAdd: [{ storagePath: path, fileName: 'source.png' }] };
      const authorization = await prepare(a.token, 'models', 'save', data);
      const prototype = Object.getPrototypeOf(bucket.file(path));
      const originalCopy = prototype.copy;
      let entered!: () => void;
      let release!: () => void;
      const copying = new Promise<void>(resolve => { entered = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      race.mock.method(prototype, 'copy', async function (this: any, ...args: any[]) {
        if (this.name === path) { entered(); await resume; }
        return originalCopy.apply(this, args);
      });
      const pending = rpc('manglar_models', { action: 'save', data, authorization }, a.token);
      try {
        await copying;
        ok((await discard(a.token, path)).response);
      } finally { release(); }
      const result = await pending;
      assert.equal(result.body.result.isError, true, JSON.stringify(result));
      assert.equal((await db.collection('models').doc(id).get()).exists, false);
      assert.equal((await bucket.file(path).exists())[0], false);
    });

    await t.test('save/discard concurrency: copy wins before Firestore commit, leaving valid model bytes', async (race) => {
      const path = await upload(`garments/drafts/${a.uid}/persistence/race-copy/source.png`);
      const id = `persistence-${a.uid}-copy-wins`;
      const data = { id, clientId: 'persistence-client', name: 'Copy wins', posesToAdd: [{ storagePath: path, fileName: 'source.png' }] };
      const authorization = await prepare(a.token, 'models', 'save', data);
      const prototype = Object.getPrototypeOf(bucket.file(path));
      const originalCopy = prototype.copy;
      let entered!: () => void;
      let release!: () => void;
      const copied = new Promise<void>(resolve => { entered = resolve; });
      const resume = new Promise<void>(resolve => { release = resolve; });
      race.mock.method(prototype, 'copy', async function (this: any, ...args: any[]) {
        const result = await originalCopy.apply(this, args);
        if (this.name === path) { entered(); await resume; }
        return result;
      });
      const pending = rpc('manglar_models', { action: 'save', data, authorization }, a.token);
      try {
        await copied;
        ok((await discard(a.token, path)).response);
      } finally { release(); }
      ok(await pending);
      const model = (await db.collection('models').doc(id).get()).data();
      assert.equal((await bucket.file(path).exists())[0], false);
      assert.equal(model.coverPosePath, model.poses[0].storagePath);
      assert.deepEqual((await bucket.file(model.poses[0].storagePath).download())[0], png);
    });

    await t.test('authentication, roles, client scope and exact confirmation precede mutations', async () => {
      const path = await upload(`garments/drafts/${a.uid}/persistence/confirmation/source.png`);
      const data = { storagePath: path };
      assert.equal((await rpc('manglar_files', { action: 'discard', data })).status, 401);
      error(await rpc('manglar_files', { action: 'discard', data }, a.token), 'failed-precondition');
      const authorization = await prepare(a.token, 'files', 'discard', data);
      error(await rpc('manglar_files', { action: 'discard', data, authorization: { ...authorization, confirmationToken: 'wrong' } }, a.token), 'permission-denied');
      error(await rpc('manglar_files', { action: 'discard', data, authorization }, operator.token), 'permission-denied');
      error(await rpc('manglar_prepare_action', { domain: 'files', action: 'discard', data, idempotencyKey: 'reviewer-discard' }, reviewer.token), 'permission-denied');
      error(await rpc('manglar_prepare_action', { domain: 'models', action: 'save', data: { clientId: 'foreign', name: 'Forbidden' }, idempotencyKey: 'foreign-model', budgetUsd: 1, allowEstimatedCosts: true }, a.token), 'permission-denied');
      error(await rpc('manglar_prepare_action', { domain: 'models', action: 'save', data: { clientId: 'persistence-client', name: 'Forbidden' }, idempotencyKey: 'operator-model', budgetUsd: 1, allowEstimatedCosts: true }, operator.token), 'permission-denied');
      assert.equal((await bucket.file(path).exists())[0], true);
    });

    await t.test('oversized historical catalog fails closed and keeps the temporary bytes', async () => {
      const refs = Array.from({ length: 501 }, (_, index) => db.collection('models').doc(`persistence-cap-${a.uid}-${index}`));
      try {
        for (let offset = 0; offset < refs.length; offset += 500) {
          const batch = db.batch();
          for (const ref of refs.slice(offset, offset + 500)) batch.set(ref, { poses: [] });
          await batch.commit();
        }
        const path = await upload(`garments/drafts/${a.uid}/persistence/cap/source.png`);
        error((await discard(a.token, path)).response, 'failed-precondition');
        assert.deepEqual((await bucket.file(path).download())[0], png);
      } finally {
        // Only these emulator fixtures; never production data or a migration.
        for (let offset = 0; offset < refs.length; offset += 500) {
          const batch = db.batch();
          for (const ref of refs.slice(offset, offset + 500)) batch.delete(ref);
          await batch.commit();
        }
      }
    });
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((err: Error | undefined) => err ? reject(err) : resolve()));
    await db.terminate();
    await admin.app().delete();
  }
});
