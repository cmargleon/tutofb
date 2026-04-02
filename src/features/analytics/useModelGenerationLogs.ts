import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { ModelGenerationLog } from '../../../shared/src/types';

export interface ModelGenerationStats {
  totalPhotos: number;
  totalCostUsd: number;
  recentLogs: ModelGenerationLog[];
  byProvider: Record<string, { photos: number; costUsd: number }>;
}

export const useModelGenerationLogs = (limitCount = 50) => {
  const [stats, setStats] = useState<ModelGenerationStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'model_generation_logs'),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ModelGenerationLog));

        const byProvider: Record<string, { photos: number; costUsd: number }> = {};
        let totalPhotos = 0;
        let totalCostUsd = 0;

        for (const log of logs) {
          totalPhotos += log.completedPhotos;
          totalCostUsd += log.estimatedCostUsd;
          if (!byProvider[log.provider]) byProvider[log.provider] = { photos: 0, costUsd: 0 };
          byProvider[log.provider].photos += log.completedPhotos;
          byProvider[log.provider].costUsd += log.estimatedCostUsd;
        }

        setStats({ totalPhotos, totalCostUsd, recentLogs: logs.slice(0, 10), byProvider });
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [limitCount]);

  return { stats, loading };
};
