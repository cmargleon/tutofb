import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, ExternalLink, RefreshCw, Square } from 'lucide-react';
import { PROVIDER_LABELS } from '../../../shared/src/domain';
import {
  formatElapsedSince,
  formatRelativeDuration,
  getBatchUpdatedAt,
  getUnreviewedFailedJobs,
  QueueBusyAction,
  QueueRow,
  QueueSection,
} from '../../features/queue/queueRows';
import { Button, buttonClasses } from '../ui';
import { QueueBatchFailures } from './QueueBatchFailures';

/** Marketplace photo batches store a fixed placeholder instead of a model name; it says nothing, so skip it. */
const GENERIC_MODEL_NAMES = new Set(['', 'Plan de fotografías']);
const batchSubtitleModel = (modelName: string | undefined) =>
  modelName && !GENERIC_MODEL_NAMES.has(modelName.trim()) ? `${modelName} · ` : '';

export const queueCatalogHref = (row: QueueRow) => `/catalogo?clientId=${row.batch.clientId}&batchId=${row.id}`;

/** Stacked bar: completed, failed, processing, pending, as shares of the batch's jobs. */
const BatchProgress: React.FC<{ row: QueueRow }> = ({ row }) => {
  const { completedJobs, failedJobs, processingJobs, pendingJobs, totalJobs } = row.batch;
  const total = Math.max(totalJobs, completedJobs + failedJobs + processingJobs + pendingJobs, 1);
  const segments = [
    { value: completedJobs, className: 'bg-[var(--color-success)]' },
    { value: failedJobs, className: 'bg-[var(--color-danger)]' },
    { value: processingJobs, className: 'bg-[var(--color-info)] animate-pulse motion-reduce:animate-none' },
  ];

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-neutral-soft)]"
      role="img"
      aria-label={`${completedJobs} completados, ${failedJobs} fallidos, ${processingJobs} procesando y ${pendingJobs} pendientes de ${totalJobs}`}
    >
      {segments.map((segment, index) => (segment.value > 0 ? (
        <span key={index} className={segment.className} style={{ width: `${(segment.value / total) * 100}%` }} />
      ) : null))}
    </div>
  );
};

const RowStatus: React.FC<{ row: QueueRow; section: QueueSection }> = ({ row, section }) => {
  const { batch } = row;
  const done = batch.completedJobs + batch.failedJobs;

  if (section === 'active') {
    const waiting = batch.processingJobs === 0;
    return (
      <>
        <span className="font-medium text-[var(--color-text-primary)]">{done}/{batch.totalJobs}</span>
        {batch.failedJobs > 0 ? <span className="text-[var(--color-danger)]"> · {batch.failedJobs} fallidos</span> : null}
        <span className="text-[var(--color-text-muted)]">
          {' · '}
          {waiting ? `en espera hace ${formatElapsedSince(row.ageStartedAt)}` : row.etaSeconds !== null ? `ETA ${formatRelativeDuration(row.etaSeconds)}` : 'calculando ETA'}
        </span>
      </>
    );
  }

  const unreviewed = getUnreviewedFailedJobs(batch);
  return (
    <>
      <span className="font-medium text-[var(--color-text-primary)]">{batch.completedJobs}/{batch.totalJobs} listas</span>
      {batch.failedJobs > 0 ? (
        <span className={unreviewed > 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}>
          {' · '}{batch.failedJobs} fallidos{unreviewed === 0 ? ' (revisado)' : ''}
        </span>
      ) : null}
      <span className="text-[var(--color-text-muted)]"> · hace {formatElapsedSince(getBatchUpdatedAt(batch))}</span>
    </>
  );
};

export const QueueBatchRow: React.FC<{
  row: QueueRow;
  section: QueueSection;
  busyAction: QueueBusyAction;
  canRegenerate: boolean;
  onRetry: (batchIds: string[]) => void;
  onCancel: (batchIds: string[]) => void;
  onAcknowledge: (batchIds: string[]) => void;
}> = ({ row, section, busyAction, canRegenerate, onRetry, onCancel, onAcknowledge }) => {
  const { batch } = row;
  const canExpand = batch.failedJobs > 0;
  const [expanded, setExpanded] = useState(false);
  const busy = busyAction !== null;
  const detailsId = `queue-failures-${row.id}`;

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={!canExpand}
          aria-expanded={canExpand ? expanded : undefined}
          aria-controls={canExpand ? detailsId : undefined}
          className="group flex min-w-0 flex-1 basis-64 items-start gap-2 rounded-md text-left disabled:cursor-default"
        >
          <ChevronRight
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''} ${canExpand ? '' : 'invisible'}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-semibold text-[var(--color-text-primary)] group-enabled:group-hover:underline">
                {batch.clientNameSnapshot || 'Cliente sin nombre'}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {batchSubtitleModel(batch.modelNameSnapshot)}
                {PROVIDER_LABELS[batch.provider] || batch.provider}
                {batch.garmentCount ? ` · ${batch.garmentCount} prenda${batch.garmentCount === 1 ? '' : 's'}` : ''}
                {' · '}<span className="font-mono">{row.id.slice(0, 6)}</span>
              </span>
            </span>
            <span className="mt-1.5 block max-w-md"><BatchProgress row={row} /></span>
            <span className="mt-1 block text-xs"><RowStatus row={row} section={section} /></span>
          </span>
        </button>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canRegenerate && section === 'active' ? (
            <Button size="sm" variant="secondary" icon={Square} disabled={busy} loading={busyAction === 'cancel'} onClick={() => onCancel([row.id])}>
              Cancelar
            </Button>
          ) : null}
          {canRegenerate && section !== 'active' && batch.failedJobs > 0 ? (
            <Button size="sm" variant={section === 'attention' ? 'warning' : 'secondary'} icon={RefreshCw} disabled={busy} onClick={() => onRetry([row.id])}>
              Reintentar
            </Button>
          ) : null}
          {canRegenerate && section === 'attention' ? (
            <Button size="sm" variant="ghost" icon={Check} disabled={busy} onClick={() => onAcknowledge([row.id])} title="Dar por buenos los fallos y quitar el lote de esta lista">
              Descartar
            </Button>
          ) : null}
          <Link to={queueCatalogHref(row)} className={buttonClasses('ghost', 'sm')} aria-label={`Abrir lote ${row.id.slice(0, 6)} en el catálogo`}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Abrir</span>
          </Link>
        </div>
      </div>

      {canExpand && expanded ? (
        <div id={detailsId} className="mt-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] px-3 sm:ml-6">
          <QueueBatchFailures batch={batch} catalogHref={queueCatalogHref(row)} />
        </div>
      ) : null}
    </li>
  );
};
