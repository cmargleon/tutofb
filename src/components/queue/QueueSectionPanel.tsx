import React, { useState } from 'react';
import { Check, ChevronDown, RefreshCw, Square } from 'lucide-react';
import {
  getUnreviewedFailedJobs,
  QueueBusyAction,
  QueueRow,
  QueueSection,
} from '../../features/queue/queueRows';
import { Badge, Button, Tone } from '../ui';
import { QueueBatchRow } from './QueueBatchRow';

const SECTION_COPY: Record<QueueSection, { title: string; description: string; empty: string; tone: Tone }> = {
  active: {
    title: 'En curso',
    description: 'Lotes con trabajos esperando turno o generándose ahora.',
    empty: 'No hay nada generándose.',
    tone: 'info',
  },
  attention: {
    title: 'Requieren atención',
    description: 'Lotes terminados con fallos sin revisar. Reintenta o descarta; se ocultan solos a los 7 días.',
    empty: 'No hay fallos pendientes de revisar.',
    tone: 'warning',
  },
  recent: {
    title: 'Terminados hoy',
    description: 'Lotes finalizados en las últimas 24 horas.',
    empty: 'Ningún lote terminó en las últimas 24 horas.',
    tone: 'neutral',
  },
};

const BulkActions: React.FC<{
  rows: QueueRow[];
  section: QueueSection;
  busyAction: QueueBusyAction;
  onRetry: (batchIds: string[]) => void;
  onCancel: (batchIds: string[]) => void;
  onAcknowledge: (batchIds: string[]) => void;
}> = ({ rows, section, busyAction, onRetry, onCancel, onAcknowledge }) => {
  if (rows.length < 2) return null;
  const ids = rows.map((row) => row.id);
  const busy = busyAction !== null;

  if (section === 'active') {
    return <Button size="sm" variant="ghost" icon={Square} disabled={busy} onClick={() => onCancel(ids)}>Cancelar todos</Button>;
  }
  if (section === 'attention') {
    const failed = rows.reduce((sum, row) => sum + getUnreviewedFailedJobs(row.batch), 0);
    return (
      <>
        <Button size="sm" variant="ghost" icon={RefreshCw} disabled={busy} onClick={() => onRetry(ids)}>Reintentar todos ({failed})</Button>
        <Button size="sm" variant="ghost" icon={Check} disabled={busy} onClick={() => onAcknowledge(ids)}>Descartar todos</Button>
      </>
    );
  }
  return null;
};

export const QueueSectionPanel: React.FC<{
  section: QueueSection;
  rows: QueueRow[];
  busyAction: QueueBusyAction;
  canRegenerate: boolean;
  defaultCollapsed?: boolean;
  onRetry: (batchIds: string[]) => void;
  onCancel: (batchIds: string[]) => void;
  onAcknowledge: (batchIds: string[]) => void;
}> = ({ section, rows, busyAction, canRegenerate, defaultCollapsed = false, onRetry, onCancel, onAcknowledge }) => {
  const copy = SECTION_COPY[section];
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const headingId = `queue-section-${section}`;
  const bodyId = `${headingId}-body`;

  return (
    <section aria-labelledby={headingId} className="tuto-surface overflow-hidden">
      <div className="px-4 py-3.5 sm:px-5">
        <h2 id={headingId} className="text-base font-semibold text-[var(--color-text-primary)]">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="flex items-center gap-2 rounded-md text-left hover:underline"
          >
            {copy.title}
            <Badge tone={rows.length ? copy.tone : 'neutral'}>{rows.length}</Badge>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} />
          </button>
        </h2>
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--color-text-muted)]">{copy.description}</p>
          {canRegenerate && !collapsed ? (
            <div className="flex flex-wrap gap-1">
              <BulkActions rows={rows} section={section} busyAction={busyAction} onRetry={onRetry} onCancel={onCancel} onAcknowledge={onAcknowledge} />
            </div>
          ) : null}
        </div>
      </div>

      {collapsed ? null : (
        <div id={bodyId} className="border-t border-[var(--color-border-subtle)]">
          {rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-[var(--color-text-muted)] sm:px-5">{copy.empty}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {rows.map((row) => (
                <QueueBatchRow
                  key={row.id}
                  row={row}
                  section={section}
                  busyAction={busyAction}
                  canRegenerate={canRegenerate}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  onAcknowledge={onAcknowledge}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
