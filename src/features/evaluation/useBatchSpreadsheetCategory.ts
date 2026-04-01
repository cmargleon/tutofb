import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Batch, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useBatchSpreadsheetCategory = (batch: Batch | null) => {
  const [categories, setCategories] = useState<SpreadsheetTemplateCategory[]>([]);
  const [loading, setLoading] = useState(Boolean(batch?.id && batch.spreadsheetTemplateId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = batch?.clientId || null;
    const templateId = batch?.spreadsheetTemplateId || null;

    if (!clientId || !templateId) {
      setCategories([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);
    const q = query(
      collection(db, 'clients', clientId, 'spreadsheetTemplates', templateId, 'categories'),
      orderBy('sheetName', 'asc'),
    );

    return onSnapshot(
      q,
      (snapshot) => {
        setCategories(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SpreadsheetTemplateCategory)));
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Error loading batch spreadsheet categories:', snapshotError);
        setCategories([]);
        setError('No se pudieron cargar las categorías del spreadsheet del lote.');
        setLoading(false);
      },
    );
  }, [batch?.clientId, batch?.id, batch?.spreadsheetTemplateId]);

  return {
    categories,
    loading,
    error,
  };
};
