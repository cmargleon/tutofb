import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.versions.node.split('.')[0], '22', 'Verify and deploy with Node 22.');
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const envFile = `functions/.env.${config.projectId}`;
const functionDatabase = process.env.FIRESTORE_DATABASE_ID || (fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').match(/^FIRESTORE_DATABASE_ID\s*=\s*["']?([^\r\n"']+)/m)?.[1] : undefined) || '(default)';
assert.equal(config.firestoreDatabaseId || '(default)', functionDatabase, 'Frontend and Functions must use the same user database.');
assert.equal(functionDatabase, '(default)', 'Storage cross-service rules only support the default database. A named-database release needs a mediated file API, never a claims fallback.');
console.log(`Client authorization release: ${config.projectId}, database ${functionDatabase}, Node ${process.versions.node}`);
