import { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { AnalyticsData } from '../../../shared/src/types';
import { mapSummary, mapDailyVolume, mapProviderStats, mapClientStats, mapClientProviderStats } from './mappers';

export const useAnalyticsDashboard = () => {
  const [data, setData] = useState<AnalyticsData>({
    summary: null,
    dailyVolume: [],
    byProvider: [],
    topClients: [],
    costByClientProvider: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeSummary: () => void;
    let unsubscribeDaily: () => void;
    let unsubscribeProviders: () => void;
    let unsubscribeClients: () => void;
    let unsubscribeClientProviders: () => void;

    try {
      // 1. Summary
      unsubscribeSummary = onSnapshot(doc(db, 'analytics_summary', 'global'), (docSnap) => {
        if (docSnap.exists()) {
          const rawData = docSnap.data();
          const summary = mapSummary(rawData);
          
          setData(prev => {
            // Calculate projected monthly cost based on current daily volume
            let projected = 0;
            if (prev.dailyVolume.length > 0) {
              const totalDailyCost = prev.dailyVolume.reduce((acc, curr) => acc + curr.costUsd, 0);
              const avgDailyCost = totalDailyCost / prev.dailyVolume.length;
              projected = avgDailyCost * 30;
            }
            summary.projectedMonthlyCostUsd = projected;
            
            return { ...prev, summary };
          });
        }
      }, (err) => {
        console.error("Error fetching summary:", err);
        setError("Error al cargar el resumen de analytics.");
      });

      // 2. Daily Volume (last 30 days)
      const dailyQuery = query(collection(db, 'analytics_daily'), orderBy('date', 'desc'), limit(30));
      unsubscribeDaily = onSnapshot(dailyQuery, (snapshot) => {
        const daily = snapshot.docs.map(doc => mapDailyVolume(doc.data())).reverse(); // Reverse to get chronological order
        
        setData(prev => {
          // Recalculate projected monthly cost
          let projected = 0;
          if (daily.length > 0) {
            const totalDailyCost = daily.reduce((acc, curr) => acc + curr.costUsd, 0);
            const avgDailyCost = totalDailyCost / daily.length;
            projected = avgDailyCost * 30;
          }
          
          const newSummary = prev.summary ? { ...prev.summary, projectedMonthlyCostUsd: projected } : null;
          
          return { ...prev, dailyVolume: daily, summary: newSummary };
        });
      }, (err) => {
        console.error("Error fetching daily volume:", err);
        setError("Error al cargar el volumen diario.");
      });

      // 3. Providers
      unsubscribeProviders = onSnapshot(collection(db, 'analytics_providers'), (snapshot) => {
        const providers = snapshot.docs.map(doc => mapProviderStats(doc.data()));
        setData(prev => ({ ...prev, byProvider: providers }));
      }, (err) => {
        console.error("Error fetching providers:", err);
        setError("Error al cargar estadísticas de proveedores.");
      });

      // 4. Top Clients
      const clientsQuery = query(collection(db, 'analytics_clients'), orderBy('completed', 'desc'), limit(10));
      unsubscribeClients = onSnapshot(clientsQuery, (snapshot) => {
        const clients = snapshot.docs.map(doc => mapClientStats(doc.data()));
        setData(prev => ({ ...prev, topClients: clients }));
      }, (err) => {
        console.error("Error fetching top clients:", err);
        setError("Error al cargar el top de clientes.");
      });

      // 5. Cost by client + provider/model
      const clientProvidersQuery = query(
        collection(db, 'analytics_client_providers'),
        orderBy('totalCostUsd', 'desc'),
        limit(50),
      );
      unsubscribeClientProviders = onSnapshot(clientProvidersQuery, (snapshot) => {
        const rows = snapshot.docs.map((doc) => mapClientProviderStats(doc.id, doc.data()));
        setData(prev => ({ ...prev, costByClientProvider: rows }));
      }, (err) => {
        console.error("Error fetching cost by client/provider:", err);
        setError("Error al cargar el desglose por cliente y modelo.");
      });

      setLoading(false);
    } catch (err: any) {
      console.error("Error setting up analytics listeners:", err);
      setError(err.message || "Error al inicializar analytics.");
      setLoading(false);
    }

    return () => {
      if (unsubscribeSummary) unsubscribeSummary();
      if (unsubscribeDaily) unsubscribeDaily();
      if (unsubscribeProviders) unsubscribeProviders();
      if (unsubscribeClients) unsubscribeClients();
      if (unsubscribeClientProviders) unsubscribeClientProviders();
    };
  }, []);

  return { data, loading, error };
};
