import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';

export const isRemoteAssetUrl = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

export const resolveStorageAssetUrl = async (storagePath: string): Promise<string> => {
  if (isRemoteAssetUrl(storagePath)) {
    return storagePath;
  }

  return getDownloadURL(ref(storage, storagePath));
};
