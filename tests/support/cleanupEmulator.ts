import assert from 'node:assert/strict';
/** Only suites owning a named test database can clear it; never touches a shared/default database. */
export async function cleanupEmulatorDatabase(db: any) {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-manglar-automation');
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
  assert.match(db.databaseId, /^test-/);
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
}
