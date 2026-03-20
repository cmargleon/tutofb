import { db } from '../../firebase';
import { collection, query, orderBy, limit, onSnapshot, doc } from 'firebase/firestore';
import { Batch, AnalyticsSummary } from '../../../shared/src/types';

export const subscribeToRecentBatches = (
  onData: (batches: Batch[]) => void,
  onError: (error: Error) => void
) => {
  const q = query(
    collection(db, 'batches'),
    orderBy('createdAt', 'desc'),
    limit(10)
  );

  return onSnapshot(q, (snapshot) => {
    const batches = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Batch[];
    onData(batches);
  }, onError);
};

export const subscribeToAnalyticsSummary = (
  onData: (summary: AnalyticsSummary | null) => void,
  onError: (error: Error) => void
) => {
  const docRef = doc(db, 'analytics_summary', 'global');
  
  return onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      onData(docSnap.data() as AnalyticsSummary);
    } else {
      onData(null);
    }
  }, onError);
};
