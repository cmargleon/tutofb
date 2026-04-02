import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { AnalyticsData } from '../../../shared/src/types';
import {
  mapSummary,
  mapDailyVolume,
  mapProviderStats,
  mapClientStats,
  mapClientProviderStats,
  mapClientModelStats,
} from './mappers';

export const useAnalyticsDashboard = (daysBack: number = 30) => {
  const [data, setData] = useState<AnalyticsData>({
    summary: null,
    dailyVolume: [],
    byProvider: [],
    topClients: [],
    costByClientProvider: [],
    productivityByClientModel: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Static subscriptions — these collections don't depend on daysBack.
  // Kept in a separate effect so changing daysBack doesn't tear them down.
  useEffect(() => {
    let unsubscribeSummary: (() => void) | undefined;
    let unsubscribeProviders: (() => void) | undefined;
    let unsubscribeClients: (() => void) | undefined;
    let unsubscribeClientProviders: (() => void) | undefined;
    let unsubscribeClientModels: (() => void) | undefined;

    try {
      unsubscribeSummary = onSnapshot(doc(db, 'analytics_summary', 'global'), (docSnap) => {
        if (docSnap.exists()) {
          const summary = mapSummary(docSnap.data());
          setData((prev) => {
            if (prev.dailyVolume.length > 0) {
              const avgDailyCost = prev.dailyVolume.reduce((acc, curr) => acc + curr.costUsd, 0) / prev.dailyVolume.length;
              summary.projectedMonthlyCostUsd = avgDailyCost * 30;
            }
            return { ...prev, summary };
          });
        }
      }, (err) => {
        console.error('Error fetching summary:', err);
        setError('Error al cargar el resumen de analytics.');
      });

      unsubscribeProviders = onSnapshot(collection(db, 'analytics_providers'), (snapshot) => {
        const providers = snapshot.docs.map((doc) => mapProviderStats(doc.data()));
        setData((prev) => ({ ...prev, byProvider: providers }));
      }, (err) => {
        console.error('Error fetching providers:', err);
        setError('Error al cargar estadísticas de proveedores.');
      });

      unsubscribeClients = onSnapshot(
        query(collection(db, 'analytics_clients'), orderBy('completed', 'desc'), limit(10)),
        (snapshot) => {
          const clients = snapshot.docs.map((doc) => mapClientStats(doc.data()));
          setData((prev) => ({ ...prev, topClients: clients }));
        },
        (err) => {
          console.error('Error fetching top clients:', err);
          setError('Error al cargar el top de clientes.');
        },
      );

      unsubscribeClientProviders = onSnapshot(
        query(collection(db, 'analytics_client_providers'), orderBy('totalCostUsd', 'desc'), limit(50)),
        (snapshot) => {
          const rows = snapshot.docs.map((doc) => mapClientProviderStats(doc.id, doc.data()));
          setData((prev) => ({ ...prev, costByClientProvider: rows }));
        },
        (err) => {
          console.error('Error fetching cost by client/provider:', err);
          setError('Error al cargar el desglose por cliente y modelo.');
        },
      );

      unsubscribeClientModels = onSnapshot(
        query(collection(db, 'analytics_client_models'), orderBy('completedJobs', 'desc'), limit(25)),
        (snapshot) => {
          const rows = snapshot.docs.map((doc) => mapClientModelStats(doc.id, doc.data()));
          setData((prev) => ({ ...prev, productivityByClientModel: rows }));
        },
        (err) => {
          console.error('Error fetching client/model productivity:', err);
          setError('Error al cargar la productividad por cliente y modelo.');
        },
      );
    } catch (err: any) {
      console.error('Error setting up static analytics listeners:', err);
      setError(err.message || 'Error al inicializar analytics.');
    }

    return () => {
      unsubscribeSummary?.();
      unsubscribeProviders?.();
      unsubscribeClients?.();
      unsubscribeClientProviders?.();
      unsubscribeClientModels?.();
    };
  }, []);

  // Dynamic subscription — re-subscribes only when daysBack changes.
  useEffect(() => {
    let unsubscribeDaily: (() => void) | undefined;

    try {
      unsubscribeDaily = onSnapshot(
        query(collection(db, 'analytics_daily'), orderBy('date', 'desc'), limit(daysBack)),
        (snapshot) => {
          const daily = snapshot.docs.map((doc) => mapDailyVolume(doc.data())).reverse();
          setData((prev) => {
            const avgDailyCost = daily.length > 0
              ? daily.reduce((acc, curr) => acc + curr.costUsd, 0) / daily.length
              : 0;
            const projected = avgDailyCost * 30;
            const newSummary = prev.summary ? { ...prev.summary, projectedMonthlyCostUsd: projected } : null;
            return { ...prev, dailyVolume: daily, summary: newSummary };
          });
          setLoading(false);
        },
        (err) => {
          console.error('Error fetching daily volume:', err);
          setError('Error al cargar el volumen diario.');
          setLoading(false);
        },
      );
    } catch (err: any) {
      console.error('Error setting up daily analytics listener:', err);
      setError(err.message || 'Error al inicializar analytics.');
      setLoading(false);
    }

    return () => unsubscribeDaily?.();
  }, [daysBack]);

  return { data, loading, error };
};
