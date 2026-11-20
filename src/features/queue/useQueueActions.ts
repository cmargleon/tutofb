import { useMemo, useState } from 'react';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { Provider } from '../../../shared/src/types';
import { cancelPendingBatchJobs, regenerateFailedBatchJobs } from '../evaluation/firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';
import { acknowledgeBatchFailures } from './firebase';
import { getUnreviewedFailedJobs, QueueBusyAction, QueueRow } from './queueRows';

export const useQueueActions = (rowsById: Record<string, QueueRow>) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [busyAction, setBusyAction] = useState<QueueBusyAction>(null);
  const notify = (title: string, tone: 'success' | 'info' = 'success') => toast({ tone, title });
  const [retryDialogBatchIds, setRetryDialogBatchIds] = useState<string[] | null>(null);

  const handleRetryFailed = async (batchIds: string[], provider: Provider | null) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && row.batch.failedJobs > 0);
    if (eligibleRows.length === 0) {
      notify('No había trabajos fallidos en los lotes seleccionados.', 'info');
      return;
    }

    setBusyAction('retry');

    try {
      const results = await Promise.all(eligibleRows.map((row) => regenerateFailedBatchJobs(row.id, provider)));
      const queuedJobs = results.reduce((sum, result) => sum + result.queuedJobs, 0);
      const skippedJobs = results.reduce((sum, result) => sum + result.skippedJobs, 0);
      const retryProvider = results.find((result) => result.retryProvider)?.retryProvider || null;
      const providerSuffix = retryProvider ? ` con ${PROVIDER_LABELS[retryProvider]}` : '';

      if (queuedJobs === 0) {
        notify('No había trabajos fallidos listos para reencolar.', 'info');
      } else if (skippedJobs > 0) {
        notify(
          `Se reencolaron ${queuedJobs} trabajos fallidos${providerSuffix} en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}. ${skippedJobs} se omitieron por datos inválidos.`,
        );
      } else {
        notify(`Se reencolaron ${queuedJobs} trabajos fallidos${providerSuffix} en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`);
      }
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reencolar los trabajos fallidos',
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
      notify('No había trabajos activos para cancelar en los lotes seleccionados.', 'info');
      return;
    }

    const activeJobs = eligibleRows.reduce((sum, row) => sum + row.batch.pendingJobs + row.batch.processingJobs, 0);
    const accepted = await confirm({
      title: 'Cancelar lote',
      description: `Vas a detener ${activeJobs} trabajos activos distribuidos en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`,
      impact: 'Se cancelarán tanto los trabajos pendientes como los que están en procesamiento. El lote quedará detenido por completo.',
      confirmLabel: 'Sí, cancelar lote',
      cancelLabel: 'Mantener cola',
      tone: 'warning',
    });

    if (!accepted) {
      return;
    }

    setBusyAction('cancel');

    try {
      const results = await Promise.all(eligibleRows.map((row) => cancelPendingBatchJobs(row.id)));
      const cancelledJobs = results.reduce((sum, result) => sum + result.cancelledJobs, 0);

      if (cancelledJobs === 0) {
        notify('No había trabajos activos por cancelar.', 'info');
      } else {
        notify(`Se cancelaron ${cancelledJobs} trabajos en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`);
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

  /** Hides reviewed failures from Cola. Not destructive (jobs and catalog stay as they are), so no confirmation. */
  const handleAcknowledge = async (batchIds: string[]) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && getUnreviewedFailedJobs(row.batch) > 0);
    if (eligibleRows.length === 0) {
      return;
    }

    setBusyAction('acknowledge');
    try {
      await Promise.all(eligibleRows.map((row) => acknowledgeBatchFailures(row.id)));
      notify(eligibleRows.length === 1 ? 'Lote marcado como revisado.' : `${eligibleRows.length} lotes marcados como revisados.`);
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos marcar el lote como revisado',
        description: error?.message || 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return {
    busyAction,
    retryDialogBatchIds,
    setRetryDialogBatchIds,
    retryDialogFailedJobs,
    retryDialogScopeLabel,
    handleRetryFailed,
    handleCancelPending,
    handleAcknowledge,
  };
};
