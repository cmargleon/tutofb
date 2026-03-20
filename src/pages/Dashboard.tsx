import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle2, Package, LayoutList, Users, UserSquare2 } from 'lucide-react';
import { AnalyticsSummary, Batch, Job } from '../../shared/src/types';
import { EmptyState, LoadingBlock, PageHeader, StatusBadge } from '../components/ui';
import { DashboardSnapshot, subscribeToAnalyticsSummary, subscribeToDashboardData } from '../features/dashboard/firebase';

const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone: string;
}> = ({ label, value, icon: Icon, tone }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
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
  const [data, setData] = useState<DashboardSnapshot>({
    clients: [],
    models: [],
    recentBatches: [],
    recentJobs: [],
  });
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Trabajos recientes</h2>
            <p className="mt-1 text-sm text-slate-500">
              La cola se actualiza en tiempo real desde Firestore y refleja el estado actual de cada job.
            </p>
          </div>

          {data.recentJobs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Todavía no hay trabajos"
                description="Cuando generes el primer lote aparecerán aquí los últimos jobs creados."
                icon={<LayoutList className="w-6 h-6" />}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Job</th>
                    <th className="px-6 py-3">Cliente / Modelo</th>
                    <th className="px-6 py-3">Prenda</th>
                    <th className="px-6 py-3">Proveedor</th>
                    <th className="px-6 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentJobs.map((job) => (
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
                      <td className="px-6 py-4 text-slate-700">{job.garmentName}</td>
                      <td className="px-6 py-4 text-slate-500">{job.provider}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={job.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
                El wizard compone multiángulo, deduplica archivos y arma una prenda por regla de carpeta.
              </div>
              <div>
                <strong className="block text-slate-900">4. Encolar combinaciones</strong>
                Se crea un job por cada combinación pose-prenda respetando provider, prompt y aspect ratio.
              </div>
              <div>
                <strong className="block text-slate-900">5. Evaluar y regenerar</strong>
                Revisas resultados, mantienes la imagen previa visible mientras procesa y descargas desde Storage real.
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10">
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
    </div>
  );
};
