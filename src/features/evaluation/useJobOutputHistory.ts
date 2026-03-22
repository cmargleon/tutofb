import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { JobOutput } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useJobOutputHistory = (jobId: string | undefined, maxOutputs: number = 2) => {
  const [outputs, setOutputs] = useState<JobOutput[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setOutputs([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const outputsQuery = query(
      collection(db, 'jobs', jobId, 'outputs'),
      orderBy('createdAt', 'desc'),
      limit(maxOutputs),
    );

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
        setOutputs([]);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [jobId, maxOutputs]);

  return {
    outputs,
    loading,
    currentOutput: outputs[0] ?? null,
    previousOutput: outputs[1] ?? null,
  };
};
