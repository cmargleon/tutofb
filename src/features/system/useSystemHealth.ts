import { useEffect, useState } from 'react';
import { SystemHealthSnapshot } from '../../../shared/src/types';
import { getSystemHealth } from './firebase';

export const useSystemHealth = (enabled: boolean, refreshIntervalMs: number = 60_000) => {
  const [data, setData] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (!cancelled) {
        setLoading(true);
      }

      try {
        const snapshot = await getSystemHealth();
        if (!cancelled) {
          setData(snapshot);
          setError(null);
        }
      } catch (loadError: any) {
        if (!cancelled) {
          setError(loadError?.message || 'No se pudo cargar el estado del sistema.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, refreshIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, refreshIntervalMs]);

  const refresh = async () => {
    if (!enabled) {
      return;
    }

    setLoading(true);
    try {
      const snapshot = await getSystemHealth();
      setData(snapshot);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'No se pudo actualizar el estado del sistema.');
    } finally {
      setLoading(false);
    }
  };

  return {
    data,
    loading,
    error,
    refresh,
  };
};
