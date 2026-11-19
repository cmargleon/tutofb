import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { validateEmail, buildEmailMime, encryptEmailToken, decryptEmailToken, emailFingerprint } = require('../functions/lib/functions/src/email/domain.js');
const input = () => ({ clientId: 'client-a', requestId: randomUUID(), to: 'ana@example.com', subject: 'Tus fotografías están listas', body: 'Hola Ana,\nAquí está tu entrega.\nManglar' });
const contacts = [{ name: 'Ana', email: 'ana@example.com' }];

test('email validates saved recipients and rejects header injection, invalid IDs and excessive payloads', () => {
  const value = input();
  assert.deepEqual(validateEmail({ ...value, subject: ` ${value.subject} ` }, contacts), value);
  for (const patch of [ { to: 'other@example.com' }, { to: 'ana@example.com\r\nBcc: victim@example.com' }, { to: 'ana@example.com,b@example.com' }, { subject: 'Hola\r\nBcc: victim@example.com' }, { subject: '' }, { subject: 'a'.repeat(161) }, { body: ' ' }, { body: 'a'.repeat(20001) }, { requestId: '../invalid' }, { clientId: '../invalid' } ]) {
    assert.throws(() => validateEmail({ ...value, ...patch }, contacts), { code: 'invalid-argument' });
  }
});
test('MIME uses a fixed sender, safe Unicode headers, base64 body and a stable message ID', () => {
  const value = input(); value.subject = 'Fotografías para mañana: ¡qué bonitas! '.repeat(4);
  const mime = Buffer.from(buildEmailMime(value), 'base64url').toString('utf8');
  assert.ok(mime.startsWith('From: Manglar <contacto@agenciamanglar.mx>\r\nTo: <ana@example.com>\r\n'));
  assert.ok(mime.includes(`Message-ID: <${value.requestId}@agenciamanglar.mx>`));
  const [headers, body] = mime.split('\r\n\r\n');
  const encoded = [...headers.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(match => Buffer.from(match[1], 'base64').toString('utf8')).join('');
  assert.equal(encoded, value.subject);
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString(), value.body.replace(/\n/g, '\r\n'));
  assert.ok(headers.split('\r\n').every(line => line.length < 998));
});
test('stored refresh tokens are encrypted, authenticated and bound to the secret', () => {
  const secret = 'test-oauth-secret';
  const encrypted = encryptEmailToken('refresh-token-private', secret);
  assert.ok(!encrypted.includes('refresh-token-private'));
  assert.equal(decryptEmailToken(encrypted, secret), 'refresh-token-private');
  assert.notEqual(encrypted, encryptEmailToken('refresh-token-private', secret));
  assert.throws(() => decryptEmailToken(encrypted, 'wrong-secret'));
  const parts = encrypted.split('.'); parts[1] = Buffer.alloc(16).toString('base64url');
  assert.throws(() => decryptEmailToken(parts.join('.'), secret));
  assert.notEqual(emailFingerprint(input()), emailFingerprint({ ...input(), body: 'Otro mensaje' }));
});
test('all email callables reject unauthenticated users before accessing Firestore or Google', async () => {
  const api = require('../functions/lib/functions/src/email/api.js');
  for (const name of ['getGmailConnection', 'startGmailConnection', 'disconnectGmail', 'listClientEmails', 'sendClientEmail']) {
    await assert.rejects(() => api[name].run({ data: {} }), { code: 'unauthenticated' });
  }
});
