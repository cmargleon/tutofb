import { useCallback, useEffect, useState } from 'react';
import { FinanceDashboardData } from '../../../shared/src/types';
import { getFinanceDashboard } from './firebase';

export const getCurrentFinancePeriod = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
}).format(new Date());

export const useFinanceDashboard = (period: string, clientId: string | null = null) => {
  const [data, setData] = useState<FinanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getFinanceDashboard({ period, clientId });
      setData(next);
    } catch (err: any) {
      console.error('Error loading finance dashboard:', err);
      setError(err?.message || 'Error al cargar finanzas.');
    } finally {
      setLoading(false);
    }
  }, [period, clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
};
