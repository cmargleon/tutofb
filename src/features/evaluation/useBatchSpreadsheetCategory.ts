import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Batch, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useBatchSpreadsheetCategory = (batch: Batch | null) => {
  const [category, setCategory] = useState<SpreadsheetTemplateCategory | null>(null);
  const [loading, setLoading] = useState(Boolean(batch?.id && batch.spreadsheetTemplateId && batch.spreadsheetCategoryId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = batch?.clientId || null;
    const templateId = batch?.spreadsheetTemplateId || null;
    const categoryId = batch?.spreadsheetCategoryId || null;

    if (!clientId || !templateId || !categoryId) {
      setCategory(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const categoryRef = doc(
      db,
      'clients',
      clientId,
      'spreadsheetTemplates',
      templateId,
      'categories',
      categoryId,
    );

    return onSnapshot(
      categoryRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setCategory(null);
          setError('La categoría del spreadsheet asociada a este lote ya no existe.');
          setLoading(false);
          return;
        }

        setCategory({
          id: snapshot.id,
          ...snapshot.data(),
        } as SpreadsheetTemplateCategory);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Error loading batch spreadsheet category:', snapshotError);
        setCategory(null);
        setError('No se pudo cargar la categoría del spreadsheet del lote.');
        setLoading(false);
      },
    );
  }, [batch?.clientId, batch?.id, batch?.spreadsheetCategoryId, batch?.spreadsheetTemplateId]);

  return {
    category,
    loading,
    error,
  };
};
