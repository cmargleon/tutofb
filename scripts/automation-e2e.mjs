#!/usr/bin/env node
// Real production API probe, explicitly scoped to the dedicated test client.
// Uses the current operator's gcloud login only to fetch the test OAuth credential.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { ManglarAutomationClient } from './manglar-work-client.mjs';
const require = createRequire(import.meta.url);
const sharp = require('../functions/node_modules/sharp');
const reportPath = new URL('../docs/AUTOMATION_E2E_RESULT.json', import.meta.url);
const sourcePage = 'https://commons.wikimedia.org/wiki/File:A_white_mug_filled_with_warm_coffee.jpg';
const imageUrl = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/81/A_white_mug_filled_with_warm_coffee.jpg/1280px-A_white_mug_filled_with_warm_coffee.jpg';
async function getClientSecret() {
  const cloudToken = execFileSync('gcloud', ['auth', 'print-access-token', '--project', 'tutofb-260320-1003'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const response = await fetch('https://secretmanager.googleapis.com/v1/projects/tutofb-260320-1003/secrets/MANGLAR_WORK_CLIENT_SECRET/versions/latest:access', { headers: { Authorization: `Bearer ${cloudToken}` } });
  if (!response.ok) throw new Error(`Secret read HTTP ${response.status}; credential not logged.`);
  const value = await response.json();
  return Buffer.from(value.payload.data, 'base64').toString('utf8');
}
const client = new ManglarAutomationClient({ getClientSecret });
try {
  const action = process.argv[2];
  if (action === 'start') {
    try { await readFile(reportPath); throw new Error('Existing report: use status. A repeated test must be an explicit new run.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const image = await fetch(imageUrl, { headers: { 'User-Agent': 'ManglarAutomationE2E/1.0 (integration-test)' }, signal: AbortSignal.timeout(60_000) });
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new Error(`Reference image download HTTP ${image.status}.`);
    const bytes = await sharp(Buffer.from(await image.arrayBuffer())).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 94 }).toBuffer();
    const uploaded = await client.upload(bytes);
    const externalId = `e2e-machine-auth-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
    const payload = { source: 'api', externalId, clientId: 'automation-e2e-test', jobType: 'product', preset: 'generic_product',
      inputImages: [{ itemId: 'test-white-mug', fileName: 'white-mug.jpg', storagePath: uploaded.storagePath }],
      metadata: { test: true, purpose: 'machine-auth-real-e2e', sourcePage, attribution: 'Nenad Stojkovic / Shixart1985, CC BY 2.0', license: 'https://creativecommons.org/licenses/by/2.0/', changes: 'Resized reference; AI-generated derivative product scenes.' } };
    const created = await client.createJob(payload);
    const repeated = await client.createJob(payload);
    if (created.jobId !== repeated.jobId || !repeated.duplicate) throw new Error('Real API idempotency check failed.');
    const report = { testedAt: new Date().toISOString(), jobId: created.jobId, clientId: payload.clientId, principalId: 'chatgpt-work', externalId,
      sourcePage, attribution: payload.metadata.attribution, license: payload.metadata.license, changes: payload.metadata.changes,
      realProvider: true, duplicateReturnedSameJob: true, productionPollingPolicy: created.pollingPolicy, initialStatus: created.status };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } else if (action === 'status') {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const status = await client.getJob(report.jobId);
    const downloads = [];
    for (const output of status.outputs) {
      const result = await fetch(output.url, { signal: AbortSignal.timeout(60_000) });
      if (!result.ok) throw new Error(`Result download HTTP ${result.status}.`);
      const bytes = Buffer.from(await result.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      downloads.push({ type: output.type, itemId: output.metadata.itemId, httpStatus: result.status, bytes: bytes.length, width: metadata.width, height: metadata.height });
    }
    const updated = { ...report, lastCheckedAt: new Date().toISOString(), status: status.status, progress: status.progress, batchId: status.batchId,
      error: status.error, downloadedOutputs: downloads, testedAutomaticTokenAcquisition: true,
      testPassed: status.status === 'completed' && downloads.length === status.progress.total && downloads.length === 4 };
    await writeFile(reportPath, `${JSON.stringify(updated, null, 2)}\n`);
    // Signed URLs and bearer credentials are deliberately absent from the report/output.
    console.log(JSON.stringify(updated));
  } else throw new Error('Usage: node scripts/automation-e2e.mjs start|status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
