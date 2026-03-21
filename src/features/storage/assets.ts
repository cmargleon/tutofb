import { getBlob, getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';

export const isRemoteAssetUrl = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

export interface ResolvedStorageAsset {
  url: string;
  revoke?: () => void;
}

const resolveAuthenticatedAssetUrl = async (storagePath: string): Promise<ResolvedStorageAsset> => {
  const blob = await getBlob(ref(storage, storagePath));
  const objectUrl = URL.createObjectURL(blob);

  return {
    url: objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
  };
};

export const resolveStorageAssetUrl = async (storagePath: string): Promise<ResolvedStorageAsset> => {
  if (isRemoteAssetUrl(storagePath)) {
    return { url: storagePath };
  }

  try {
    return await resolveAuthenticatedAssetUrl(storagePath);
  } catch (blobError) {
    console.warn('Falling back to download URL for storage asset:', storagePath, blobError);
    return { url: await getDownloadURL(ref(storage, storagePath)) };
  }
};
