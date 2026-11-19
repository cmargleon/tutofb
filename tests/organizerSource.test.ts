import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(new URL('../functions/package.json', import.meta.url));

test('el JPEG se congela con precondición de creación y toda reutilización revalida el original', async ({ mock }) => {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-organizer-source', storageBucket: 'demo-organizer-source.appspot.com' });
  const { freezeOriginal } = require('./lib/functions/src/organizer/source.js');
  const sharp = require('sharp');
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().toBuffer();
  let exists = false, reads = 0, checks = 0, writes = 0, rejectSource = false;
  const paths: string[] = [];
  mock.method(admin.storage(), 'bucket', () => ({ file: (path: string) => {
    paths.push(path);
    return { exists: async () => [exists], save: async (_bytes: Buffer, options: any) => {
      assert.deepEqual(options.preconditionOpts, { ifGenerationMatch: 0 }); writes++; exists = true;
    } };
  } }));
  const drive = { assertSource: async () => { checks++; if (rejectSource) throw Error('El origen cambió'); }, sourceImage: async () => { reads++; return bytes; } };
  const entry = { id: 'photo', version: '1', md5Checksum: 'content' };
  try {
    await freezeOriginal(drive, entry, 'operator', 'client');
    await freezeOriginal(drive, { ...entry, version: '2' }, 'operator', 'client');
    assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(checks, 4);
    assert.equal(paths[0], paths[1], 'La misma imagen conserva el JPEG aunque cambie la versión de metadatos');
    rejectSource = true;
    await assert.rejects(() => freezeOriginal(drive, entry, 'operator', 'client'), /origen cambió/);
    assert.equal(writes, 1);
  } finally { await app.delete(); }
});

test('reportes privados se firman por ejecución y rechazan rutas de otro cliente', async ({ mock }) => {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: 'demo-organizer-reports', storageBucket: 'demo-organizer-reports.appspot.com' });
  const { reportLinks } = require('./lib/functions/src/organizer/reports.js');
  const paths: string[] = [];
  mock.method(admin.storage(), 'bucket', () => ({ file: (path: string) => ({ getSignedUrl: async (options: any) => {
    assert.equal(options.action, 'read'); assert.ok(options.expires > Date.now());
    assert.match(options.responseDisposition, /^attachment;/); paths.push(path); return ['https://signed.invalid/download'];
  } }) }));
  try {
    const run = { clientId: 'client', id: 'run', reportPath: 'organizers/client/runs/run/report.json', controlSheetPath: 'organizers/client/runs/run/control.xlsx' };
    assert.equal((await reportLinks(run)).reportUrl, 'https://signed.invalid/download');
    assert.equal(paths.length, 2);
    assert.deepEqual(await reportLinks({ ...run, reportPath: 'organizers/other/runs/run/report.json', controlSheetPath: null }), { reportUrl: null, controlSheetUrl: null });
    assert.equal(paths.length, 2);
  } finally { await app.delete(); }
});
