import React from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Batch } from '../../../shared/src/types';
import { MarketplaceExportAction } from '../../features/marketplaces/MarketplaceExportDrawer';
import { SpreadsheetEditStatus } from '../../features/catalog/useCatalogBatchActions';

export const CatalogBatchExportPanel: React.FC<{
  selectedBatch: Batch | null;
  hasError: boolean;
  batchLinkError: string | null;
  spreadsheetEditStatus: SpreadsheetEditStatus;
  spreadsheetEditError: string | null;
  isExportingSpreadsheet: boolean;
  onEditSpreadsheet: () => void;
  onExportSpreadsheet: () => void;
}> = ({
  selectedBatch,
  hasError,
  batchLinkError,
  spreadsheetEditStatus,
  spreadsheetEditError,
  isExportingSpreadsheet,
  onEditSpreadsheet,
  onExportSpreadsheet,
}) => (
  <>
    {selectedBatch && !hasError && !batchLinkError && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-sm text-slate-600">Completa los datos y prepara los archivos de los destinos de este cliente.</p><MarketplaceExportAction scope={{ clientId: selectedBatch.clientId, batchIds: [selectedBatch.id!] }} /></div>}

    {selectedBatch?.spreadsheetTemplateId && !hasError && (
      <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Excel heredado del lote</p>
          <p className="text-xs text-gray-400">
            Plantilla: {selectedBatch.spreadsheetTemplateNameSnapshot || 'Sin nombre'}
            {selectedBatch.spreadsheetCategoryNameSnapshot ? ` · ${selectedBatch.spreadsheetCategoryNameSnapshot}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onEditSpreadsheet}
              disabled={spreadsheetEditStatus !== 'idle'}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {spreadsheetEditStatus === 'preparing'
                ? <span className="app-spinner app-spinner-sm" aria-hidden="true" />
                : <ExternalLink className="h-4 w-4" />}
              {spreadsheetEditStatus === 'preparing'
                ? 'Preparando...'
                : spreadsheetEditStatus === 'opening'
                  ? 'Abriendo...'
                  : 'Editar Excel'}
            </button>
            <button
              type="button"
              onClick={onExportSpreadsheet}
              disabled={isExportingSpreadsheet}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExportingSpreadsheet
                ? <span className="app-spinner app-spinner-sm" aria-hidden="true" />
                : <Download className="h-4 w-4" />}
              {isExportingSpreadsheet ? 'Exportando...' : 'Descargar Excel del lote'}
            </button>
          </div>
          {spreadsheetEditError && (
            <p className="max-w-md text-xs font-medium text-red-500 sm:text-right">
              {spreadsheetEditError}
            </p>
          )}
        </div>
      </div>
    )}
  </>
);
