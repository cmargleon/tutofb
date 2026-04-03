import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, Filter, RefreshCw, Rows3, SquareStack } from 'lucide-react';
import { EmptyState, LoadingBlock, PageHeader, StatusBadge } from '../components/ui';
import { useQueueData } from '../features/queue/firebase';
import { cancelPendingBatchJobs, regenerateFailedBatchJobs } from '../features/evaluation/firebase';
import { useRole } from '../features/auth/AuthProvider';
import { useConfirm, useToast } from '../features/feedback/FeedbackProvider';
import { PROVIDER_LABELS } from '../../shared/src/domain';
import { Batch, Job, Provider } from '../../shared/src/types';
import { formatDateTime, toMillis } from '../../shared/src/utils/dateUtils';

interface QueueRow {
  id: string;
  batch: Batch;
  jobs: Job[];
  etaSeconds: number | null;
  ageStartedAt: number | null;
}

type KanbanStage = 'pending' | 'processing' | 'ready';

const average = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const formatRelativeDuration = (seconds: number | null) => {
  if (seconds === null || Number.isNaN(seconds)) {
    return 'n/d';
  }

  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))} s`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
};

const formatElapsedSince = (millis: number | null) => {
  if (millis === null) {
    return 'n/d';
  }

  return formatRelativeDuration((Date.now() - millis) / 1000);
};

const getCompletedJobDuration = (job: Job) => {
  if (job.status !== 'completed') {
    return null;
  }

  const duration = job.currentOutput?.durationSeconds ?? job.totalDurationSeconds ?? null;
  return duration && duration > 0 ? duration : null;
};

const SummaryCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone: string;
}> = ({ label, value, icon: Icon, tone }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      </div>
      <div className={`rounded-2xl p-3 ${tone}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  </div>
);

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

const getKanbanStage = (row: QueueRow): KanbanStage => {
  if (row.batch.processingJobs > 0 || row.batch.status === 'processing') {
    return 'processing';
  }

  if (
    row.batch.completedJobs > 0 ||
    row.batch.failedJobs > 0 ||
    row.batch.status === 'partial_failed' ||
    row.batch.status === 'failed'
  ) {
    return 'ready';
  }

  return 'pending';
};

const BatchCard: React.FC<{
  row: QueueRow;
  selected: boolean;
  busyAction: 'retry' | 'cancel' | null;
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
            disabled={busyAction !== null || row.batch.pendingJobs === 0}
            className="rounded-xl bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar pendientes
          </button>
        </>
      ) : null}
    </div>
  </article>
);

export const Cola: React.FC = () => {
  const role = useRole();
  const toast = useToast();
  const confirm = useConfirm();
  const { batches, jobsByBatch, loading, error } = useQueueData();
  const [clientFilter, setClientFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState<'all' | Provider>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Batch['status']>('all');
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<'retry' | 'cancel' | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const rows = useMemo<QueueRow[]>(() => {
    const fallbackAverageSeconds = average(
      Object.values(jobsByBatch)
        .flat()
        .map(getCompletedJobDuration)
        .filter((value): value is number => value !== null),
    );

    return batches.map((batch) => {
      const jobs = batch.id ? jobsByBatch[batch.id] || [] : [];
      const batchAverageSeconds = average(
        jobs.map(getCompletedJobDuration).filter((value): value is number => value !== null),
      ) ?? fallbackAverageSeconds;
      const queuedJobs = batch.pendingJobs + batch.processingJobs;
      const parallelSlots = Math.max(batch.processingJobs, 1);
      const etaSeconds = queuedJobs > 0 && batchAverageSeconds
        ? Math.ceil((queuedJobs * batchAverageSeconds) / parallelSlots)
        : null;
      const oldestQueuedJob = jobs
        .filter((job) => job.status === 'pending' || job.status === 'processing')
        .reduce((oldest: number | null, job) => {
          const createdAt = toMillis(job.createdAt);
          if (createdAt === null) {
            return oldest;
          }

          if (oldest === null || createdAt < oldest) {
            return createdAt;
          }

          return oldest;
        }, null);

      return {
        id: batch.id!,
        batch,
        jobs,
        etaSeconds,
        ageStartedAt: oldestQueuedJob ?? toMillis(batch.createdAt),
      };
    });
  }, [batches, jobsByBatch]);

  const rowsById = useMemo<Record<string, QueueRow>>(
    () => Object.fromEntries(rows.map((row) => [row.id, row])),
    [rows],
  );

  useEffect(() => {
    setSelectedBatchIds((current) => current.filter((batchId) => rowsById[batchId]));
  }, [rowsById]);

  const clientOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.batch.clientNameSnapshot) as string[])).sort((left, right) => left.localeCompare(right)),
    [rows],
  );

  const providerOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.batch.provider) as Provider[])),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (clientFilter !== 'all' && row.batch.clientNameSnapshot !== clientFilter) {
          return false;
        }

        if (providerFilter !== 'all' && row.batch.provider !== providerFilter) {
          return false;
        }

        if (statusFilter !== 'all' && row.batch.status !== statusFilter) {
          return false;
        }

        return true;
      }),
    [clientFilter, providerFilter, rows, statusFilter],
  );

  const rowsByStage = useMemo<Record<KanbanStage, QueueRow[]>>(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc[getKanbanStage(row)].push(row);
          return acc;
        },
        { pending: [], processing: [], ready: [] } as Record<KanbanStage, QueueRow[]>,
      ),
    [filteredRows],
  );

  const selectedRows = useMemo(
    () => selectedBatchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row)),
    [rowsById, selectedBatchIds],
  );

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedBatchIds.includes(row.id));

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.pending += row.batch.pendingJobs;
        acc.processing += row.batch.processingJobs;
        acc.failed += row.batch.failedJobs;
        return acc;
      },
      { pending: 0, processing: 0, failed: 0 },
    );
  }, [filteredRows]);

  const handleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredRows.map((row) => row.id));
      setSelectedBatchIds((current) => current.filter((batchId) => !filteredIds.has(batchId)));
      return;
    }

    setSelectedBatchIds((current) => Array.from(new Set([...current, ...filteredRows.map((row) => row.id)])));
  };

  const handleToggleBatch = (batchId: string) => {
    setSelectedBatchIds((current) =>
      current.includes(batchId) ? current.filter((value) => value !== batchId) : [...current, batchId],
    );
  };

  const handleRetryFailed = async (batchIds: string[]) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && row.batch.failedJobs > 0);
    if (eligibleRows.length === 0) {
      setActionMessage('No había jobs fallidos en los lotes seleccionados.');
      return;
    }

    setBusyAction('retry');
    setActionMessage(null);

    try {
      const results = await Promise.all(eligibleRows.map((row) => regenerateFailedBatchJobs(row.id)));
      const queuedJobs = results.reduce((sum, result) => sum + result.queuedJobs, 0);
      const skippedJobs = results.reduce((sum, result) => sum + result.skippedJobs, 0);

      if (queuedJobs === 0) {
        setActionMessage('No había jobs fallidos listos para reencolar.');
      } else if (skippedJobs > 0) {
        setActionMessage(
          `Se reencolaron ${queuedJobs} jobs fallidos en ${eligibleRows.length} lotes. ${skippedJobs} se omitieron por datos inválidos.`,
        );
      } else {
        setActionMessage(`Se reencolaron ${queuedJobs} jobs fallidos en ${eligibleRows.length} lotes.`);
      }
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos reencolar los jobs fallidos',
        description: error?.message || 'Vuelve a intentarlo cuando la cola esté disponible.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelPending = async (batchIds: string[]) => {
    const eligibleRows = batchIds.map((batchId) => rowsById[batchId]).filter((row): row is QueueRow => Boolean(row) && row.batch.pendingJobs > 0);
    if (eligibleRows.length === 0) {
      setActionMessage('No había jobs pendientes para cancelar en los lotes seleccionados.');
      return;
    }

    const pendingJobs = eligibleRows.reduce((sum, row) => sum + row.batch.pendingJobs, 0);
    const accepted = await confirm({
      title: 'Cancelar jobs pendientes',
      description: `Vas a detener ${pendingJobs} jobs pendientes distribuidos en ${eligibleRows.length} lote${eligibleRows.length === 1 ? '' : 's'}.`,
      impact: 'La cola dejará de procesarlos y tendrás que reencolarlos manualmente si siguen siendo necesarios para la operación.',
      confirmLabel: 'Sí, cancelar pendientes',
      cancelLabel: 'Mantener cola',
      tone: 'warning',
    });

    if (!accepted) {
      return;
    }

    setBusyAction('cancel');
    setActionMessage(null);

    try {
      const results = await Promise.all(eligibleRows.map((row) => cancelPendingBatchJobs(row.id)));
      const cancelledJobs = results.reduce((sum, result) => sum + result.cancelledJobs, 0);

      if (cancelledJobs === 0) {
        setActionMessage('No había jobs pendientes por cancelar.');
      } else {
        setActionMessage(`Se cancelaron ${cancelledJobs} jobs pendientes en ${eligibleRows.length} lotes.`);
      }
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos cancelar los jobs pendientes',
        description: error?.message || 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Cola"
          description="Monitorea los lotes activos, estima tiempos y actúa sobre la operación sin depender del último lote."
        />
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12">
      <PageHeader
        title="Cola"
        description="Vista operativa de lotes activos con ETA, antigüedad, filtros y acciones masivas sobre la cola."
      />

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Lotes visibles"
          value={filteredRows.length}
          icon={Rows3}
          tone="bg-sky-50 text-sky-600"
        />
        <SummaryCard
          label="Trabajos en cola"
          value={totals.pending + totals.processing}
          icon={Clock3}
          tone="bg-indigo-50 text-indigo-600"
        />
        <SummaryCard
          label="Fallidos reintentables"
          value={totals.failed}
          icon={AlertCircle}
          tone="bg-amber-50 text-amber-600"
        />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Filtros</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Cola operativa en tiempo real</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              <Filter className="h-4 w-4" />
              Cliente
              <select
                value={clientFilter}
                onChange={(event) => setClientFilter(event.target.value)}
                className="bg-transparent text-slate-900 outline-none"
              >
                <option value="all">Todos</option>
                {clientOptions.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              <span className="mr-2">Proveedor</span>
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value as 'all' | Provider)}
                className="bg-transparent text-slate-900 outline-none"
              >
                <option value="all">Todos</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
              <span className="mr-2">Estado</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | Batch['status'])}
                className="bg-transparent text-slate-900 outline-none"
              >
                <option value="all">Todos</option>
                <option value="pending">Pendiente</option>
                <option value="processing">Procesando</option>
                <option value="partial_failed">Parcial fallido</option>
                <option value="failed">Fallido</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                setClientFilter('all');
                setProviderFilter('all');
                setStatusFilter('all');
              }}
              className="rounded-2xl border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSelectAllFiltered}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {allFilteredSelected ? 'Quitar visibles' : `Seleccionar ${filteredRows.length} visibles`}
          </button>

          {selectedRows.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelectedBatchIds([])}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Limpiar selección
            </button>
          ) : null}
        </div>

        {!role.canRegenerate ? (
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
              {role.canRegenerate ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRetryFailed(selectedRows.map((row) => row.id))}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${busyAction === 'retry' ? 'animate-spin' : ''}`} />
                    Reintentar fallidos
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCancelPending(selectedRows.map((row) => row.id))}
                    disabled={busyAction !== null}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancelar pendientes
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {filteredRows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No hay lotes para esa combinación"
              description="Ajusta los filtros o espera a que entren nuevos lotes a la cola."
              icon={<SquareStack className="h-6 w-6" />}
            />
          </div>
        ) : (
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
                        <BatchCard
                          key={row.id}
                          row={row}
                          selected={selectedBatchIds.includes(row.id)}
                          busyAction={busyAction}
                          canRegenerate={role.canRegenerate}
                          onToggle={handleToggleBatch}
                          onRetry={handleRetryFailed}
                          onCancel={handleCancelPending}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {filteredRows.length > 0 ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Abrir un lote desde aquí envía `clientId` y `batchId` al catálogo. La columna “Resultados” agrupa lotes con salidas o fallos ya visibles.
          </div>
        ) : null}
      </section>
    </div>
  );
};
