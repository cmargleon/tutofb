import { useState, useEffect } from 'react';
import { db, auth } from '../../firebase';
import { doc, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { Batch, Job } from '../../../shared/src/types';

export const useEvaluationBatch = (initialBatchId: string | null) => {
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialBatchId) {
      setBatchId(initialBatchId);
    } else {
      // Find the most recent batch for the user
      if (!auth.currentUser) {
        setLoading(false);
        setError('Usuario no autenticado');
        return;
      }
      
      const recentBatchQuery = query(
        collection(db, 'batches'),
        where('createdByUid', '==', auth.currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      
      const unsubscribeRecent = onSnapshot(recentBatchQuery, (snapshot) => {
        if (!snapshot.empty) {
          setBatchId(snapshot.docs[0].id);
        } else {
          setLoading(false);
          setError('No hay lotes recientes');
        }
      }, (err) => {
        console.error('Error fetching recent batch:', err);
        setLoading(false);
        setError('Error al buscar lote reciente');
      });
      
      return () => unsubscribeRecent();
    }
  }, [initialBatchId]);

  useEffect(() => {
    if (!batchId) {
      return;
    }

    setLoading(true);
    setError(null);

    // Subscribe to batch
    const batchRef = doc(db, 'batches', batchId);
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
      where('batchId', '==', batchId),
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
  }, [batchId]);

  return { batch, jobs, loading, error };
};
