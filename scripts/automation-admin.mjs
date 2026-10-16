#!/usr/bin/env node
// Trusted operator command. Credentials remain in memory / Google Secret Manager.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const projectId = 'tutofb-260320-1003';
const principalId = 'chatgpt-work';
const secretId = 'MANGLAR_WORK_CLIENT_SECRET';
const testClientId = 'automation-e2e-test';
const action = process.argv[2];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cloudToken = () => execFileSync('gcloud', ['auth', 'print-access-token', '--project', projectId], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
const { OAuth2Client } = require('../functions/node_modules/google-auth-library');
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: cloudToken() });
const db = new Firestore({ projectId, authClient });
const ref = db.collection('automationPrincipals').doc(principalId);
async function google(path, options = {}) {
  const response = await fetch(`https://secretmanager.googleapis.com/v1/projects/${projectId}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${cloudToken()}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Secret Manager HTTP ${response.status}; no credential values logged.`);
  return response.json();
}
try {
  if (action === 'provision' || action === 'rotate') {
    const current = await ref.get();
    if (action === 'provision' && current.exists) throw new Error('Principal already exists. Use inspect or rotate; provisioning never overwrites permissions.');
    if (action === 'rotate' && !current.exists) throw new Error('Principal not provisioned.');
    const secret = randomBytes(48).toString('base64url');
    const secretCheck = await fetch(`https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${secretId}`, { headers: { Authorization: `Bearer ${cloudToken()}` } });
    if (secretCheck.status === 404) await google(`secrets?secretId=${secretId}`, { method: 'POST', body: JSON.stringify({ replication: { automatic: {} }, labels: { purpose: 'manglar-automation' } }) });
    else if (!secretCheck.ok) throw new Error(`Secret lookup HTTP ${secretCheck.status}.`);
    const version = await google(`secrets/${secretId}:addVersion`, { method: 'POST', body: JSON.stringify({ payload: { data: Buffer.from(secret).toString('base64') } }) });
    const previous = current.data();
    const grace = admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000);
    const secretHashes = [{ hash: hash(secret), expiresAt: null }, ...(previous?.secretHashes || []).slice(0, 1).map((entry) => ({ hash: entry.hash, expiresAt: grace }))];
    if (!current.exists) {
      await db.collection('clients').doc(testClientId).create({ name: 'Manglar Automation E2E (TEST ONLY)', status: 'active', generationPromptBase: null, batchCount: 0,
        createdByUid: 'automation-chatgpt-work', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastBatchCreatedAt: null,
        automation: { defaultPreset: 'generic_product' }, metadata: { purpose: 'automation-e2e-test', production: false } });
      await ref.create({ active: true, version: 1, displayName: 'ChatGPT Work — automation only',
        allowedClientIds: [testClientId], allowedJobTypes: ['garment', 'product'],
        scopes: ['uploads:write', 'jobs:create', 'jobs:read'], secretHashes,
        secretResource: `projects/${projectId}/secrets/${secretId}`, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } else await ref.update({ secretHashes, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(JSON.stringify({ action, clientId: principalId, allowedClientIds: current.exists ? previous.allowedClientIds : [testClientId], secretVersion: version.name, credentialPrinted: false }));
  } else if (action === 'revoke') {
    await ref.update({ active: false, version: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log('Principal revoked; all access tokens immediately invalid. Secret retained in Secret Manager for audit.');
  } else if (action === 'inspect') {
    const snapshot = await ref.get();
    const data = snapshot.data();
    console.log(JSON.stringify({ exists: snapshot.exists, clientId: principalId, active: data?.active, allowedClientIds: data?.allowedClientIds, allowedJobTypes: data?.allowedJobTypes, scopes: data?.scopes, secretResource: data?.secretResource }));
  } else throw new Error('Usage: node scripts/automation-admin.mjs provision|rotate|revoke|inspect');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.terminate(); }
