import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Batch } from '../../../shared/src/types';

export const CatalogBatchStatusPanel: React.FC<{
  selectedBatch: Batch | null;
  canRegenerate: boolean;
  hasError: boolean;
  selectedBatchIsGenerating: boolean;
  isCancellingBatch: boolean;
  isRegeneratingFailed: boolean;
  batchActionMessage: string | null;
  onCancelBatch: () => void;
  onOpenRetryDialog: () => void;
}> = ({
  selectedBatch,
  canRegenerate,
  hasError,
  selectedBatchIsGenerating,
  isCancellingBatch,
  isRegeneratingFailed,
  batchActionMessage,
  onCancelBatch,
  onOpenRetryDialog,
}) => (
  <>
    {selectedBatch && canRegenerate && !hasError && (selectedBatch.failedJobs > 0 || selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0) && (
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        {(selectedBatch.pendingJobs > 0 || selectedBatch.processingJobs > 0) && (
          <button
            type="button"
            onClick={onCancelBatch}
            disabled={isCancellingBatch}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCancellingBatch
              ? <span className="app-spinner app-spinner-sm" aria-hidden="true" />
              : <AlertCircle className="h-4 w-4" />}
            {isCancellingBatch ? 'Cancelando...' : 'Cancelar lote'}
          </button>
        )}
        {selectedBatch.failedJobs > 0 && (
          <button
            type="button"
            onClick={onOpenRetryDialog}
            disabled={isRegeneratingFailed}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isRegeneratingFailed ? 'animate-spin' : ''}`} />
            {isRegeneratingFailed ? 'Reintentando...' : `Reintentar fallidos (${selectedBatch.failedJobs})`}
          </button>
        )}
      </div>
    )}

    {batchActionMessage && (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {batchActionMessage}
      </div>
    )}

    {selectedBatchIsGenerating && !hasError && (
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="app-spinner app-spinner-sm shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">El catálogo se actualiza solo a medida que salen imágenes nuevas.</p>
            <p className="text-indigo-700">
              {selectedBatch?.completedJobs} de {selectedBatch?.totalJobs} jobs completados en este lote.
            </p>
          </div>
        </div>
      </div>
    )}
  </>
);
