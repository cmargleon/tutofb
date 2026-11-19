import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { normalizeClientContacts, isClientContactsDraft } = createRequire(import.meta.url)('../functions/lib/shared/src/clientContacts.js') as typeof import('../shared/src/clientContacts');

test('client contacts support multiple people, trim fields and preserve email spelling', () => {
  assert.deepEqual(normalizeClientContacts([{ name: ' Ana ', email: ' Ana@example.com ' }, { name: 'Luis', email: 'luis@example.com' }]), [
    { name: 'Ana', email: 'Ana@example.com' }, { name: 'Luis', email: 'luis@example.com' },
  ]);
  assert.deepEqual(normalizeClientContacts([]), []);
});

test('client contacts reject malformed lists, incomplete people and invalid addresses', () => {
  for (const value of [null, {}, [null], [{ name: 'Ana' }], [{ name: ' ', email: 'ana@example.com' }], [{ name: 'Ana', email: 'invalid' }], [{ name: 'Ana', email: 'a@b@c.com' }], Array.from({ length: 101 }, () => ({ name: 'Ana', email: 'ana@example.com' }))]) {
    assert.throws(() => normalizeClientContacts(value));
  }
  assert.equal(isClientContactsDraft([{ name: '', email: '' }]), true);
  assert.equal(isClientContactsDraft([{ name: 5, email: '' }]), false);
});
