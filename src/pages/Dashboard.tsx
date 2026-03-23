import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Package,
  LayoutList,
  RefreshCcw,
  Users,
  UserSquare2,
  History,
} from 'lucide-react';

const formatActivityDate = (ts: any) => {
  if (!ts) return '';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
import { AnalyticsSummary, HealthStatus, ProviderHealthCheck, SystemAlert, SystemHealthSnapshot } from '../../shared/src/types';
import { EmptyState, ImageThumb, LoadingBlock, PageHeader, StatusBadge } from '../components/ui';
import { DashboardSnapshot, subscribeToAnalyticsSummary, subscribeToDashboardData } from '../features/dashboard/firebase';
import { useRole } from '../features/auth/AuthProvider';
import { useSystemHealth } from '../features/system/useSystemHealth';

const JOBS_PAGE_SIZE = 10;

const GarmentThumb: React.FC<{ path: string | null | undefined }> = ({ path }) => {
  if (!path) return <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />;
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-100">
      <ImageThumb storagePath={path} alt="" fit="contain" />
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone: string;
}> = ({ label, value, icon: Icon, tone }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between">
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

export const Dashboard: React.FC = () => {
  const role = useRole();
  const [data, setData] = useState<DashboardSnapshot>({
    clients: [],
    models: [],
    recentBatches: [],
    recentJobs: [],
  });
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobsPage, setJobsPage] = useState(1);
  const {
    data: systemHealth,
    loading: systemHealthLoading,
    error: systemHealthError,
    refresh: refreshSystemHealth,
  } = useSystemHealth(role.canAccessAnalytics);

  useEffect(() => {
    const unsubscribeDashboard = subscribeToDashboardData(
      (snapshot) => {
        setData(snapshot);
        setLoading(false);
      },
      (loadError) => {
        console.error(loadError);
        setError('No se pudo cargar el panel operativo.');
        setLoading(false);
      },
    );

    const unsubscribeSummary = subscribeToAnalyticsSummary(
      (nextSummary) => setSummary(nextSummary),
      (loadError) => {
        console.error(loadError);
      },
    );

    return () => {
      unsubscribeDashboard();
      unsubscribeSummary();
    };
  }, []);

  const garmentCount = useMemo(
    () => new Set(data.recentJobs.map((job) => `${job.garmentFilePath}::${job.garmentName}`)).size,
    [data.recentJobs],
  );

  const processingJobs = useMemo(
    () => data.recentJobs.filter((job) => job.status === 'processing' || job.status === 'pending').length,
    [data.recentJobs],
  );

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Panel"
          description="Sigue clientes, biblioteca de modelos, cola operativa y trabajos recientes."
        />
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <PageHeader
        title="Panel"
        description="Vista operativa del catálogo: volumen de preparación, cola activa y últimos trabajos procesados."
      />

      <div className="flex justify-end">
        <Link
          to="/cola"
          className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Abrir cola operativa
        </Link>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes" value={data.clients.length} icon={Users} tone="bg-sky-50 text-sky-600" />
        <StatCard label="Modelos" value={data.models.length} icon={UserSquare2} tone="bg-emerald-50 text-emerald-600" />
        <StatCard label="Prendas en lotes" value={garmentCount} icon={Package} tone="bg-amber-50 text-amber-600" />
        <StatCard
          label="Trabajos completados"
          value={summary?.completedJobs || 0}
          icon={CheckCircle2}
          tone="bg-violet-50 text-violet-600"
        />
      </div>

      {role.canAccessAnalytics ? (
        <SystemHealthPanel
          data={systemHealth}
          loading={systemHealthLoading}
          error={systemHealthError}
          onRefresh={refreshSystemHealth}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Trabajos recientes</h2>
                <p className="mt-1 text-sm text-slate-500">
                  El panel sigue siendo resumen; la operación detallada ahora vive en la vista de cola.
                </p>
              </div>
              <Link
                to="/cola"
                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Ver cola
              </Link>
            </div>
          </div>

          {data.recentJobs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Todavía no hay trabajos"
                description="Cuando generes el primer lote aparecerán aquí los últimos trabajos creados."
                icon={<LayoutList className="w-6 h-6" />}
              />
            </div>
          ) : (() => {
            const totalJobPages = Math.ceil(data.recentJobs.length / JOBS_PAGE_SIZE);
            const pagedJobs = data.recentJobs.slice((jobsPage - 1) * JOBS_PAGE_SIZE, jobsPage * JOBS_PAGE_SIZE);
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
                            <Link to={`/evaluacion?batchId=${job.batchId}`} className="text-slate-900 hover:underline">
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

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Flujo operativo</h2>
            <div className="mt-5 space-y-4 text-sm text-slate-600">
              <div>
                <strong className="block text-slate-900">1. Registrar clientes</strong>
                Define la cuenta o marca a la que quedarán asociadas las imágenes y sus regeneraciones.
              </div>
              <div>
                <strong className="block text-slate-900">2. Preparar modelos</strong>
                Crea la biblioteca de modelos y sube varias poses reutilizables.
              </div>
              <div>
                <strong className="block text-slate-900">3. Subir prendas</strong>
                Sube archivos sueltos o en carpeta para componer las prendas automáticamente.
              </div>
              <div>
                <strong className="block text-slate-900">4. Encolar combinaciones</strong>
                Se genera una imagen por cada combinación de pose y prenda, según el proveedor y formato elegidos.
              </div>
              <div>
                <strong className="block text-slate-900">5. Evaluar y regenerar</strong>
                Revisas resultados, mantienes la imagen anterior visible mientras procesa y descargas las imágenes finales.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white/10 p-3">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-300">Cola actual</p>
                <p className="text-2xl font-semibold">{processingJobs}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-300">
              <div className="rounded-2xl bg-white/5 px-4 py-3">
                Pendientes: <strong>{summary?.pendingJobs || 0}</strong>
              </div>
              <div className="rounded-2xl bg-white/5 px-4 py-3">
                Procesando: <strong>{summary?.processingJobs || 0}</strong>
              </div>
              <div className="rounded-2xl bg-white/5 px-4 py-3">
                Lotes recientes: <strong>{data.recentBatches.length}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-500" />
            Actividad reciente del equipo
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Últimos lotes creados por los operadores</p>
        </div>
        {data.recentBatches.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-400">Aún no hay actividad registrada.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentBatches.map((batch) => (
              <li key={batch.id}>
                <Link
                  to={`/evaluacion?batchId=${batch.id}`}
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
    </div>
  );
};

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

const formatUsd = (value: unknown) => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return amount.toFixed(2);
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
        <span>Latencia: {provider.latencyMs ? `${provider.latencyMs} ms` : 'n/a'}</span>
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
  const overallStatus = data?.overallStatus || 'degraded';
  const styles = HEALTH_STYLES[overallStatus];
  const recentErrorRateThreshold = data?.settings?.recentErrorRateThreshold ?? 10;
  const pendingJobsThreshold = data?.settings?.pendingJobsThreshold ?? 25;

  return (
    <section className={`rounded-2xl border p-6 shadow-sm ${styles.panel}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className={`rounded-2xl p-3 ${styles.pill}`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Estado del sistema</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                <h2 className="text-xl font-semibold text-slate-900">{styles.label}</h2>
              </div>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            {data?.summary || 'Cargando verificación de APIs, cola y tasa reciente de errores.'}
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
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <LoadingBlock />
      ) : data ? (
        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                  <Bell className="h-4 w-4" />
                  Alertas compartidas
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Umbrales vigentes para todo el equipo. Costo del día: <strong className="text-slate-900">${formatUsd(data.todayCostUsd)}</strong>
                </p>
              </div>
              <div className="text-xs text-slate-500">
                Error {recentErrorRateThreshold}% · Pendientes {pendingJobsThreshold}
              </div>
            </div>

            {data.alerts.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.alerts.map((alert) => (
                  <SystemAlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                No hay alertas activas con los umbrales compartidos actuales.
              </div>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-4">
            {data.providers.map((provider) => (
              <ProviderStatusCard key={provider.provider} provider={provider} />
            ))}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Cola y errores</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <QueueMetricCard label="Pendientes" value={data.queue.pendingJobs} tone="bg-sky-50 text-sky-700" />
                <QueueMetricCard label="Procesando" value={data.queue.processingJobs} tone="bg-indigo-50 text-indigo-700" />
                <QueueMetricCard
                  label="Atascados"
                  value={data.queue.staleProcessingJobs}
                  tone={data.queue.staleProcessingJobs > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}
                />
                <QueueMetricCard
                  label={`Error ${data.queue.windowHours}h`}
                  value={`${data.queue.recentErrorRate}%`}
                  tone={data.queue.recentErrorRate >= recentErrorRateThreshold ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}
                />
              </div>

              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Completados recientes
                  </span>
                  <strong className="text-slate-900">{data.queue.recentCompletedJobs}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    Fallidos recientes
                  </span>
                  <strong className="text-slate-900">{data.queue.recentFailedJobs}</strong>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-slate-500" />
                    Trabajos evaluados en el período
                  </span>
                  <strong className="text-slate-900">{data.queue.recentTerminalJobs}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

const QueueMetricCard: React.FC<{ label: string; value: string | number; tone: string }> = ({ label, value, tone }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</div>
    <p className="mt-3 text-2xl font-semibold text-slate-900">{value}</p>
  </div>
);
