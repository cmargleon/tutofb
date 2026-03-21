import { useEffect, useState } from 'react';
import { resolveStorageAssetUrl } from './assets';

export const useStorageAssetUrl = (storagePath: string | null | undefined) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(storagePath));

  useEffect(() => {
    let isMounted = true;

    if (!storagePath) {
      setUrl(null);
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setLoading(true);

    void resolveStorageAssetUrl(storagePath)
      .then((nextUrl) => {
        if (isMounted) {
          setUrl(nextUrl || null);
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
    };
  }, [storagePath]);

  return { url, loading };
};
