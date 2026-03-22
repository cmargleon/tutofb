import { useEffect, useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Batch, Job } from '../../../shared/src/types';

export const useEvaluationBatch = (initialBatchId: string | null, userUid: string | null) => {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(initialBatchId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialBatchId) {
      setResolvedBatchId(initialBatchId);
      setError(null);
      return undefined;
    }

    if (!userUid) {
      setResolvedBatchId(null);
      setBatch(null);
      setJobs([]);
      setLoading(false);
      setError('Inicia sesión para abrir tu última evaluación.');
      return undefined;
    }

    setLoading(true);
    setError(null);

    const latestBatchQuery = query(
      collection(db, 'batches'),
      where('createdByUid', '==', userUid),
      orderBy('createdAt', 'desc'),
      limit(1),
    );

    const unsubscribeLatestBatch = onSnapshot(
      latestBatchQuery,
      (snapshot) => {
        const latestBatchDoc = snapshot.docs[0];

        if (!latestBatchDoc) {
          setResolvedBatchId(null);
          setBatch(null);
          setJobs([]);
          setLoading(false);
          setError('Todavía no has creado jobs para evaluar.');
          return;
        }

        setResolvedBatchId(latestBatchDoc.id);
        setError(null);
      },
      (err) => {
        console.error('Error fetching latest user batch:', err);
        setResolvedBatchId(null);
        setBatch(null);
        setJobs([]);
        setLoading(false);
        setError('Error al buscar tu último lote.');
      },
    );

    return () => {
      unsubscribeLatestBatch();
    };
  }, [initialBatchId, userUid]);

  useEffect(() => {
    if (!resolvedBatchId) {
      return undefined;
    }

    setLoading(true);
    setError(null);

    const batchRef = doc(db, 'batches', resolvedBatchId);
    const unsubscribeBatch = onSnapshot(batchRef, (docSnap) => {
      if (docSnap.exists()) {
        setBatch({ id: docSnap.id, ...docSnap.data() } as Batch);
      } else {
        setError('Lote no encontrado');
        setBatch(null);
      }
    }, (err) => {
      console.error('Error fetching batch:', err);
      setError('Error al cargar el lote');
    });

    // Subscribe to jobs
    const jobsQuery = query(
      collection(db, 'jobs'),
      where('batchId', '==', resolvedBatchId),
      orderBy('createdAt', 'asc')
    );

    const unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
      const fetchedJobs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Job));
      setJobs(fetchedJobs);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching jobs:', err);
      setError('Error al cargar los trabajos');
      setLoading(false);
    });

    return () => {
      unsubscribeBatch();
      unsubscribeJobs();
    };
  }, [resolvedBatchId]);

  return { batch, jobs, loading, error, resolvedBatchId };
};
