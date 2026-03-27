import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { getAppFirestore } from '../firebase/appFirestore';
import { JobOutput } from '../../../shared/src/types';

const DAYS_THRESHOLD = 30;
const BATCH_SIZE = 50;

/**
 * Deletes GCS files for non-current outputs older than DAYS_THRESHOLD days.
 * Sets `storageDeletedAt` on each processed output document.
 * Runs in batches — call repeatedly (via scheduler) until all old outputs are cleaned.
 */
export const cleanupOldOutputStorage = async (): Promise<{
  processed: number;
  deleted: number;
  skipped: number;
  errors: number;
}> => {
  const db = getAppFirestore();
  const bucket = admin.storage().bucket();
  const cutoff = Timestamp.fromMillis(Date.now() - DAYS_THRESHOLD * 24 * 60 * 60 * 1000);

  let deleted = 0;
  let skipped = 0;
  let errors = 0;

  // Only look at non-current outputs older than the threshold.
  // storageDeletedAt already-set outputs are filtered in code (avoids needing !=null index).
  const snapshot = await db
    .collectionGroup('outputs')
    .where('isCurrent', '==', false)
    .where('createdAt', '<', cutoff)
    .orderBy('createdAt', 'asc')
    .limit(BATCH_SIZE)
    .get();

  for (const doc of snapshot.docs) {
    const output = { id: doc.id, ...doc.data() } as JobOutput;

    // Already cleaned in a previous run
    if (output.storageDeletedAt) {
      skipped++;
      continue;
    }

    if (!output.resultImagePath) {
      // No file to delete — just mark as cleaned
      await doc.ref.update({ storageDeletedAt: Timestamp.now() });
      skipped++;
      continue;
    }

    try {
      await bucket.file(output.resultImagePath).delete({ ignoreNotFound: true });
      await doc.ref.update({ storageDeletedAt: Timestamp.now() });
      deleted++;
    } catch (e) {
      console.error(`[storageCleanup] Failed to delete ${output.resultImagePath}:`, e);
      errors++;
    }
  }

  console.log(
    `[storageCleanup] processed=${snapshot.size} deleted=${deleted} skipped=${skipped} errors=${errors}`,
  );
  return { processed: snapshot.size, deleted, skipped, errors };
};
