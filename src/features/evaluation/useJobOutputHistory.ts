import { useEffect, useState } from 'react';
import { QueryConstraint, collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { JobOutput } from '../../../shared/src/types';
import { db } from '../../firebase';

const EMPTY_OUTPUTS: JobOutput[] = [];

export const useJobOutputHistory = (jobId: string | undefined, maxOutputs?: number) => {
  const [outputs, setOutputs] = useState<JobOutput[]>([]);
  const [loadedJobId, setLoadedJobId] = useState<string>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(false);
    if (!jobId) {
      setOutputs([]);
      setLoading(false);
      return;
    }

    setLoadedJobId(jobId);
    setOutputs([]);
    setLoading(true);

    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
    if (typeof maxOutputs === 'number') {
      constraints.push(limit(maxOutputs));
    }

    const outputsQuery = query(collection(db, 'jobs', jobId, 'outputs'), ...constraints);

    const unsubscribe = onSnapshot(
      outputsQuery,
      (snapshot) => {
        setOutputs(
          snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...docSnapshot.data(),
          })) as JobOutput[],
        );
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching output history:', error);
        setError(true);
        setOutputs([]);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [jobId, maxOutputs]);

  const scoped = Boolean(jobId && loadedJobId === jobId);
  return {
    outputs: scoped ? outputs : EMPTY_OUTPUTS,
    loading: Boolean(jobId) && (!scoped || loading),
    error: scoped && error,
    currentOutput: scoped ? outputs[0] ?? null : null,
    previousOutput: scoped ? outputs[1] ?? null : null,
  };
};
