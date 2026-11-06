import { getAppFirestore } from '../firebase/appFirestore';
import { digest, FOLDER, OrganizerDriveError, type OrganizerDrive, type DriveFile } from './drive';
import { compare } from './fingerprint';
import { clientRef, enqueue, type StoredConfig } from './store';

async function* scan(drive: Pick<OrganizerDrive, 'children'>, sourceFiles: DriveFile[]) {
  const queue = sourceFiles.map(entry => ({ ...entry, path: [entry.name], sourceId: entry.id, ancestorIds: [] as string[] }));
  while (queue.length) {
    const parent = queue.pop()!;
    let token = '';
    do {
      const page = await drive.children(parent, token);
      for (const file of page.files) {
        if (file.trashed || file.appProperties?.organizerTenant || !file.parents?.includes(parent.id)) continue;
        const entry = { ...file, path: [...parent.path, file.name], sourceId: parent.sourceId, ancestorIds: [...parent.ancestorIds, parent.id] };
        yield entry;
        if (entry.mimeType === FOLDER) queue.push(entry);
      }
      token = page.nextPageToken || '';
    } while (token);
  }
}

export async function watch(drive: Pick<OrganizerDrive, 'zone' | 'children' | 'changes' | 'startChanges'>, config: StoredConfig) {
  if (!config.enabled || config.activeRunId) return;
  const ref = clientRef(config.clientId);
  const { sources } = await drive.zone(config.sourceIds, config.parentId, config.allowInheritedAccess);
  const now = Date.now();
  let cursor = config.changeCursor;
  let changed = true;
  try {
    if (cursor) {
      const changes = await drive.changes(cursor, sources[0].driveId);
      cursor = changes.cursor;
      changed = changes.changed;
    } else {
      cursor = await drive.startChanges(sources[0].driveId);
    }
  } catch (error) {
    if (!(error instanceof OrganizerDriveError) || ![400, 403, 404, 410].includes(error.status)) throw error;
    cursor = null;
  }
  const needsScan = changed || !config.observedFingerprint || config.observedFingerprint !== config.processedFingerprint ||
    now - (config.lastFullScanAt || 0) >= 60 * 60_000;
  let fingerprint = config.observedFingerprint;
  if (needsScan) {
    const inventory: string[] = [];
    for await (const file of scan(drive, sources)) inventory.push(compare(file));
    fingerprint = digest(inventory.sort());
  }
  const shouldEnqueue = await getAppFirestore().runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as StoredConfig;
    if (!current.enabled || current.activeRunId || digest(current.sourceIds) !== digest(config.sourceIds) || current.parentId !== config.parentId) return false;
    const changed = fingerprint !== current.observedFingerprint;
    const observedAt = changed ? now : current.observedAt || now;
    const pending = fingerprint !== current.processedFingerprint && fingerprint !== current.blockedFingerprint;
    tx.update(ref, { observedFingerprint: fingerprint, observedAt, lastPollAt: now, changeCursor: cursor, watcherError: null,
      lastFullScanAt: needsScan ? now : current.lastFullScanAt || null, watcher: pending ? 'collecting' : 'idle' });
    return pending && now - observedAt >= current.debounceMinutes * 60_000;
  });
  if (!shouldEnqueue || !fingerprint) return;
  return enqueue(config.clientId, 'classify', `automatic-${fingerprint}-${config.observedAt}`, 'watcher', { automaticFingerprint: fingerprint });
}

