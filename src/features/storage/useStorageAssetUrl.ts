import { useEffect, useState } from 'react';
import { resolveStorageAssetUrl } from './assets';

export const useStorageAssetUrl = (storagePath: string | null | undefined) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(storagePath));

  useEffect(() => {
    let isMounted = true;
    let revokeObjectUrl: (() => void) | undefined;

    if (!storagePath) {
      setUrl(null);
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);

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
        console.error('Error resolving storage asset URL:', error);
        if (isMounted) {
          setUrl(null);
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

  return { url, loading };
};
