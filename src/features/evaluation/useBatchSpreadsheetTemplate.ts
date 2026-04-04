import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Batch, SpreadsheetTemplate } from '../../../shared/src/types';
import { db } from '../../firebase';

export const useBatchSpreadsheetTemplate = (batch: Batch | null) => {
  const [template, setTemplate] = useState<SpreadsheetTemplate | null>(null);
  const [loading, setLoading] = useState(Boolean(batch?.clientId && batch?.spreadsheetTemplateId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = batch?.clientId || null;
    const templateId = batch?.spreadsheetTemplateId || null;

    if (!clientId || !templateId) {
      setTemplate(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);
    const templateRef = doc(db, 'clients', clientId, 'spreadsheetTemplates', templateId);

    return onSnapshot(
      templateRef,
      (docSnapshot) => {
        if (!docSnapshot.exists()) {
          setTemplate(null);
          setError('No se pudo cargar la plantilla del spreadsheet del lote.');
          setLoading(false);
          return;
        }

        setTemplate({ id: docSnapshot.id, ...docSnapshot.data() } as SpreadsheetTemplate);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Error loading batch spreadsheet template:', snapshotError);
        setTemplate(null);
        setError('No se pudo cargar la plantilla del spreadsheet del lote.');
        setLoading(false);
      },
    );
  }, [batch?.clientId, batch?.spreadsheetTemplateId]);

  return {
    template,
    loading,
    error,
  };
};
