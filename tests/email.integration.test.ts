import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { ClientEmailReceipt } from '../shared/src/types';
const require = createRequire(import.meta.url);
const enabled = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].every(key => /^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || ''));

test('email authorization, OAuth identity/state and send idempotency against emulators, with Google fully mocked', { skip: !enabled }, async t => {
  process.env.GCLOUD_PROJECT = 'demo-manglar-automation';
  process.env.FIRESTORE_DATABASE_ID = '(default)';
  process.env.GMAIL_OAUTH_CLIENT = JSON.stringify({ web: { client_id: 'test-client', client_secret: 'test-secret' } });
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({ projectId: 'demo-manglar-automation' });
  const db = require('../functions/lib/functions/src/firebase/appFirestore.js').getAppFirestore();
  const api = require('../functions/lib/functions/src/email/api.js');
  const { encryptEmailToken } = require('../functions/lib/functions/src/email/domain.js');
  const uid = `email-${randomUUID()}`, clientId = `${uid}-client`;
  const user = db.collection('users').doc(uid), client = db.collection('clients').doc(clientId), connection = db.collection('emailPrivate').doc('gmail');
  const call = (data: object = {}) => ({ auth: { uid, token: { role: 'admin' } }, data });
  const originalFetch = globalThis.fetch;
  let sends = 0, mode = 'success', identity = 'contacto@agenciamanglar.mx';
  globalThis.fetch = async (url: any, init?: any) => {
    const address = String(url);
    if (address.startsWith('http://127.0.0.1:')) return originalFetch(url, init);
    if (address === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'mock-access', refresh_token: 'mock-refresh', scope: 'openid email https://www.googleapis.com/auth/gmail.send' }), { status: 200 });
    if (address === 'https://openidconnect.googleapis.com/v1/userinfo') return new Response(JSON.stringify({ email: identity, email_verified: true }), { status: 200 });
    if (address === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
      sends++;
      if (mode === 'network') throw new Error('simulated connection loss');
      if (mode === 'denied') return new Response('{}', { status: 403 });
      if (mode === 'server') return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ id: `mock-message-${sends}` }), { status: 200 });
    }
    throw new Error(`Unexpected network call: ${address}`);
  };
  const express = require('../functions/node_modules/express');
  const serverApp = express(); serverApp.get('/callback', api.gmailOAuthCallback);
  const server = serverApp.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/callback`;
  const payload = () => ({ clientId, requestId: randomUUID(), to: 'ana@example.com', subject: 'Entrega de fotos', body: 'Tus fotos están listas.' });
  try {
    await client.set({ name: 'Test email', status: 'active', contacts: [{ name: 'Ana', email: 'ana@example.com' }] });
    await user.set({ active: true, role: 'operador', status: 'active' });
    await t.test('current user role overrides forged admin claims', async () => {
      for (const name of ['getGmailConnection', 'startGmailConnection', 'disconnectGmail', 'listClientEmails', 'sendClientEmail']) await assert.rejects(() => api[name].run(call({ clientId })), { code: 'permission-denied' });
    });
    await user.update({ role: 'admin' });
    await t.test('OAuth checks the exact sender and consumes state only once', async () => {
      let start = await api.startGmailConnection.run(call());
      const url = new URL(start.url);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('login_hint'), 'contacto@agenciamanglar.mx');
      const states = await db.collection('emailOAuthStates').get();
      assert.ok(states.docs.every((doc: any) => !('clientId' in doc.data())));
      identity = 'personal@gmail.com';
      const query = `?state=${url.searchParams.get('state')}&code=test-code`;
      let response = await fetch(base + query, { redirect: 'manual' });
      assert.equal(response.headers.get('location'), 'https://tutofb-260320-1003.web.app/configuracion?gmail=error#correo');
      assert.equal((await connection.get()).exists, false);
      response = await fetch(base + query, { redirect: 'manual' }); assert.equal(response.status, 400);
      identity = 'contacto@agenciamanglar.mx'; start = await api.startGmailConnection.run(call());
      response = await fetch(`${base}?state=${new URL(start.url).searchParams.get('state')}&code=test-code`, { redirect: 'manual' });
      assert.equal(response.headers.get('location'), 'https://tutofb-260320-1003.web.app/configuracion?gmail=connected#correo');
      assert.equal((await api.getGmailConnection.run(call())).connected, true);
      assert.deepEqual(Object.keys(await api.getGmailConnection.run(call())).sort(), ['connected', 'sender']);
    });
    await t.test('concurrent retries send once; changed payload cannot reuse the same id', async () => {
      const data = payload();
      const result = await Promise.all([api.sendClientEmail.run(call(data)), api.sendClientEmail.run(call(data))]);
      assert.equal(sends, 1); assert.ok(result.some(item => item.status === 'sent'));
      assert.equal((await api.sendClientEmail.run(call(data))).status, 'sent'); assert.equal(sends, 1);
      await assert.rejects(() => api.sendClientEmail.run(call({ ...data, body: 'Changed' })), { code: 'already-exists' });
    });
    await t.test('only saved contacts of an active client can receive mail', async () => {
      await assert.rejects(() => api.sendClientEmail.run(call({ ...payload(), to: 'foreign@example.com' })), { code: 'invalid-argument' });
      await client.update({ status: 'archived' });
      await assert.rejects(() => api.sendClientEmail.run(call(payload())), { code: 'failed-precondition' });
      await client.update({ status: 'active' });
    });
    await t.test('uncertain sends are never automatically retried', async () => {
      for (const failure of ['network', 'server', 'denied']) {
        mode = failure; const data = payload(); const before = sends;
        const result = await api.sendClientEmail.run(call(data));
        assert.equal(result.status, failure === 'denied' ? 'failed' : 'unknown');
        await api.sendClientEmail.run(call(data)); assert.equal(sends, before + 1);
      }
      mode = 'success';
      const list = await api.listClientEmails.run(call({ clientId })); assert.equal(list.messages.length, 4);
      assert.ok(list.messages.every((item: ClientEmailReceipt) => !('body' in item) && !('token' in item)));
    });
    await t.test('disconnected mailbox prevents sends', async () => {
      await connection.set({ connected: false });
      await assert.rejects(() => api.sendClientEmail.run(call(payload())), { code: 'failed-precondition' });
      await connection.set({ connected: true, token: encryptEmailToken('test', 'test-secret') });
      await user.update({ active: false });
      await assert.rejects(() => api.sendClientEmail.run(call(payload())), { code: 'permission-denied' });
    });
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.recursiveDelete(db.collection('emailPrivate'));
    await db.recursiveDelete(db.collection('emailOAuthStates'));
    await user.delete(); await client.delete(); await admin.app().delete();
  }
});
