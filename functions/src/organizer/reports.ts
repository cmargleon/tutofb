import * as admin from 'firebase-admin';
import type { StoredRun } from './store';

/** Authorize through organizerAction first; issue fresh download URLs for private artifacts. */
export async function reportLinks(run: StoredRun) {
  const link = async (path: string | null | undefined, name: string) => {
    if (!path || !path.startsWith(`organizers/${run.clientId}/runs/${run.id}/`)) return null;
    const [url] = await admin.storage().bucket().file(path).getSignedUrl({
      action: 'read', expires: Date.now() + 60 * 60_000,
      responseDisposition: `attachment; filename="${name}"`,
    });
    return url;
  };
  return {
    reportUrl: await link(run.reportPath, `organizador-${run.id}.json`),
    controlSheetUrl: await link(run.controlSheetPath, `organizador-${run.id}.xlsx`),
  };
}
