import React from 'react';
import { RefreshCw } from 'lucide-react';
import { QueueBusyAction, QueueRow } from '../../features/queue/queueRows';

export const QueueSelectionControls: React.FC<{
  filteredRowsCount: number;
  selectedRows: QueueRow[];
  allFilteredSelected: boolean;
  canRegenerate: boolean;
  busyAction: QueueBusyAction;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onRetrySelected: () => void;
  onCancelSelected: () => void;
}> = ({
  filteredRowsCount,
  selectedRows,
  allFilteredSelected,
  canRegenerate,
  busyAction,
  onSelectAllFiltered,
  onClearSelection,
  onRetrySelected,
  onCancelSelected,
}) => (
  <>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSelectAllFiltered}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {allFilteredSelected ? 'Quitar visibles' : `Seleccionar ${filteredRowsCount} visibles`}
      </button>

      {selectedRows.length > 0 ? (
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Limpiar selección
        </button>
      ) : null}
    </div>

    {!canRegenerate ? (
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Tu rol puede monitorear la cola y abrir lotes, pero no ejecutar reintentos ni cancelaciones.
      </div>
    ) : null}

    {selectedRows.length > 0 ? (
      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-sm text-slate-700">
          <strong>{selectedRows.length}</strong> lotes seleccionados para acciones masivas.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canRegenerate ? (
            <>
              <button
                type="button"
                onClick={onRetrySelected}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${busyAction === 'retry' ? 'animate-spin' : ''}`} />
                Reintentar fallidos
              </button>
              <button
                type="button"
                onClick={onCancelSelected}
                disabled={busyAction !== null}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar lote
              </button>
            </>
          ) : null}
        </div>
      </div>
    ) : null}
  </>
);
