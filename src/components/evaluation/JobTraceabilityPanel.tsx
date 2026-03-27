import React, { useEffect, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, ChevronDown, ChevronUp, History, RefreshCw, UserRound } from 'lucide-react';
import { Batch, Job, JobLog } from '../../../shared/src/types';
import {
  traceabilityErrorMessage,
  traceabilityPayload,
  traceabilityRequestedByDisplayName,
  traceabilityRequestedByUid,
  useJobTraceability,
} from '../../features/evaluation/useJobTraceability';
import { LoadingBlock, StatusBadge } from '../ui';

import { formatDateTimeFull as formatDateTime } from '../../../shared/src/utils/dateUtils';

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value || 0);

const logTone = (log: JobLog): string => {
  if (log.level === 'error') {
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (log.level === 'warn') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  return 'border-slate-200 bg-slate-50 text-slate-700';
};

const labelForLogType = (log: JobLog): string => {
  switch (log.type) {
    case 'claim':
      return 'Worker tomó el job';
    case 'provider_request':
      return 'Solicitud al proveedor';
    case 'provider_response':
      return 'Respuesta del proveedor';
    case 'quality_review':
      return 'Autoevaluación Gemini';
    case 'retry_scheduled':
      return 'Reintento programado';
    case 'completed':
      return 'Resultado guardado';
    case 'failed':
      return 'Job fallido';
    case 'cleanup':
      return 'Limpieza de salida previa';
    case 'system':
    default:
      return 'Evento del sistema';
  }
};

const compactValue = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number') {
    return `${value}`;
  }

  return null;
};

const summarizePayload = (log: JobLog): string[] => {
  const payload = traceabilityPayload(log.payload);
  if (!payload) {
    return [];
  }

  const items = [
    payload.provider ? `Proveedor: ${compactValue(payload.provider)}` : null,
    payload.requestId ? `Request: ${compactValue(payload.requestId)}` : null,
    payload.model ? `Modelo: ${compactValue(payload.model)}` : null,
    payload.verdict ? `Veredicto: ${compactValue(payload.verdict)}` : null,
    payload.attemptNumber !== undefined ? `Intento: ${compactValue(payload.attemptNumber)}` : null,
    payload.retryCount !== undefined ? `Reintentos: ${compactValue(payload.retryCount)}` : null,
    payload.maxRetries !== undefined ? `Tope: ${compactValue(payload.maxRetries)}` : null,
    payload.costUsd !== undefined && typeof payload.costUsd === 'number'
      ? `Costo: ${formatCurrency(payload.costUsd)}`
      : null,
    payload.durationSeconds !== undefined ? `Duración: ${compactValue(payload.durationSeconds)} s` : null,
  ];

  const errorMessage = traceabilityErrorMessage(log);
  if (errorMessage) {
    items.push(`Error: ${errorMessage}`);
  }

  return items.filter((item): item is string => Boolean(item));
};

interface Props {
  batch: Batch;
  job: Job;
}

export const JobTraceabilityPanel: React.FC<Props> = ({ batch, job }) => {
  const { logs, loading } = useJobTraceability(job.id || null);
  const [traceabilityCollapsed, setTraceabilityCollapsed] = useState(true);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);

  useEffect(() => {
    setTraceabilityCollapsed(true);
    setHistoryCollapsed(true);
  }, [job.id]);

  const creatorLabel = batch.createdByDisplayName || job.traceability?.batchCreatedByDisplayName || batch.createdByUid || 'Sin dato';

  const regenerationLog = logs.find((log) => {
    if (log.type !== 'system') {
      return false;
    }

    const payload = traceabilityPayload(log.payload);
    return Boolean(payload && typeof payload.requestedByUid === 'string' && log.message.toLowerCase().includes('regeneración'));
  });

  const latestProviderErrorLog = logs.find((log) => log.type === 'retry_scheduled' || log.type === 'failed');
  const latestQualityReviewLog = logs.find((log) => log.type === 'quality_review');
  const latestQualityReviewPayload = latestQualityReviewLog ? traceabilityPayload(latestQualityReviewLog.payload) : null;

  const latestProviderErrorMessage =
    job.traceability?.lastProviderErrorMessage || traceabilityErrorMessage(latestProviderErrorLog);

  const latestProviderErrorAt = job.traceability?.lastProviderErrorAt || latestProviderErrorLog?.createdAt;
  const latestQualityReview = job.latestAutoReview;
  const latestQualityReviewSummary =
    latestQualityReview?.summary
    || (latestQualityReviewPayload && typeof latestQualityReviewPayload.summary === 'string'
      ? latestQualityReviewPayload.summary
      : null)
    || 'Todavía no hay una autoevaluación registrada.';
  const latestQualityReviewAt = latestQualityReview?.reviewedAt || latestQualityReviewLog?.createdAt;

  const latestRegenerationAt = job.traceability?.lastManualRegenerationAt || regenerationLog?.createdAt;
  const latestRegenerationByUid =
    job.traceability?.lastManualRegeneratedByUid || (regenerationLog ? traceabilityRequestedByUid(regenerationLog) : null);
  const latestRegenerationByDisplayName =
    job.traceability?.lastManualRegeneratedByDisplayName
    || (regenerationLog ? traceabilityRequestedByDisplayName(regenerationLog) : null);
  const latestRegenerationBy = latestRegenerationByUid
    ? latestRegenerationByDisplayName || latestRegenerationByUid
    : 'Sin regeneraciones';

  const providerErrorCount = logs.filter((log) => log.type === 'retry_scheduled' || log.type === 'failed').length;

  return (
    <aside className="w-full rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Trazabilidad visible</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{job.garmentName}</h3>
          <p className="mt-1 text-sm text-slate-500">
            Pose {job.poseFileName || job.poseImageId} · {job.id?.slice(0, 8)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setTraceabilityCollapsed((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={!traceabilityCollapsed}
          aria-controls="job-traceability-summary"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Trazabilidad del job</p>
            <p className="text-xs text-slate-500">Resumen de creación, reintentos, errores, regeneraciones y costo.</p>
          </div>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500">
            {traceabilityCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </span>
        </button>

        {!traceabilityCollapsed ? (
          <div id="job-traceability-summary" className="mt-4 grid gap-3">
            <SummaryCard
              icon={<UserRound className="h-4 w-4" />}
              label="Quién creó el lote"
              value={creatorLabel}
              detail={`Creado el ${formatDateTime(batch.createdAt)}`}
            />
            <SummaryCard
              icon={<RefreshCw className="h-4 w-4" />}
              label="Reintentos y regeneraciones"
              value={`${job.retryCount} / ${job.maxRetries} reintentos automáticos`}
              detail={`Regeneraciones manuales: ${job.manualRegenerationCount || 0}`}
            />
            <SummaryCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Errores del provider"
              value={latestProviderErrorMessage || 'Sin errores registrados'}
              detail={
                latestProviderErrorAt
                  ? `${providerErrorCount} incidentes · último ${formatDateTime(latestProviderErrorAt)}`
                  : 'Sin incidentes de proveedor'
              }
              tone={latestProviderErrorMessage ? 'warning' : 'neutral'}
            />
            <SummaryCard
              icon={<History className="h-4 w-4" />}
              label="Autoevaluación Gemini"
              value={
                latestQualityReview
                  ? latestQualityReview.verdict === 'approved'
                    ? 'Aprobada'
                    : 'Rechazada'
                  : 'Sin autoevaluación'
              }
              detail={
                latestQualityReviewAt
                  ? `${latestQualityReviewSummary} · ${formatDateTime(latestQualityReviewAt)}`
                  : latestQualityReviewSummary
              }
              tone={latestQualityReview?.verdict === 'rejected' ? 'warning' : 'neutral'}
            />
            <SummaryCard
              icon={<History className="h-4 w-4" />}
              label="Última regeneración"
              value={latestRegenerationAt ? formatDateTime(latestRegenerationAt) : 'Sin regeneraciones'}
              detail={latestRegenerationAt ? `Solicitada por ${latestRegenerationBy}` : latestRegenerationBy}
            />
            <SummaryCard
              icon={<BadgeDollarSign className="h-4 w-4" />}
              label="Costo acumulado"
              value={formatCurrency(job.totalCostUsd || 0)}
              detail={`${job.completedOutputCount || 0} salidas completadas · ${Math.round(job.totalDurationSeconds || 0)} s totales`}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setHistoryCollapsed((current) => !current)}
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={!historyCollapsed}
          aria-controls="job-history-panel"
        >
          <div>
            <p className="text-sm font-semibold text-slate-900">Historial del job</p>
            <p className="text-xs text-slate-500">Timeline operativo con logs reales de Firebase.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {logs.length} eventos
            </span>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500">
              {historyCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </span>
          </div>
        </button>

        {!historyCollapsed ? (
          <div id="job-history-panel">
            {loading ? (
              <div className="py-6">
                <LoadingBlock message="Cargando historial del job..." />
              </div>
            ) : logs.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Este job todavía no tiene eventos en la subcolección `logs`.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {logs.map((log) => {
                  const actorUid = traceabilityRequestedByUid(log);
                  const actorName = traceabilityRequestedByDisplayName(log) || actorUid;
                  const payloadDetails = summarizePayload(log);

                  return (
                    <div key={log.id} className={`rounded-2xl border px-4 py-3 ${logTone(log)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{labelForLogType(log)}</p>
                          <p className="mt-1 text-sm">{log.message}</p>
                        </div>
                        <span className="whitespace-nowrap text-xs font-medium">{formatDateTime(log.createdAt)}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {actorName ? (
                          <span className="rounded-full bg-white/70 px-2.5 py-1">Usuario: {actorName}</span>
                        ) : null}
                        {payloadDetails.map((detail) => (
                          <span key={`${log.id}-${detail}`} className="rounded-full bg-white/70 px-2.5 py-1">
                            {detail}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
};

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'warning';
}> = ({ icon, label, value, detail, tone = 'neutral' }) => (
  <div
    className={`rounded-2xl border px-4 py-3 ${
      tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
    }`}
  >
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
      {icon}
      {label}
    </div>
    <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    <p className="mt-1 text-xs text-slate-600">{detail}</p>
  </div>
);
