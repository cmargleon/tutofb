import { FirebaseError } from 'firebase/app';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../firebase';

export const isRemoteAssetUrl = (value: string): boolean =>
  value.startsWith('http://') || value.startsWith('https://');

export interface ResolvedStorageAsset {
  url: string;
  revoke?: () => void;
}

const MAX_CONCURRENT_STORAGE_URL_REQUESTS = 4;
const STORAGE_URL_RETRY_DELAYS_MS = [250, 750];
const STORAGE_URL_CACHE_LIMIT = 1000;

const storageAssetPromiseCache = new Map<string, Promise<ResolvedStorageAsset>>();

let activeStorageUrlRequests = 0;
const pendingStorageUrlResolvers: Array<() => void> = [];

const scheduleStorageUrlRequest = async <T>(task: () => Promise<T>): Promise<T> => {
  if (activeStorageUrlRequests >= MAX_CONCURRENT_STORAGE_URL_REQUESTS) {
    await new Promise<void>((resolve) => {
      pendingStorageUrlResolvers.push(resolve);
    });
  }

  activeStorageUrlRequests += 1;

  try {
    return await task();
  } finally {
    activeStorageUrlRequests = Math.max(0, activeStorageUrlRequests - 1);
    pendingStorageUrlResolvers.shift()?.();
  }
};

const isRetriableStorageError = (error: unknown): boolean => {
  if (!(error instanceof FirebaseError)) {
    return false;
  }

  if (error.code === 'storage/retry-limit-exceeded' || error.code === 'storage/quota-exceeded') {
    return true;
  }

  if (error.code !== 'storage/unknown') {
    return false;
  }

  const details = `${error.message}\n${(error.customData?.serverResponse as string | undefined) || ''}`;
  return details.includes('429') || details.toLowerCase().includes('too many requests');
};

const wait = async (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const fetchStorageAssetUrl = async (storagePath: string): Promise<ResolvedStorageAsset> => {
  let attempt = 0;

  while (true) {
    try {
      const url = await scheduleStorageUrlRequest(() => getDownloadURL(ref(storage, storagePath)));
      return { url };
    } catch (error) {
      const nextDelayMs = STORAGE_URL_RETRY_DELAYS_MS[attempt];
      if (!nextDelayMs || !isRetriableStorageError(error)) {
        throw error;
      }

      attempt += 1;
      await wait(nextDelayMs);
    }
  }
};

const rememberStorageAssetPromise = (storagePath: string, promise: Promise<ResolvedStorageAsset>): void => {
  if (storageAssetPromiseCache.size >= STORAGE_URL_CACHE_LIMIT) {
    const oldestKey = storageAssetPromiseCache.keys().next().value;
    if (oldestKey) {
      storageAssetPromiseCache.delete(oldestKey);
    }
  }

  storageAssetPromiseCache.set(storagePath, promise);
};

export const resolveStorageAssetUrl = async (storagePath: string): Promise<ResolvedStorageAsset> => {
  if (isRemoteAssetUrl(storagePath)) {
    return { url: storagePath };
  }

  const cachedPromise = storageAssetPromiseCache.get(storagePath);
  if (cachedPromise) {
    return cachedPromise;
  }

  const promise = fetchStorageAssetUrl(storagePath).catch((error) => {
    storageAssetPromiseCache.delete(storagePath);
    throw error;
  });

  rememberStorageAssetPromise(storagePath, promise);
  return promise;
};
