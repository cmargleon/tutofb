import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

const bucket = admin.storage().bucket();
const projectId = process.env.GCLOUD_PROJECT || admin.app().options.projectId;

const isGeneratedStoragePath = (storagePath: string): boolean => storagePath.startsWith('generated/');

const encodeStoragePathForUrl = (storagePath: string): string =>
  storagePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export const buildPublicGeneratedImageUrl = (storagePath: string): string => {
  if (!projectId) {
    throw new Error('No se pudo resolver el projectId para construir la URL pública de la imagen.');
  }

  const encodedPath = encodeStoragePathForUrl(storagePath);
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  if (isEmulator) {
    return `http://127.0.0.1:5001/${projectId}/us-central1/publicGeneratedImage/${encodedPath}`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/publicGeneratedImage/${encodedPath}`;
};

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
  if (isGeneratedStoragePath(storagePath)) {
    return buildPublicGeneratedImageUrl(storagePath);
  }

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
