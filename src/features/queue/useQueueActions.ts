import { useMemo, useState } from 'react';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { Provider } from '../../../shared/src/types';
import { cancelPendingBatchJobs, regenerateFailedBatchJobs } from '../evaluation/firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { QueueBusyAction, QueueRow } from './queueRows';

export const useQueueActions = (rowsById: Record<string, QueueRow>) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [busyAction, setBusyAction] = useState<QueueBusyAction>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [retryDialogBatchIds, setRetryDialogBatchIds] = useState<string[] | null>(null);

  const handleRetryFailed = async (batchIds: string[], provider: Provider | null) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && row.batch.failedJobs > 0);
    if (eligibleRows.length === 0) {
      setActionMessage('No había jobs fallidos en los lotes seleccionados.');
      return;
    }

    setBusyAction('retry');
    setActionMessage(null);

    try {
      const results = await Promise.all(eligibleRows.map((row) => regenerateFailedBatchJobs(row.id, provider)));
      const queuedJobs = results.reduce((sum, result) => sum + result.queuedJobs, 0);
      const skippedJobs = results.reduce((sum, result) => sum + result.skippedJobs, 0);
      const retryProvider = results.find((result) => result.retryProvider)?.retryProvider || null;
      const providerSuffix = retryProvider ? ` con ${PROVIDER_LABELS[retryProvider]}` : '';

      if (queuedJobs === 0) {
        setActionMessage('No había jobs fallidos listos para reencolar.');
      } else if (skippedJobs > 0) {
        setActionMessage(
          `Se reencolaron ${queuedJobs} jobs fallidos${providerSuffix} en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}. ${skippedJobs} se omitieron por datos inválidos.`,
        );
      } else {
        setActionMessage(`Se reencolaron ${queuedJobs} jobs fallidos${providerSuffix} en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`);
      }
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reencolar los jobs fallidos',
        description: error?.message || 'Vuelve a intentarlo cuando la cola esté disponible.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const retryDialogRows = useMemo(
    () =>
      (retryDialogBatchIds || [])
        .map((batchId) => rowsById[batchId])
        .filter((row): row is QueueRow => Boolean(row) && row.batch.failedJobs > 0),
    [retryDialogBatchIds, rowsById],
  );
  const retryDialogFailedJobs = useMemo(
    () => retryDialogRows.reduce((sum, row) => sum + row.batch.failedJobs, 0),
    [retryDialogRows],
  );
  const retryDialogScopeLabel = retryDialogRows.length <= 1 ? 'este lote' : `${retryDialogRows.length} lotes`;

  const handleCancelPending = async (batchIds: string[]) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && (row.batch.pendingJobs > 0 || row.batch.processingJobs > 0));
    if (eligibleRows.length === 0) {
      setActionMessage('No había jobs activos para cancelar en los lotes seleccionados.');
      return;
    }

    const activeJobs = eligibleRows.reduce((sum, row) => sum + row.batch.pendingJobs + row.batch.processingJobs, 0);
    const accepted = await confirm({
      title: 'Cancelar lote',
      description: `Vas a detener ${activeJobs} jobs activos distribuidos en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`,
      impact: 'Se cancelarán tanto los jobs pendientes como los que están en procesamiento. El lote quedará detenido por completo.',
      confirmLabel: 'Sí, cancelar lote',
      cancelLabel: 'Mantener cola',
      tone: 'warning',
    });

    if (!accepted) {
      return;
    }

    setBusyAction('cancel');
    setActionMessage(null);

    try {
      const results = await Promise.all(eligibleRows.map((row) => cancelPendingBatchJobs(row.id)));
      const cancelledJobs = results.reduce((sum, result) => sum + result.cancelledJobs, 0);

      if (cancelledJobs === 0) {
        setActionMessage('No había jobs activos por cancelar.');
      } else {
        setActionMessage(`Se cancelaron ${cancelledJobs} jobs en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`);
      }
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos cancelar el lote',
        description: error?.message || 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return {
    busyAction,
    actionMessage,
    retryDialogBatchIds,
    setRetryDialogBatchIds,
    retryDialogFailedJobs,
    retryDialogScopeLabel,
    handleRetryFailed,
    handleCancelPending,
  };
};
