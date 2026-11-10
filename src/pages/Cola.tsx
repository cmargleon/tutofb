import React from 'react';
import { AlertCircle, CheckCircle2, Clock3, ListOrdered, Rows3, SquareStack } from 'lucide-react';
import { Alert, EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui';
import { RetryFailedJobsDialog } from '../components/evaluation/RetryFailedJobsDialog';
import { QueueFiltersBar } from '../components/queue/QueueFiltersBar';
import { QueueKanbanBoard } from '../components/queue/QueueKanbanBoard';
import { QueueSelectionControls } from '../components/queue/QueueSelectionControls';
import { useRole } from '../features/auth/AuthProvider';
import { useQueueActions } from '../features/queue/useQueueActions';
import { useQueueBoard } from '../features/queue/useQueueBoard';
import { useQueueSelection } from '../features/queue/useQueueSelection';
import { useSystemConfig } from '../features/system/useSystemConfig';

export const Cola: React.FC = () => {
  const role = useRole();
  const { config: systemConfig } = useSystemConfig();
  const board = useQueueBoard();
  const { loading, error, rowsById, filteredRows, rowsByStage, totals } = board;
  const selection = useQueueSelection(rowsById, filteredRows);
  const { selectedBatchIds, selectedRows } = selection;
  const actions = useQueueActions(rowsById);
  const { busyAction, actionMessage, retryDialogBatchIds, setRetryDialogBatchIds, handleRetryFailed, handleCancelPending } = actions;

  if (loading) {
    return (
      <div className="tuto-page">
        <PageHeader
          title="Cola"
          icon={ListOrdered}
          description="Monitorea los lotes activos, estima tiempos y actúa sobre la operación sin depender del último lote."
        />
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="tuto-page">
      <PageHeader
        title="Cola"
        icon={ListOrdered}
        description="Vista operativa de lotes activos con ETA, antigüedad, filtros y acciones masivas sobre la cola."
      />

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      {actionMessage ? (
        <Alert tone="success">{actionMessage}</Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Lotes visibles"
          value={filteredRows.length}
          icon={Rows3}
          tone="info"
        />
        <StatCard
          label="Trabajos en cola"
          value={totals.pending + totals.processing}
          icon={Clock3}
          tone="accent"
        />
        <StatCard
          label="Fallidos reintentables"
          value={totals.failed}
          icon={AlertCircle}
          tone="warning"
        />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <QueueFiltersBar
          clientFilter={board.clientFilter}
          providerFilter={board.providerFilter}
          statusFilter={board.statusFilter}
          clientOptions={board.clientOptions}
          providerOptions={board.providerOptions}
          onClientFilterChange={board.setClientFilter}
          onProviderFilterChange={board.setProviderFilter}
          onStatusFilterChange={board.setStatusFilter}
          onClearFilters={board.clearFilters}
        />

        <QueueSelectionControls
          filteredRowsCount={filteredRows.length}
          selectedRows={selectedRows}
          allFilteredSelected={selection.allFilteredSelected}
          canRegenerate={role.canRegenerate}
          busyAction={busyAction}
          onSelectAllFiltered={selection.handleSelectAllFiltered}
          onClearSelection={selection.clearSelection}
          onRetrySelected={() => setRetryDialogBatchIds(selectedRows.map((row) => row.id))}
          onCancelSelected={() => void handleCancelPending(selectedRows.map((row) => row.id))}
        />

        {filteredRows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No hay lotes para esa combinación"
              description="Ajusta los filtros o espera a que entren nuevos lotes a la cola."
              icon={<SquareStack className="h-6 w-6" />}
            />
          </div>
        ) : (
          <QueueKanbanBoard
            rowsByStage={rowsByStage}
            selectedBatchIds={selectedBatchIds}
            busyAction={busyAction}
            canRegenerate={role.canRegenerate}
            onToggle={selection.handleToggleBatch}
            onRetry={async (batchIds) => setRetryDialogBatchIds(batchIds)}
            onCancel={handleCancelPending}
          />
        )}

        {filteredRows.length > 0 ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Abrir un lote desde aquí envía `clientId` y `batchId` al catálogo. La columna “Resultados” agrupa lotes con salidas o fallos ya visibles.
          </div>
        ) : null}

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
      </section>
    </div>
  );
};
