import React from 'react';
import { AlertTriangle, CheckCircle2, ListOrdered, Loader2 } from 'lucide-react';
import { PROVIDER_LABELS } from '../../shared/src/domain';
import { Provider } from '../../shared/src/types';
import { Alert, Button, INPUT_CLASS, LoadingBlock, PageHeader } from '../components/ui';
import { RetryFailedJobsDialog } from '../components/evaluation/RetryFailedJobsDialog';
import { QueueSectionPanel } from '../components/queue/QueueSectionPanel';
import { useRole } from '../features/auth/AuthProvider';
import { useQueueActions } from '../features/queue/useQueueActions';
import { useQueueBoard } from '../features/queue/useQueueBoard';
import { formatRelativeDuration, QueueSummary } from '../features/queue/queueRows';
import { useSystemConfig } from '../features/system/useSystemConfig';

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

/** One line answering "does anything need me right now?". */
const QueueSummaryLine: React.FC<{ summary: QueueSummary }> = ({ summary }) => {
  if (summary.activeBatches === 0 && summary.attentionBatches === 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-success)]">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Todo al día: nada generándose ni fallos por revisar.
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
      {summary.activeBatches > 0 ? (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)] motion-reduce:animate-none" aria-hidden="true" />
          <span>
            <strong className="text-[var(--color-text-primary)]">{plural(summary.activeJobs, 'trabajo')}</strong> en curso
            {summary.etaSeconds !== null ? <> · termina en ~{formatRelativeDuration(summary.etaSeconds)}</> : null}
          </span>
        </span>
      ) : null}
      {summary.attentionBatches > 0 ? (
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" aria-hidden="true" />
          <span>
            <strong className="text-[var(--color-text-primary)]">{plural(summary.attentionBatches, 'lote')}</strong> con{' '}
            {plural(summary.attentionFailedJobs, 'fallo')} por revisar
          </span>
        </span>
      ) : null}
    </p>
  );
};

export const Cola: React.FC = () => {
  const role = useRole();
  const { config: systemConfig } = useSystemConfig();
  const board = useQueueBoard();
  const actions = useQueueActions(board.rowsById);
  const { busyAction, retryDialogBatchIds, setRetryDialogBatchIds, handleRetryFailed, handleCancelPending, handleAcknowledge } = actions;

  const header = (
    <PageHeader
      title="Cola"
      icon={ListOrdered}
      description="Lo que se está generando y los fallos que esperan una decisión."
    />
  );

  if (board.loading) {
    return <div className="tuto-page">{header}<LoadingBlock /></div>;
  }

  const sectionProps = {
    busyAction,
    canRegenerate: role.canRegenerate,
    onRetry: (batchIds: string[]) => setRetryDialogBatchIds(batchIds),
    onCancel: (batchIds: string[]) => void handleCancelPending(batchIds),
    onAcknowledge: (batchIds: string[]) => void handleAcknowledge(batchIds),
  };
  const showFilters = board.clientOptions.length > 1 || board.providerOptions.length > 1 || board.hasFilters;

  return (
    <div className="tuto-page">
      {header}

      {board.error ? <Alert tone="danger">{board.error}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <QueueSummaryLine summary={board.summary} />
        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span>Cliente</span>
              <select className={`${INPUT_CLASS} w-auto min-w-40`} value={board.clientFilter} onChange={(event) => board.setClientFilter(event.target.value)}>
                <option value="all">Todos</option>
                {board.clientOptions.map((client) => <option key={client} value={client}>{client}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span>Proveedor</span>
              <select className={`${INPUT_CLASS} w-auto min-w-40`} value={board.providerFilter} onChange={(event) => board.setProviderFilter(event.target.value as 'all' | Provider)}>
                <option value="all">Todos</option>
                {board.providerOptions.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
              </select>
            </label>
            {board.hasFilters ? <Button size="sm" variant="ghost" onClick={board.clearFilters}>Limpiar</Button> : null}
          </div>
        ) : null}
      </div>

      <QueueSectionPanel section="active" rows={board.sections.active} {...sectionProps} />
      <QueueSectionPanel section="attention" rows={board.sections.attention} {...sectionProps} />
      <QueueSectionPanel section="recent" rows={board.sections.recent} defaultCollapsed {...sectionProps} />

      <RetryFailedJobsDialog
        isOpen={Boolean(retryDialogBatchIds?.length)}
        isSubmitting={busyAction === 'retry'}
        failedJobsCount={actions.retryDialogFailedJobs}
        scopeLabel={actions.retryDialogScopeLabel}
        disabledProviders={systemConfig.disabledProviders}
        onClose={() => setRetryDialogBatchIds(null)}
        onSubmit={async (provider) => {
          const batchIds = retryDialogBatchIds || [];
          setRetryDialogBatchIds(null);
          await handleRetryFailed(batchIds, provider);
        }}
      />
    </div>
  );
};
