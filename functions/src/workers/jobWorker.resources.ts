import * as admin from 'firebase-admin';
import { getAppFirestore } from '../firebase/appFirestore';
import { mimeTypeFromStoragePath } from './jobWorker.helpers';

export const db = getAppFirestore();
export const bucket = admin.storage().bucket();
export const getSignedUrl = async (storagePath: string): Promise<string> => {
  const file = bucket.file(storagePath);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000,
    version: 'v4',
  });
  return url;
};

export const downloadStorageImage = async (
  storagePath: string,
): Promise<{ bytes: Buffer; mimeType: string }> => {
  const file = bucket.file(storagePath);
  const [bytes] = await file.download();
  return {
    bytes,
    mimeType: mimeTypeFromStoragePath(storagePath),
  };
};
