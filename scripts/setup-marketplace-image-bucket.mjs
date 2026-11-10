import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Dry run by default. This creates/configures only the dedicated publication bucket.
const apply = process.argv.includes('--apply');
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const project = config.projectId;
const bucket = `${project}-marketplace-images`;
const read = args => {
  const result = spawnSync('gcloud', [...args, `--project=${project}`, '--format=json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'gcloud failed');
  return JSON.parse(result.stdout);
};
const source = read(['storage', 'buckets', 'describe', `gs://${config.storageBucket}`]);
assert.ok(source.location, 'Cannot determine the current storage location.');
const currentFunction = read(['functions', 'describe', 'saveMasterProduct', '--gen2', '--region=us-central1']);
const account = currentFunction.serviceConfig?.serviceAccountEmail;
assert.match(account || '', /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com$/);
const existing = spawnSync('gcloud', ['storage', 'buckets', 'describe', `gs://${bucket}`, `--project=${project}`, '--format=json'], { encoding: 'utf8' });
if (existing.status !== 0 && !/404|not found|does not exist/i.test(existing.stderr)) throw new Error(existing.stderr);
if (existing.status === 0) {
  const metadata = JSON.parse(existing.stdout);
  assert.equal(metadata.location, source.location, 'Publication bucket must share the current storage location.');
  const owned = read(['storage', 'buckets', 'list', `--filter=name=${bucket}`]);
  assert.ok(owned.some(entry => entry.name === bucket), 'Publication bucket belongs to another project.');
  assert.equal(metadata.uniform_bucket_level_access, true, 'Publication bucket must use uniform access.');
  assert.notEqual(metadata.public_access_prevention, 'enforced', 'Public access is blocked on the publication bucket.');
}
const commands = [];
if (existing.status !== 0) commands.push(['storage', 'buckets', 'create', `gs://${bucket}`, `--location=${source.location}`, '--uniform-bucket-level-access', '--no-public-access-prevention']);
// legacyObjectReader grants GET only; public callers cannot list or write objects.
commands.push(['storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`, '--member=allUsers', '--role=roles/storage.legacyObjectReader']);
for (const role of ['roles/storage.objectUser']) commands.push([
  'storage', 'buckets', 'add-iam-policy-binding', `gs://${bucket}`, `--member=serviceAccount:${account}`, `--role=${role}`,
]);
for (const command of commands) {
  console.log(`${apply ? 'Applying' : 'Planned'}: gcloud ${command.join(' ')} --project=${project}`);
  if (apply) {
    const result = spawnSync('gcloud', [...command, `--project=${project}`, '--quiet'], { encoding: 'utf8' });
    if (result.status !== 0) {
      // A retried create can return 409 after the first request has already succeeded.
      if (command[2] !== 'create' || !/409.*already own|previous request.*succeeded/is.test(result.stderr)) throw new Error(result.stderr || 'Bucket configuration failed.');
      const created = read(['storage', 'buckets', 'describe', `gs://${bucket}`]);
      const owned = read(['storage', 'buckets', 'list', `--filter=name=${bucket}`]);
      assert.ok(owned.some(entry => entry.name === bucket));
      assert.equal(created.location, source.location);
    }
  }
}
console.log(JSON.stringify({ applied: apply, project, bucket, location: source.location, serviceAccount: account }));
