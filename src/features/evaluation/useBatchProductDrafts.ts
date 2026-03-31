import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ProductDraft } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useBatchProductDrafts = (batchId: string | null) => {
  const [productDrafts, setProductDrafts] = useState<ProductDraft[]>([]);
  const [loading, setLoading] = useState(Boolean(batchId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId) {
      setProductDrafts([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);
    const q = query(collection(db, 'batches', batchId, 'productDrafts'), orderBy('garmentName', 'asc'));
    return onSnapshot(q, (snapshot) => {
      setProductDrafts(snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as ProductDraft)));
      setLoading(false);
    }, (snapshotError) => {
      console.error('Error loading product drafts:', snapshotError);
      setError('No se pudieron cargar los product drafts del lote.');
      setLoading(false);
    });
  }, [batchId]);

  return {
    productDrafts,
    loading,
    error,
  };
};
