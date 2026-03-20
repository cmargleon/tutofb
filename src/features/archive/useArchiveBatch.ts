import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { Batch, Job } from '../../../shared/src/types';

export const useArchiveBatch = (batchId: string | null) => {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId) {
      setBatch(null);
      setJobs([]);
      setLoading(false);
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
      console.error('Error fetching archive batch:', err);
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
      console.error('Error fetching archive jobs:', err);
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
