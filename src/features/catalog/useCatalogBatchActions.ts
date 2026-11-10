import { useState } from 'react';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { Batch, Provider } from '../../../shared/src/types';
import { cancelBatchProcessing, editBatchSpreadsheet, exportBatchSpreadsheet, regenerateFailedBatchJobs } from '../evaluation/firebase';
import { useConfirm, useToast } from '../feedback/FeedbackProvider';

export type SpreadsheetEditStatus = 'idle' | 'preparing' | 'opening';

export const useCatalogBatchActions = ({
  selectedBatchId,
  selectedBatch,
}: {
  selectedBatchId: string;
  selectedBatch: Batch | null;
}) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false);
  const [spreadsheetEditStatus, setSpreadsheetEditStatus] = useState<SpreadsheetEditStatus>('idle');
  const [spreadsheetEditError, setSpreadsheetEditError] = useState<string | null>(null);
  const [isRegeneratingFailed, setIsRegeneratingFailed] = useState(false);
  const [isCancellingBatch, setIsCancellingBatch] = useState(false);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [isRetryDialogOpen, setIsRetryDialogOpen] = useState(false);

  const handleRegenerateFailedJobs = async (provider: Provider | null) => {
    if (!selectedBatchId) return;
    setIsRegeneratingFailed(true);
    setBatchActionMessage(null);
    try {
      const result = await regenerateFailedBatchJobs(selectedBatchId, provider);
      const providerSuffix = result.retryProvider ? ` con ${PROVIDER_LABELS[result.retryProvider]}` : '';
      if (result.queuedJobs === 0) {
        setBatchActionMessage('No había trabajos fallidos pendientes para reintentar.');
      } else if (result.skippedJobs > 0) {
        setBatchActionMessage(`Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'}${providerSuffix}. ${result.skippedJobs} se omitieron por datos inválidos.`);
      } else {
        setBatchActionMessage(`Se reintentaron ${result.queuedJobs} trabajo${result.queuedJobs === 1 ? '' : 's'} fallido${result.queuedJobs === 1 ? '' : 's'} del lote${providerSuffix}.`);
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos reintentar los trabajos fallidos', description: err.message || 'Revisa el estado del lote e inténtalo nuevamente.' });
    } finally {
      setIsRegeneratingFailed(false);
    }
  };

  const handleCancelBatchProcessing = async () => {
    if (!selectedBatch?.id) return;
    const activeJobs = selectedBatch.pendingJobs + selectedBatch.processingJobs;
    const activeJobsLabel = `${activeJobs} trabajo${activeJobs === 1 ? '' : 's'}`;
    const pendingLabel = selectedBatch.pendingJobs > 0 ? `${selectedBatch.pendingJobs} pendiente${selectedBatch.pendingJobs === 1 ? '' : 's'}` : null;
    const processingLabel = selectedBatch.processingJobs > 0 ? `${selectedBatch.processingJobs} en procesamiento` : null;
    const scopeLabel = [pendingLabel, processingLabel].filter(Boolean).join(' y ');

    const accepted = await confirm({
      title: 'Cancelar procesamiento del lote',
      description: `Vas a detener ${activeJobsLabel}${scopeLabel ? ` (${scopeLabel})` : ''} para este lote.`,
      impact: 'Los jobs en cola dejarán de ejecutarse y los que ya estaban procesando ignorarán cualquier resultado tardío. Si los necesitas después, tendrás que relanzarlos manualmente.',
      confirmLabel: 'Sí, cancelar lote',
      cancelLabel: 'Seguir procesando',
      tone: 'warning',
    });
    if (!accepted) return;

    setIsCancellingBatch(true);
    setBatchActionMessage(null);
    try {
      const result = await cancelBatchProcessing(selectedBatch.id);
      if (result.cancelledJobs === 0) {
        setBatchActionMessage('No había trabajos activos para cancelar en este lote.');
      } else {
        const segments = [
          result.cancelledPendingJobs > 0 ? `${result.cancelledPendingJobs} pendiente${result.cancelledPendingJobs === 1 ? '' : 's'}` : null,
          result.cancelledProcessingJobs > 0 ? `${result.cancelledProcessingJobs} en procesamiento` : null,
        ].filter(Boolean);
        setBatchActionMessage(`Se cancelaron ${result.cancelledJobs} trabajo${result.cancelledJobs === 1 ? '' : 's'} del lote${segments.length > 0 ? `: ${segments.join(' y ')}.` : '.'}`);
      }
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos cancelar el lote', description: err.message || 'Inténtalo nuevamente cuando el sistema esté disponible.' });
    } finally {
      setIsCancellingBatch(false);
    }
  };

  const handleExportSpreadsheet = async () => {
    if (!selectedBatchId) return;
    setIsExportingSpreadsheet(true);
    try {
      const result = await exportBatchSpreadsheet(selectedBatchId);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
      toast({ tone: 'success', title: 'Spreadsheet exportado', description: `${result.fileName} quedó listo para descarga.` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No pudimos exportar el spreadsheet', description: err.message || 'Inténtalo de nuevo.' });
    } finally {
      setIsExportingSpreadsheet(false);
    }
  };

  const handleEditSpreadsheet = async () => {
    if (!selectedBatchId) return;
    setSpreadsheetEditStatus('preparing');
    setSpreadsheetEditError(null);

    try {
      const result = await editBatchSpreadsheet(selectedBatchId);
      setSpreadsheetEditStatus('opening');
      const openedWindow = window.open(result.sheetUrl, '_blank', 'noopener,noreferrer');
      if (!openedWindow) {
        setSpreadsheetEditError('El navegador bloqueó la pestaña de Google Sheets. Permite ventanas emergentes e inténtalo de nuevo.');
      }
      window.setTimeout(() => setSpreadsheetEditStatus('idle'), 600);
    } catch (err: any) {
      const message = err.message || 'Google Drive no pudo preparar el Sheet editable.';
      setSpreadsheetEditError(message);
      toast({ tone: 'error', title: 'No pudimos abrir Google Sheets', description: message });
      setSpreadsheetEditStatus('idle');
    }
  };

  const resetBatchActionFeedback = () => {
    setSpreadsheetEditStatus('idle');
    setSpreadsheetEditError(null);
    setBatchActionMessage(null);
  };

  return {
    isExportingSpreadsheet,
    spreadsheetEditStatus,
    spreadsheetEditError,
    isRegeneratingFailed,
    isCancellingBatch,
    batchActionMessage,
    isRetryDialogOpen,
    setIsRetryDialogOpen,
    handleRegenerateFailedJobs,
    handleCancelBatchProcessing,
    handleExportSpreadsheet,
    handleEditSpreadsheet,
    resetBatchActionFeedback,
  };
};
