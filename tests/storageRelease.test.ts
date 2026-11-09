import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertStorageCors, assertStorageFirestoreAccess } from '../scripts/verify-storage-release.mjs';

const role = 'roles/firebaserules.firestoreServiceAgent';
const member = 'serviceAccount:service-123@gcp-sa-firebasestorage.iam.gserviceaccount.com';

test('Storage release rejects the production failure: Storage service agent without Firestore rules access', () => {
  assert.throws(() => assertStorageFirestoreAccess({ bindings: [
    { role: 'roles/firebasestorage.serviceAgent', members: [member] },
    { role, members: ['serviceAccount:service-123@firebase-rules.iam.gserviceaccount.com'] },
  ] }, '123'), /Storage cannot evaluate Firestore-backed permissions/);
});

test('Storage release requires an unconditional grant to the correct project service agent', () => {
  assert.throws(() => assertStorageFirestoreAccess({ bindings: [{ role, members: [member] }] }, '456'));
  assert.throws(() => assertStorageFirestoreAccess({ bindings: [{ role, members: [member], condition: { expression: 'false' } }] }, '123'));
  assert.doesNotThrow(() => assertStorageFirestoreAccess({ bindings: [{ role, members: [member] }] }, '123'));
});

test('Storage release catches missing local CORS origins without depending on rule order', () => {
  const expected = JSON.parse(fs.readFileSync(new URL('../cors.json', import.meta.url), 'utf8'));
  for (const host of ['localhost', '127.0.0.1']) for (const port of [3000, 3001, 3002]) {
    const origin = `http://${host}:${port}`;
    assert.ok(expected.some(rule => rule.origin.includes(origin)), origin);
    const oldCors = expected.map(rule => ({ ...rule, origin: rule.origin.filter(value => value !== origin) }));
    assert.throws(() => assertStorageCors(oldCors, expected), /Storage CORS differs/);
  }
  assert.ok(expected.every(rule => !rule.origin.includes('*')));
  assert.throws(() => assertStorageCors(undefined, expected), /Storage CORS differs/);
  const reordered = expected.map(rule => ({ ...rule, origin: [...rule.origin].reverse(), responseHeader: [...rule.responseHeader].reverse() })).reverse();
  assert.doesNotThrow(() => assertStorageCors(reordered, expected));
});
