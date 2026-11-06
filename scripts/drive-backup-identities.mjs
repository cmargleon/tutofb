#!/usr/bin/env node
// New per-client identities only. Does not touch Drive ACLs, existing credentials or client data.
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const client = args.find(a => a.startsWith('--client='))?.slice(9);
const project = args.find(a => a.startsWith('--project='))?.slice(10) || 'tutofb-260320-1003';
if (!client || !/^[a-z][a-z0-9-]{1,14}$/.test(client) || !/^[a-z][a-z0-9-]+$/.test(project)) throw Error('Uso: node scripts/drive-backup-identities.mjs --client=slug [--apply]');
const apply = args.includes('--apply');
const runtime = `drive-backup-runtime@${project}.iam.gserviceaccount.com`;
const workspaceRuntime = `drive-workspace-runtime@${project}.iam.gserviceaccount.com`;
const role = `projects/${project}/roles/automationDriveTokenMinter`;
function run(command) {
  console.log(['gcloud', ...command].join(' '));
  if (apply) { const result = spawnSync('gcloud', command, { stdio: 'inherit' }); if (result.status) throw Error('Comando fallido. Revisa el resultado antes de continuar.'); }
}
for (const [kind, consumers] of [['src', [runtime]], ['bkp', [runtime]], ['work', [runtime, workspaceRuntime]]]) {
  const account = `db-${client}-${kind}`;
  const email = `${account}@${project}.iam.gserviceaccount.com`;
  if (apply) {
    const exists = spawnSync('gcloud', ['iam', 'service-accounts', 'describe', email, `--project=${project}`], { stdio: 'ignore' });
    if (exists.status) run(['iam', 'service-accounts', 'create', account, `--project=${project}`, `--display-name=Tuto-Drive-${client}-${kind}`]);
  } else run(['iam', 'service-accounts', 'create', account, `--project=${project}`]);
  for (const consumer of consumers) run(['iam', 'service-accounts', 'add-iam-policy-binding', email, `--project=${project}`, `--member=serviceAccount:${consumer}`, `--role=${role}`, '--quiet']);
  console.log(`${kind}: ${email}`);
}
if (!apply) console.log('Plan solamente. Revisa las cuentas y usa --apply para crear recursos nuevos.');
