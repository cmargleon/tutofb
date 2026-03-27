import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { Batch } from '../../../shared/src/types';

const RECENT_BATCHES_LIMIT = 100;

export const useRecentEvaluationBatches = (userUid: string | null) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(Boolean(userUid));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userUid) {
      setBatches([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const recentBatchesQuery = query(
      collection(db, 'batches'),
      where('createdByUid', '==', userUid),
      orderBy('createdAt', 'desc'),
      limit(RECENT_BATCHES_LIMIT),
    );

    const unsubscribe = onSnapshot(
      recentBatchesQuery,
      (snapshot) => {
        setBatches(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() } as Batch)));
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Error fetching recent evaluation batches:', snapshotError);
        setBatches([]);
        setLoading(false);
        setError('No pudimos cargar tus lotes recientes.');
      },
    );

    return () => unsubscribe();
  }, [userUid]);

  return { batches, loading, error };
};
