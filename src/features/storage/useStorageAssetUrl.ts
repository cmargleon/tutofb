import { useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { resolveStorageAssetUrl } from './assets';

export const useStorageAssetUrl = (storagePath: string | null | undefined) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(storagePath));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let isMounted = true;
    let revokeObjectUrl: (() => void) | undefined;

    if (!storagePath) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);
    setError(null);

    void resolveStorageAssetUrl(storagePath)
      .then((resolvedAsset) => {
        if (isMounted) {
          revokeObjectUrl = resolvedAsset.revoke;
          setUrl(resolvedAsset.url || null);
        } else {
          resolvedAsset.revoke?.();
        }
      })
      .catch((error) => {
        const isObjectNotFound =
          error instanceof FirebaseError && error.code === 'storage/object-not-found';

        if (!isObjectNotFound) {
          console.error('Error resolving storage asset URL:', error);
        }

        if (isMounted) {
          setUrl(null);
          setError(error);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      revokeObjectUrl?.();
    };
  }, [storagePath]);

  return { url, loading, error };
};
