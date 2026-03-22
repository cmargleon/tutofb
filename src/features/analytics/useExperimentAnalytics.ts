import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { computeBatchExperimentAnalytics } from '../../../shared/src/experiments';
import { Batch, BatchExperimentAnalytics, Job } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useExperimentAnalytics = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const experimentalBatchesQuery = query(
      collection(db, 'batches'),
      where('experimentEnabled', '==', true),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      experimentalBatchesQuery,
      (snapshot) => {
        const nextBatches = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Batch));
        setBatches(nextBatches);
        setSelectedBatchId((current) => current || nextBatches[0]?.id || null);
        setLoading(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los experimentos A/B.');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedBatchId) {
      setJobs([]);
      return;
    }

    const jobsQuery = query(
      collection(db, 'jobs'),
      where('batchId', '==', selectedBatchId),
      orderBy('createdAt', 'asc'),
    );

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        setJobs(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Job)));
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudieron cargar los jobs del experimento.');
      },
    );

    return () => unsubscribe();
  }, [selectedBatchId]);

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) || null,
    [batches, selectedBatchId],
  );

  const comparison = useMemo<BatchExperimentAnalytics | null>(
    () => computeBatchExperimentAnalytics(selectedBatch, jobs),
    [selectedBatch, jobs],
  );

  return {
    batches,
    selectedBatchId,
    setSelectedBatchId,
    comparison,
    loading,
    error,
  };
};
