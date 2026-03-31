import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

const bucket = admin.storage().bucket();

const normalizeDownloadToken = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  const token = raw
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean);

  return token || null;
};

export const ensureStorageDownloadUrl = async (storagePath: string): Promise<string> => {
  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();
  const existingToken = normalizeDownloadToken(metadata.metadata?.firebaseStorageDownloadTokens);
  const token = existingToken || randomUUID();

  if (!existingToken) {
    await file.setMetadata({
      metadata: {
        ...metadata.metadata,
        firebaseStorageDownloadTokens: token,
      },
    });
  }

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
};
