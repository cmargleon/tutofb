import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const crossServiceRole = 'roles/firebaserules.firestoreServiceAgent';

export function assertStorageFirestoreAccess(policy, projectNumber) {
  const member = `serviceAccount:service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`;
  assert.ok(policy.bindings?.some(binding => binding.role === crossServiceRole
    && !binding.condition && binding.members?.includes(member)),
  `Storage cannot evaluate Firestore-backed permissions. Grant ${crossServiceRole} to ${member} before deploying. Firebase CLI skips this check in non-interactive deployments and when rules are unchanged.`);
}

export function assertStorageCors(actual, expected) {
  const normalize = rules => (rules || []).map(rule => JSON.stringify({
    origin: [...(rule.origin || [])].sort(),
    method: [...(rule.method || [])].sort(),
    responseHeader: [...(rule.responseHeader || [])].sort(),
    maxAgeSeconds: rule.maxAgeSeconds,
  })).sort();
  assert.deepEqual(normalize(actual), normalize(expected),
    'Storage CORS differs from cors.json. Apply it with gcloud storage buckets update gs://<configured-storageBucket> --cors-file=cors.json before deploying.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(fs.readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
  const project = process.env.GCLOUD_PROJECT || config.projectId;
  assert.equal(project, config.projectId, 'Storage and frontend must target the same Firebase project.');
  const read = args => JSON.parse(execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const { projectNumber } = read(['projects', 'describe', project, '--format=json']);
  assert.match(String(projectNumber), /^\d+$/, 'Missing Firebase project number.');
  const policy = read(['projects', 'get-iam-policy', project, '--format=json']);
  assertStorageFirestoreAccess(policy, projectNumber);
  const bucket = read(['storage', 'buckets', 'describe', `gs://${config.storageBucket}`, '--format=json']);
  const cors = JSON.parse(fs.readFileSync(new URL('../cors.json', import.meta.url), 'utf8'));
  assertStorageCors(bucket.cors_config, cors);
  console.log(`Storage authorization release: ${project}, Firestore service-agent access and bucket CORS verified.`);
}
