import React from 'react';
import { CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { KanbanStage, QueueBusyAction, QueueRow } from '../../features/queue/queueRows';
import { QueueBatchCard } from './QueueBatchCard';

const KANBAN_COLUMNS: Array<{
  id: KanbanStage;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: React.ElementType;
  accentClassName: string;
  badgeClassName: string;
}> = [
  {
    id: 'pending',
    title: 'Pendiente',
    description: 'Lotes esperando su primer turno de ejecución.',
    emptyTitle: 'Nada pendiente',
    emptyDescription: 'Los lotes nuevos aparecerán aquí apenas entren a la cola.',
    icon: Clock3,
    accentClassName: 'from-amber-100 via-amber-50 to-white',
    badgeClassName: 'bg-amber-100 text-amber-800',
  },
  {
    id: 'processing',
    title: 'Procesando',
    description: 'Lotes con jobs activos generando resultados ahora.',
    emptyTitle: 'Sin procesamiento',
    emptyDescription: 'Cuando la IA esté trabajando en un lote, lo verás en esta columna.',
    icon: RefreshCw,
    accentClassName: 'from-sky-100 via-sky-50 to-white',
    badgeClassName: 'bg-sky-100 text-sky-800',
  },
  {
    id: 'ready',
    title: 'Resultados',
    description: 'Lotes con resultados o fallos listos para abrir en catálogo.',
    emptyTitle: 'Sin resultados listos',
    emptyDescription: 'Los lotes con salidas parciales, completas o fallidas caerán aquí.',
    icon: CheckCircle2,
    accentClassName: 'from-emerald-100 via-emerald-50 to-white',
    badgeClassName: 'bg-emerald-100 text-emerald-800',
  },
];

export const QueueKanbanBoard: React.FC<{
  rowsByStage: Record<KanbanStage, QueueRow[]>;
  selectedBatchIds: string[];
  busyAction: QueueBusyAction;
  canRegenerate: boolean;
  onToggle: (batchId: string) => void;
  onRetry: (batchIds: string[]) => Promise<void>;
  onCancel: (batchIds: string[]) => Promise<void>;
}> = ({ rowsByStage, selectedBatchIds, busyAction, canRegenerate, onToggle, onRetry, onCancel }) => (
  <div className="mt-6 grid gap-4 xl:grid-cols-3">
    {KANBAN_COLUMNS.map((column) => {
      const Icon = column.icon;
      const columnRows = rowsByStage[column.id];

      return (
        <section
          key={column.id}
          className={`rounded-3xl border border-slate-200 bg-gradient-to-b ${column.accentClassName} p-4 shadow-sm`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className={`rounded-2xl p-2 ${column.badgeClassName}`}>
                  <Icon className={`h-4 w-4 ${column.id === 'processing' ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{column.title}</h3>
                  <p className="text-sm text-slate-600">{column.description}</p>
                </div>
              </div>
            </div>

            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${column.badgeClassName}`}>
              {columnRows.length} lote{columnRows.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-4 space-y-4">
            {columnRows.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 px-4 py-8 text-center">
                <div className="text-sm font-semibold text-slate-900">{column.emptyTitle}</div>
                <div className="mt-2 text-sm text-slate-500">{column.emptyDescription}</div>
              </div>
            ) : (
              columnRows.map((row) => (
                <QueueBatchCard
                  key={row.id}
                  row={row}
                  selected={selectedBatchIds.includes(row.id)}
                  busyAction={busyAction}
                  canRegenerate={canRegenerate}
                  onToggle={onToggle}
                  onRetry={onRetry}
                  onCancel={onCancel}
                />
              ))
            )}
          </div>
        </section>
      );
    })}
  </div>
);
