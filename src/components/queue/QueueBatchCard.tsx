import React from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { StatusBadge } from '../ui';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import { formatDateTime } from '../../../shared/src/utils/dateUtils';
import { formatElapsedSince, formatRelativeDuration, QueueBusyAction, QueueRow } from '../../features/queue/queueRows';

export const QueueBatchCard: React.FC<{
  row: QueueRow;
  selected: boolean;
  busyAction: QueueBusyAction;
  canRegenerate: boolean;
  onToggle: (batchId: string) => void;
  onRetry: (batchIds: string[]) => Promise<void>;
  onCancel: (batchIds: string[]) => Promise<void>;
}> = ({ row, selected, busyAction, canRegenerate, onToggle, onRetry, onCancel }) => (
  <article
    className={`rounded-3xl border p-4 shadow-sm transition ${
      selected
        ? 'border-indigo-300 bg-indigo-50/60 shadow-indigo-100/80'
        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row.id)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Seleccionar
      </label>
      <StatusBadge status={row.batch.status} />
    </div>

    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {PROVIDER_LABELS[row.batch.provider]}
      </div>
      <div className="mt-2 text-base font-semibold text-slate-900">{row.batch.clientNameSnapshot}</div>
      <div className="text-sm text-slate-600">{row.batch.modelNameSnapshot}</div>
      <div className="mt-1 text-xs text-slate-500">
        <span className="font-mono">{row.id.slice(0, 8)}</span> · actualizado {formatDateTime(row.batch.updatedAt)}
      </div>
    </div>

    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-2xl bg-slate-50 px-2 py-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Pend</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{row.batch.pendingJobs}</div>
      </div>
      <div className="rounded-2xl bg-slate-50 px-2 py-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Proc</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{row.batch.processingJobs}</div>
      </div>
      <div className="rounded-2xl bg-slate-50 px-2 py-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Total</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{row.batch.totalJobs}</div>
      </div>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">ETA</div>
        <div className="mt-1 font-medium text-slate-900">
          {row.batch.pendingJobs + row.batch.processingJobs > 0 ? formatRelativeDuration(row.etaSeconds) : 'Sin cola'}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {row.batch.processingJobs > 0 ? 'basada en trabajos completados' : 'esperando primer resultado'}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="text-xs uppercase tracking-[0.12em] text-slate-500">Antigüedad</div>
        <div className="mt-1 font-medium text-slate-900">{formatElapsedSince(row.ageStartedAt)}</div>
        <div className="mt-1 text-xs text-slate-500">creado {formatDateTime(row.batch.createdAt)}</div>
      </div>
    </div>

    <div className="mt-4 text-xs text-slate-500">
      {row.batch.completedJobs} completados · {row.batch.failedJobs} fallidos
    </div>

    <div className="mt-4 flex flex-col gap-2">
      <Link
        to={`/catalogo?clientId=${row.batch.clientId}&batchId=${row.id}`}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
      >
        Abrir lote
      </Link>

      {canRegenerate ? (
        <>
          <button
            type="button"
            onClick={() => void onRetry([row.id])}
            disabled={busyAction !== null || row.batch.failedJobs === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busyAction === 'retry' ? 'animate-spin' : ''}`} />
            Reintentar fallidos
          </button>
          <button
            type="button"
            onClick={() => void onCancel([row.id])}
            disabled={busyAction !== null || (row.batch.pendingJobs === 0 && row.batch.processingJobs === 0)}
            className="rounded-xl bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar lote
          </button>
        </>
      ) : null}
    </div>
  </article>
);
