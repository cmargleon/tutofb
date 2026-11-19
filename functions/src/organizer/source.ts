import * as admin from 'firebase-admin';
import { normalizeInputImage } from '../media/normalizeInputImage';
import { digest, versionOf, type DriveEntry, type OrganizerDrive } from './drive';

export const generationSourceKey = (entry: DriveEntry) => digest([entry.id,
  entry.sha256Checksum ? ['sha256', entry.sha256Checksum] : entry.md5Checksum ? ['md5', entry.md5Checksum] : ['version', versionOf(entry)]]);

/** Every execution freezes the verified original into the same immutable JPEG in Tuto. */
export async function freezeOriginal(drive: OrganizerDrive, entry: DriveEntry, uid: string, clientId: string) {
  await drive.assertSource(entry);
  const storagePath = `garments/drafts/${uid}/organizer-${digest([clientId, generationSourceKey(entry)])}/source/image.jpg`;
  const target = admin.storage().bucket().file(storagePath);
  if (!(await target.exists())[0]) {
    const bytes = await normalizeInputImage(await drive.sourceImage(entry));
    await target.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'image/jpeg' } }).catch(error => {
      if (Number(error.code) !== 412) throw error; // A parallel retry already froze this source.
    });
  }
  await drive.assertSource(entry);
  return { storagePath, file: target };
}
