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

interface QueueRow {
  id: string;
  batch: Batch;
  jobs: Job[];
  etaSeconds: number | null;
  ageStartedAt: number | null;
}

const toDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return new Date(value.toMillis());
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toMillis = (value: unknown): number | null => {
  const date = toDate(value);
  return date ? date.getTime() : null;
};

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

const formatDateTime = (value: unknown) => {
  const date = toDate(value);
  if (!date) {
    return 'sin fecha';
  }

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
          label="Jobs en cola"
          value={totals.pending + totals.processing}
          icon={Clock3}
          tone="bg-indigo-50 text-indigo-600"
        />
        <SummaryCard
          label="Fallidos accionables"
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

              <button
                type="button"
                onClick={() => setSelectedBatchIds([])}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Limpiar selección
              </button>
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
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleSelectAllFiltered}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="px-4 py-3">Lote</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Cola</th>
                  <th className="px-4 py-3">ETA</th>
                  <th className="px-4 py-3">Antigüedad</th>
                  <th className="px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-slate-50/80">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.includes(row.id)}
                        onChange={() => handleToggleBatch(row.id)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{row.batch.clientNameSnapshot}</div>
                      <div className="text-slate-600">{row.batch.modelNameSnapshot}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        <span className="font-mono">{row.id.slice(0, 8)}</span> · actualizado {formatDateTime(row.batch.updatedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{PROVIDER_LABELS[row.batch.provider]}</td>
                    <td className="px-4 py-4">
                      <div className="space-y-2">
                        <StatusBadge status={row.batch.status} />
                        <div className="text-xs text-slate-500">
                          {row.batch.completedJobs} completados · {row.batch.failedJobs} fallidos
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1 text-slate-600">
                        <div>Pendientes: <strong className="text-slate-900">{row.batch.pendingJobs}</strong></div>
                        <div>Procesando: <strong className="text-slate-900">{row.batch.processingJobs}</strong></div>
                        <div>Total: <strong className="text-slate-900">{row.batch.totalJobs}</strong></div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">
                        {row.batch.pendingJobs + row.batch.processingJobs > 0 ? formatRelativeDuration(row.etaSeconds) : 'Sin cola'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.batch.processingJobs > 0 ? 'estimación sobre jobs ya completados' : 'esperando salida inicial'}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{formatElapsedSince(row.ageStartedAt)}</div>
                      <div className="mt-1 text-xs text-slate-500">creado {formatDateTime(row.batch.createdAt)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[240px] flex-col gap-2">
                        <Link
                          to={`/evaluacion?batchId=${row.id}`}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Abrir lote
                        </Link>
                        {role.canRegenerate ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleRetryFailed([row.id])}
                              disabled={busyAction !== null || row.batch.failedJobs === 0}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RefreshCw className={`h-4 w-4 ${busyAction === 'retry' ? 'animate-spin' : ''}`} />
                              Reintentar fallidos
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCancelPending([row.id])}
                              disabled={busyAction !== null || row.batch.pendingJobs === 0}
                              className="rounded-xl bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar pendientes
                            </button>
                          </>
                        ) : (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            Tu rol puede monitorear la cola y abrir lotes, pero no ejecutar acciones masivas.
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredRows.length > 0 ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Abrir un lote desde aquí siempre envía `batchId` explícito a Evaluación, así que ya no dependemos del “último mío”.
          </div>
        ) : null}
      </section>
    </div>
  );
};
