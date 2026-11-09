import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAppFirestore } from '../firebase/appFirestore';
/** Only artifacts explicitly created by this exporter are eligible. Originals are never scanned. */
export async function cleanupMarketplaceExports() {
  const db = getAppFirestore();
  const expired = await db.collection('marketplaceExportRequests').where('expiresAt', '<=', admin.firestore.Timestamp.now()).limit(100).get();
  for (const doc of expired.docs) {
    const data = doc.data();
    if (data.leaseUntil?.toMillis() > Date.now()) continue;
    let safe = true;
    const paths: string[] = data.artifactPaths || (data.artifactPath ? [data.artifactPath] : []);
    for (const path of paths) {
      const expectedPrefix = `client_spreadsheet_exports/${data.clientId}/${doc.id}/`;
      if (!path.startsWith(expectedPrefix) || path.includes('..')) { safe = false; continue; }
      const file = admin.storage().bucket().file(path);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        if (metadata.metadata?.marketplaceTemporary !== 'true') { safe = false; continue; }
        await file.delete({ ignoreNotFound: true });
      }
    }
    if (!safe) continue;
    await doc.ref.delete();
  }
  return expired.size;
}
export const cleanupMarketplaceExportsOnSchedule = onSchedule({ schedule: 'every 60 minutes', timeoutSeconds: 300 }, async () => { await cleanupMarketplaceExports(); });
