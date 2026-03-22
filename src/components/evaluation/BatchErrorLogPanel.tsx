import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { Job, JobLog } from '../../../shared/src/types';
import { useBatchErrorLogs } from '../../features/evaluation/useBatchErrorLogs';
import { traceabilityErrorMessage, traceabilityPayload } from '../../features/evaluation/useJobTraceability';
import { LoadingBlock, StatusBadge } from '../ui';

const VISIBLE_ITEMS = 6;

const toMillis = (value: unknown): number | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const formatDateTime = (value: unknown): string => {
  const millis = toMillis(value);
  if (millis === null) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(millis);
};

const truncate = (value: string | null, max = 180): string => {
  if (!value) {
    return 'Sin detalle adicional.';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const logLabel = (log: JobLog): string => {
  if (log.type === 'failed') {
    return 'Falló';
  }

  if (log.type === 'retry_scheduled') {
    return 'Reintento';
  }

  return 'Error';
};

const collectErrorText = (job: Job, logs: JobLog[]): string => {
  const logMessages = logs.flatMap((log) => {
    const payload = traceabilityPayload(log.payload);
    const payloadError = payload && typeof payload.error === 'object' && payload.error !== null
      ? payload.error as Record<string, unknown>
      : null;

    return [
      log.message,
      traceabilityErrorMessage(log),
      payloadError && typeof payloadError.name === 'string' ? payloadError.name : null,
    ].filter((entry): entry is string => Boolean(entry));
  });

  return [
    job.lastError,
    job.traceability?.lastProviderErrorMessage,
    ...logMessages,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(' ')
    .toLowerCase();
};

const classifyError = (job: Job, logs: JobLog[]) => {
  const text = collectErrorText(job, logs);

  if (
    text.includes('aborterror')
    || text.includes('timeout')
    || text.includes('timed out')
    || text.includes('excedió el tiempo')
    || text.includes('tiempo máximo')
    || text.includes('atascado')
  ) {
    return {
      label: 'Timeout',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  if (
    text.includes('fal.ai')
    || text.includes('openai')
    || text.includes('proveedor')
    || text.includes('request_id')
    || text.includes('no devolvió')
  ) {
    return {
      label: 'Error de provider',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }

  if (
    text.includes('descargar la imagen')
    || text.includes('storage')
    || text.includes('signed url')
  ) {
    return {
      label: 'Entrega de archivo',
      chipClassName: 'border-sky-200 bg-sky-50 text-sky-700',
    };
  }

  return {
    label: 'Error operativo',
    chipClassName: 'border-slate-200 bg-slate-100 text-slate-700',
  };
};

const latestErrorAt = (job: Job, logs: JobLog[]): unknown =>
  job.traceability?.lastProviderErrorAt || logs[0]?.createdAt || job.updatedAt;

const latestErrorMessage = (job: Job, logs: JobLog[]): string | null =>
  job.traceability?.lastProviderErrorMessage || traceabilityErrorMessage(logs[0]) || job.lastError;

interface Props {
  jobs: Job[];
  focusedJobId?: string | null;
  onFocusJob?: (jobId: string) => void;
}

export const BatchErrorLogPanel: React.FC<Props> = ({ jobs, focusedJobId = null, onFocusJob }) => {
  const { entries, jobsWithErrors, loading } = useBatchErrorLogs(jobs);
  const [showAll, setShowAll] = useState(false);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((left, right) => {
        const rightMs = toMillis(latestErrorAt(right.job, right.recentLogs)) || 0;
        const leftMs = toMillis(latestErrorAt(left.job, left.recentLogs)) || 0;
        return rightMs - leftMs;
      }),
    [entries],
  );

  const visibleEntries = showAll ? sortedEntries : sortedEntries.slice(0, VISIBLE_ITEMS);

  const summary = useMemo(() => {
    return sortedEntries.reduce(
      (acc, entry) => {
        const kind = classifyError(entry.job, entry.recentLogs).label;

        if (entry.job.status === 'failed') {
          acc.failed += 1;
        }

        if (kind === 'Timeout') {
          acc.timeout += 1;
        } else if (kind === 'Error de provider') {
          acc.provider += 1;
        } else {
          acc.other += 1;
        }

        return acc;
      },
      { failed: 0, timeout: 0, provider: 0, other: 0 },
    );
  }, [sortedEntries]);

  if (jobsWithErrors.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em]">Dashboard de errores</p>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">Jobs con fallos o incidentes recientes</h3>
          <p className="mt-1 text-sm text-slate-600">
            Revisa la causa probable, el último mensaje y abre el job exacto para ver su trazabilidad completa.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryPill label="Fallidos" value={summary.failed} />
          <SummaryPill label="Timeout" value={summary.timeout} />
          <SummaryPill label="Provider" value={summary.provider} />
          <SummaryPill label="Otros" value={summary.other} />
        </div>
      </div>

      {loading ? (
        <div className="mt-5 rounded-2xl border border-dashed border-rose-200 bg-white px-4 py-5">
          <LoadingBlock message="Cargando logs de error del lote..." />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {visibleEntries.map(({ job, recentLogs }) => {
            const kind = classifyError(job, recentLogs);
            const message = latestErrorMessage(job, recentLogs);
            const active = focusedJobId === job.id;

            return (
              <article
                key={job.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                  active ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-rose-100'
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${kind.chipClassName}`}>
                        {kind.label}
                      </span>
                      <StatusBadge status={job.status} />
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {job.garmentName}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">
                      Pose {job.poseFileName || job.poseImageId} · {job.provider}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{truncate(message)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDateTime(latestErrorAt(job, recentLogs))}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        Reintentos {job.retryCount}/{job.maxRetries}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        {recentLogs.length} log{recentLogs.length === 1 ? '' : 's'} relevantes
                      </span>
                    </div>
                  </div>

                  {job.id && onFocusJob ? (
                    <button
                      type="button"
                      onClick={() => onFocusJob(job.id!)}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                        active
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {active ? 'Job abierto' : 'Abrir job'}
                    </button>
                  ) : null}
                </div>

                {recentLogs.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Logs</p>
                    <div className="mt-3 space-y-2">
                      {recentLogs.slice(0, 3).map((log) => (
                        <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{logLabel(log)}</span>
                            <span>{formatDateTime(log.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-sm text-slate-700">
                            {truncate(traceabilityErrorMessage(log) || log.message, 160)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {sortedEntries.length > VISIBLE_ITEMS ? (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
        >
          <RefreshCw className={`h-4 w-4 ${showAll ? '' : 'rotate-0'}`} />
          {showAll ? 'Mostrar menos' : `Mostrar ${sortedEntries.length - VISIBLE_ITEMS} más`}
        </button>
      ) : null}
    </section>
  );
};

const SummaryPill: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-rose-100 bg-white px-3 py-2">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
  </div>
);
