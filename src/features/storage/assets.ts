import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';

export const isRemoteAssetUrl = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

export interface ResolvedStorageAsset {
  url: string;
  revoke?: () => void;
}

export const resolveStorageAssetUrl = async (storagePath: string): Promise<ResolvedStorageAsset> => {
  if (isRemoteAssetUrl(storagePath)) {
    return { url: storagePath };
  }

  // Using a download URL avoids browser XHR/CORS issues when previews are rendered from localhost.
  return { url: await getDownloadURL(ref(storage, storagePath)) };
};
