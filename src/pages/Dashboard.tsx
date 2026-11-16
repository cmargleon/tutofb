import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Bell, ChevronLeft, ChevronRight, History,
  LayoutDashboard, LayoutList, RefreshCcw,
} from 'lucide-react';

import type { HealthStatus, ProviderHealthCheck, SystemAlert, SystemHealthSnapshot } from '../../shared/src/types';
import { humanClientIds } from '../../shared/src/clientAccess';
import { formatDateTime as formatActivityDate } from '../../shared/src/utils/dateUtils';
import { Alert, buttonClasses, EmptyState, ImageThumb, LoadingBlock, PageHeader, StatusBadge } from '../components/ui';
import { useAuth, useRole } from '../features/auth/AuthProvider';
import { catalogBatchUrl } from '../features/dashboard/attention';
import { DashboardAttention, DashboardGeneration } from '../features/dashboard/DashboardAttention';
import { RECENT_BATCH_LIMIT, RECENT_JOB_LIMIT } from '../features/dashboard/firebase';
import { useDashboard } from '../features/dashboard/useDashboard';
import { useSystemHealth } from '../features/system/useSystemHealth';

export const Dashboard: React.FC = () => {
  const { user, appUser } = useAuth();
  const role = useRole();
  if (!user || !appUser || !role.canEvaluate) return null;
  const clientIds = humanClientIds(appUser);
  if (clientIds?.length === 0) {
    return (
      <div className="tuto-page">
        <PageHeader title="Inicio" icon={LayoutDashboard} />
        <Alert tone="info" title="Sin clientes asignados">Los indicadores y la actividad estarán disponibles cuando tengas acceso a un cliente.</Alert>
      </div>
    );
  }
  const clientScope = JSON.stringify(clientIds?.sort() ?? null);
  return <DashboardContent key={JSON.stringify([user.uid, appUser.role, clientScope])} clientScope={clientScope} />;
};

const DashboardContent = ({ clientScope }: { clientScope: string }) => {
  const role = useRole();
  const dashboard = useDashboard(clientScope);
  const systemHealth = useSystemHealth(role.canAccessAnalytics);
  const [jobsPage, setJobsPage] = useState(1);
  const { recentJobs, recentBatches } = dashboard;
  const jobs = recentJobs.status === 'ready' ? recentJobs.data : [];
  const batches = recentBatches.status === 'ready' ? recentBatches.data : [];

  return (
    <div className="tuto-page">
      <PageHeader title="Inicio" icon={LayoutDashboard}
        description={dashboard.asOf ? `Consulta iniciada el ${formatActivityDate(dashboard.asOf)}` : 'Revisión, incidencias y exportación de tus clientes.'}
        actions={<button type="button" className={buttonClasses('secondary')} disabled={dashboard.exports.status === 'loading'} onClick={() => {
          setJobsPage(1);
          dashboard.refresh();
        }}><RefreshCcw className="h-4 w-4" /> Actualizar Inicio</button>}
      />
      <DashboardAttention attention={dashboard.attention} exports={dashboard.exports} canRegenerate={role.canRegenerate} />
      <DashboardGeneration counts={dashboard.counts} />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Trabajos recientes</h2>
              <p className="mt-1 text-sm text-slate-500">
                Hasta {RECENT_JOB_LIMIT} trabajos, ordenados por fecha de creación.
              </p>
            </div>
          </div>
        </div>

        {recentJobs.status !== 'ready' ? <ActivityState status={recentJobs.status} /> : jobs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Todavía no hay trabajos"
              description="Cuando generes el primer lote aparecerán aquí los últimos trabajos creados."
              icon={<LayoutList className="w-6 h-6" />}
            />
          </div>
        ) : (() => {
          const totalJobPages = Math.ceil(jobs.length / JOBS_PAGE_SIZE);
          const pagedJobs = jobs.slice((jobsPage - 1) * JOBS_PAGE_SIZE, jobsPage * JOBS_PAGE_SIZE);
          return (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-6 py-3">Trabajo</th>
                      <th className="px-6 py-3">Cliente / Modelo</th>
                      <th className="px-6 py-3">Prenda</th>
                      <th className="px-6 py-3">Proveedor</th>
                      <th className="px-6 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedJobs.map((job) => (
                      <tr key={job.id} className="hover:bg-slate-50/80">
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">
                          <Link to={catalogBatchUrl(job.clientId, job.batchId)} className="text-slate-900 hover:underline">
                            {job.id?.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900">{job.clientNameSnapshot}</div>
                          <div className="text-slate-500">{job.modelNameSnapshot}</div>
                        </td>
                        <td className="px-6 py-4">
                          <GarmentThumb path={job.garmentFilePath} />
                        </td>
                        <td className="px-6 py-4 text-slate-500">{job.provider}</td>
                        <td className="px-6 py-4">
                          <StatusBadge status={job.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalJobPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
                  <button
                    onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                    disabled={jobsPage === 1}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <span className="text-sm text-slate-500">
                    Página {jobsPage} de {totalJobPages}
                  </span>
                  <button
                    onClick={() => setJobsPage((p) => Math.min(totalJobPages, p + 1))}
                    disabled={jobsPage === totalJobPages}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-500" />
            Actividad reciente del equipo
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Hasta {RECENT_BATCH_LIMIT} lotes, ordenados por fecha de creación.</p>
        </div>
        {recentBatches.status !== 'ready' ? <ActivityState status={recentBatches.status} /> : batches.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">Aún no hay actividad registrada.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {batches.map((batch) => (
              <li key={batch.id}>
                <Link
                  to={catalogBatchUrl(batch.clientId, batch.id!)}
                  className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {batch.clientNameSnapshot} / {batch.modelNameSnapshot}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {batch.createdByDisplayName || 'Desconocido'} · {formatActivityDate(batch.createdAt)} · {batch.totalJobs} trabajo{batch.totalJobs === 1 ? '' : 's'}
                    </p>
                  </div>
                  <StatusBadge status={batch.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {role.canAccessAnalytics && (
        <SystemHealthPanel data={systemHealth.data} loading={systemHealth.loading} error={systemHealth.error} onRefresh={systemHealth.refresh} />
      )}
    </div>
  );
};

const JOBS_PAGE_SIZE = 10;

const GarmentThumb: React.FC<{ path: string | null | undefined }> = ({ path }) => {
  if (!path) return <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />;
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-100">
      <ImageThumb storagePath={path} alt="" fit="contain" />
    </div>
  );
};


const ActivityState = ({ status }: { status: 'loading' | 'error' | 'unavailable' }) => (
  <div className="p-5">
    {status === 'loading' ? <LoadingBlock message="Cargando actividad" /> : (
      <Alert tone={status === 'error' ? 'danger' : 'info'}>
        {status === 'error' ? 'No se pudo consultar la actividad.' : 'Actividad no disponible.'}
      </Alert>
    )}
  </div>
);

const HEALTH_STYLES: Record<HealthStatus, { pill: string; panel: string; dot: string; label: string }> = {
  healthy: {
    pill: 'bg-emerald-100 text-emerald-700',
    panel: 'border-emerald-200 bg-emerald-50/60',
    dot: 'bg-emerald-500',
    label: 'Saludable',
  },
  degraded: {
    pill: 'bg-amber-100 text-amber-700',
    panel: 'border-amber-200 bg-amber-50/70',
    dot: 'bg-amber-500',
    label: 'Degradado',
  },
  down: {
    pill: 'bg-rose-100 text-rose-700',
    panel: 'border-rose-200 bg-rose-50/70',
    dot: 'bg-rose-500',
    label: 'Crítico',
  },
};

const ALERT_CARD_STYLES: Record<HealthStatus, string> = {
  healthy: 'border-emerald-200 bg-emerald-50',
  degraded: 'border-amber-200 bg-amber-50',
  down: 'border-rose-200 bg-rose-50',
};

const formatHealthDate = (value: unknown) => {
  if (!value) return 'sin registro';
  const date = typeof (value as { toDate?: () => Date }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string | number | Date);

  if (Number.isNaN(date.getTime())) {
    return 'sin registro';
  }

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const ProviderStatusCard: React.FC<{ provider: ProviderHealthCheck }> = ({ provider }) => {
  const styles = HEALTH_STYLES[provider.status];

  return (
    <div className={`rounded-2xl border p-4 ${styles.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
            <p className="font-medium text-slate-900">{provider.provider}</p>
          </div>
          <p className="mt-1 text-sm text-slate-600">{provider.detail}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles.pill}`}>{styles.label}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>HTTP: {provider.httpStatus ?? 'n/a'}</span>
        <span>Latencia: {provider.latencyMs != null ? `${provider.latencyMs} ms` : 'n/a'}</span>
        <span>Chequeo: {formatHealthDate(provider.checkedAt)}</span>
      </div>
    </div>
  );
};

const SystemAlertCard: React.FC<{ alert: SystemAlert }> = ({ alert }) => (
  <div className={`rounded-2xl border p-4 ${ALERT_CARD_STYLES[alert.status]}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
        <p className="mt-1 text-sm text-slate-600">{alert.description}</p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${HEALTH_STYLES[alert.status].pill}`}>
        {HEALTH_STYLES[alert.status].label}
      </span>
    </div>
    {(alert.metricLabel || alert.thresholdValue !== null) ? (
      <div className="mt-3 text-xs text-slate-500">
        {alert.metricLabel ? `${alert.metricLabel}: ${alert.currentValue ?? 'n/a'}` : null}
        {alert.metricLabel && alert.thresholdValue !== null && alert.thresholdValue !== undefined ? ' · ' : null}
        {alert.thresholdValue !== null && alert.thresholdValue !== undefined ? `Umbral: ${alert.thresholdValue}` : null}
      </div>
    ) : null}
  </div>
);

const SystemHealthPanel: React.FC<{
  data: SystemHealthSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
}> = ({ data, loading, error, onRefresh }) => {
  const styles = data && !error ? HEALTH_STYLES[data.overallStatus] : null;

  return (
    <section className="tuto-surface p-5 sm:p-6" aria-label="Estado del sistema">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className={`rounded-lg p-2.5 ${styles?.pill || 'bg-slate-100 text-slate-500'}`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Estado del sistema</p>
              <div className="mt-1 flex items-center gap-2">
                {styles && <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />}
                <h2 className="text-lg font-semibold text-slate-900">
                  {error ? 'Error de consulta' : styles?.label ?? (loading ? 'Cargando…' : 'No disponible')}
                </h2>
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            {!error && data?.summary}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data ? (
            <p className="text-xs text-slate-500">Última lectura: {formatHealthDate(data.checkedAt)}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className={buttonClasses('secondary', 'sm')}
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" className="mt-5">{error}</Alert>
      ) : null}

      {loading && !data ? (
        <LoadingBlock />
      ) : data && !error ? (
        <div className="mt-6 space-y-6">
          <div className="border-t border-slate-100 pt-5">
            <h3 className="tuto-overline flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alertas compartidas
            </h3>

            {data.alerts.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.alerts.map((alert) => (
                  <SystemAlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            ) : (
              <Alert tone="success" className="mt-4">No hay alertas activas con los umbrales compartidos actuales.</Alert>
            )}
          </div>

          <div className="grid gap-3 border-t border-slate-100 pt-5 lg:grid-cols-2">
            {data.providers.map((provider) => (
              <ProviderStatusCard key={provider.provider} provider={provider} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
