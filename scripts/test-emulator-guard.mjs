import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
assert.equal(process.versions.node.split('.')[0], '22', 'Run the isolated suite with Node 22.');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-manglar-automation');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'])
  assert.match(process.env[key] ?? '', /^(127\.0\.0\.1|localhost):\d+$/, `${key} must be loopback`);
const allowed = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host));
for (const [module, method] of [[net, 'connect'], [net, 'createConnection'], [tls, 'connect']]) {
  const original = module[method];
  module[method] = function (...args) {
    const options = args[0];
    const host = typeof options === 'object' ? options.host ?? options.hostname ?? 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
    assert.ok(allowed(host), `External network blocked in tests: ${host}`);
    return original.apply(this, args);
  };
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input));
  assert.ok(allowed(url.hostname), `External fetch blocked in tests: ${url.hostname}`);
  return nativeFetch(input, options);
};
