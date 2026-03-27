import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { Job } from '../../../shared/src/types';

const QUERY_LIMIT = 300;

export interface CatalogGarmentGroup {
  garmentId: string;
  garmentName: string;
  jobs: Job[];
}

export const useCatalogJobs = (clientId: string | null) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setJobs([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const q = query(
      collection(db, 'jobs'),
      where('clientId', '==', clientId),
      where('status', '==', 'completed'),
      orderBy('createdAt', 'desc'),
      limit(QUERY_LIMIT),
    );

    getDocs(q)
      .then((snapshot) => {
        if (cancelled) return;
        const fetched = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Job);
        setJobs(fetched);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Error cargando imágenes del catálogo');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [clientId]);

  const garmentGroups: CatalogGarmentGroup[] = (() => {
    const map = new Map<string, CatalogGarmentGroup>();
    for (const job of jobs) {
      const key = job.garmentId;
      const existing = map.get(key);
      if (existing) {
        existing.jobs.push(job);
      } else {
        map.set(key, { garmentId: job.garmentId, garmentName: job.garmentName, jobs: [job] });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.garmentName.localeCompare(b.garmentName, 'es'),
    );
  })();

  return { jobs, garmentGroups, loading, error };
};
