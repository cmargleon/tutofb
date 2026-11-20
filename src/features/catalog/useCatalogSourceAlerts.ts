import { useEffect, useState } from 'react';
import type { CatalogSourceAlerts } from '../../../shared/src/types';
import { organizer } from '../organizer/firebase';

export function useCatalogSourceAlerts(clientId: string, batchIds: string[]) {
  const key = JSON.stringify([clientId, [...new Set(batchIds)].sort()]);
  const [state, setState] = useState<{ key: string; byBatch: Record<string, CatalogSourceAlerts>; error: string | null }>();
  useEffect(() => {
    let active = true;
    if (!clientId || !batchIds.length) return;
    const read = async () => {
      try {
        const results = await Promise.all([...new Set(batchIds)].map(async batchId =>
          [batchId, await organizer<CatalogSourceAlerts>({ action: 'catalogAlerts', clientId, batchId })] as const));
        if (active) setState({ key, byBatch: Object.fromEntries(results), error: null });
      } catch (error) {
        if (active) setState({ key, byBatch: {}, error: (error as Error).message });
      }
    };
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [key]);
  return state?.key === key ? state : { byBatch: {}, error: null };
}
