import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import {
  Activity, CheckCircle2, XCircle, Clock, DollarSign, TrendingUp, AlertTriangle, Bell, BellOff, UserSquare2
} from 'lucide-react';
import { useAnalyticsDashboard } from '../features/analytics/useAnalyticsDashboard';
import { useExperimentAnalytics } from '../features/analytics/useExperimentAnalytics';
import { useModelGenerationLogs } from '../features/analytics/useModelGenerationLogs';
import { PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { PROVIDER_COSTS } from '../../shared/src/constants/providerCosts';
import { useSystemHealth } from '../features/system/useSystemHealth';
import { updateSystemAlertSettings as saveSystemAlertSettings } from '../features/system/firebase';
import { useRole } from '../features/auth/AuthProvider';
import { useToast } from '../features/feedback/FeedbackProvider';

const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];

const formatUsd = (value: unknown, digits: number = 2) => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return amount.toFixed(digits);
};

export const Analytics: React.FC = () => {
  const [daysBack, setDaysBack] = useState(30);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [alertForm, setAlertForm] = useState({
    dailyCostUsdThreshold: '',
    recentErrorRateThreshold: '10',
    pendingJobsThreshold: '25',
    staleProcessingJobsThreshold: '1',
  });
  const role = useRole();
  const toast = useToast();

  const { data, loading, error } = useAnalyticsDashboard(daysBack);
  const {
    data: systemHealth,
    loading: systemHealthLoading,
    error: systemHealthError,
    refresh: refreshSystemHealth,
  } = useSystemHealth(role.canAccessAnalytics);
  const { stats: modelGenStats } = useModelGenerationLogs();
  const {
    batches: experimentBatches,
    selectedBatchId,
    setSelectedBatchId,
    comparison: experimentComparison,
    loading: experimentLoading,
    error: experimentError,
  } = useExperimentAnalytics();

  useEffect(() => {
    if (!systemHealth?.settings) {
      return;
    }

    setAlertForm({
      dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
      recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
      pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
      staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
    });
  }, [systemHealth?.settings]);

  if (loading) {
    return (
      <div className="p-8">
        <PageHeader 
          title="Analytics" 
          description="Volumen de generación, costos por proveedor y actividad por cliente."
        />
        <LoadingBlock message="Cargando métricas..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <PageHeader 
          title="Analytics" 
          description="Volumen de generación, costos por proveedor y actividad por cliente."
        />
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const { summary, dailyVolume, byProvider, topClients, costByClientProvider, productivityByClientModel } = data;

  if (!summary) {
    return (
      <div className="p-8">
        <PageHeader 
          title="Analytics" 
          description="Volumen de generación, costos por proveedor y actividad por cliente."
        />
        <EmptyState 
          icon={<Activity className="w-6 h-6" />} 
          title="Sin datos aún" 
          description="No hay métricas disponibles en este momento." 
        />
      </div>
    );
  }

  const pieData = [
    { name: 'Completados', value: summary.completedJobs },
    { name: 'Fallidos', value: summary.failedJobs },
  ];

  const todayCostUsd = systemHealth?.todayCostUsd ?? (data.dailyVolume.length > 0 ? data.dailyVolume[data.dailyVolume.length - 1].costUsd : 0);
  const costAlertTriggered = Boolean(systemHealth?.alerts.some((alert) => alert.id === 'daily_cost'));
  const sharedDailyCostThreshold = systemHealth?.settings?.dailyCostUsdThreshold ?? null;

  const handleSaveAlertThreshold = async () => {
    try {
      await saveSystemAlertSettings({
        dailyCostUsdThreshold: alertForm.dailyCostUsdThreshold.trim() ? parseFloat(alertForm.dailyCostUsdThreshold) : null,
        recentErrorRateThreshold: parseFloat(alertForm.recentErrorRateThreshold),
        pendingJobsThreshold: parseInt(alertForm.pendingJobsThreshold, 10),
        staleProcessingJobsThreshold: parseInt(alertForm.staleProcessingJobsThreshold, 10),
      });
      await refreshSystemHealth();
      toast({
        tone: 'success',
        title: 'Alertas actualizadas',
        description: 'Los umbrales compartidos ya quedaron guardados para todo el equipo.',
      });
      setShowAlertSettings(false);
    } catch (saveError: any) {
      toast({
        tone: 'error',
        title: 'No pudimos guardar las alertas',
        description: saveError?.message || 'Revisa los valores e inténtalo nuevamente.',
      });
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Analytics"
          description="Volumen de generación, costos por proveedor y actividad por cliente."
        />
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDaysBack(d)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                daysBack === d
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => setShowAlertSettings((s) => !s)}
            title={sharedDailyCostThreshold !== null ? `Alerta compartida: $${sharedDailyCostThreshold}/día` : 'Configurar alertas compartidas'}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
              sharedDailyCostThreshold !== null
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {sharedDailyCostThreshold !== null ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Alert settings panel */}
      {showAlertSettings && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-900">Alertas compartidas del sistema</p>
              <p className="mt-1 text-xs text-amber-700">
                Estos umbrales se aplican para todo el equipo. {role.canManageUsers ? 'Solo admin puede cambiarlos.' : 'Estás viendo la configuración activa.'}
              </p>
            </div>
            {systemHealthLoading ? <span className="text-xs text-amber-700">Actualizando...</span> : null}
          </div>

          {systemHealthError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {systemHealthError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AlertInput
              label="Costo diario USD"
              prefix="$"
              value={alertForm.dailyCostUsdThreshold}
              onChange={(value) => setAlertForm((current) => ({ ...current, dailyCostUsdThreshold: value }))}
              disabled={!role.canManageUsers}
            />
            <AlertInput
              label="Error reciente %"
              value={alertForm.recentErrorRateThreshold}
              onChange={(value) => setAlertForm((current) => ({ ...current, recentErrorRateThreshold: value }))}
              disabled={!role.canManageUsers}
            />
            <AlertInput
              label="Pendientes"
              value={alertForm.pendingJobsThreshold}
              onChange={(value) => setAlertForm((current) => ({ ...current, pendingJobsThreshold: value }))}
              disabled={!role.canManageUsers}
            />
            <AlertInput
              label="Atascados"
              value={alertForm.staleProcessingJobsThreshold}
              onChange={(value) => setAlertForm((current) => ({ ...current, staleProcessingJobsThreshold: value }))}
              disabled={!role.canManageUsers}
            />
          </div>

          {role.canManageUsers ? (
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => void handleSaveAlertThreshold()}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  if (!systemHealth?.settings) return;
                  setAlertForm({
                    dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
                    recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
                    pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
                    staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
                  });
                  setShowAlertSettings(false);
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Cost alert banner */}
      {costAlertTriggered && systemHealth && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-800">Alerta compartida de gasto diario</p>
            <p className="mt-1 text-sm text-rose-700">
              El gasto de hoy es <strong>${formatUsd(todayCostUsd)}</strong>, superando el umbral compartido de <strong>${formatUsd(sharedDailyCostThreshold)}</strong>.
            </p>
          </div>
        </div>
      )}

      {systemHealth?.alerts.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Alertas activas</h3>
              <p className="mt-1 text-sm text-slate-600">Estado operativo compartido con los mismos umbrales para todo el equipo.</p>
            </div>
            <div className="text-xs text-slate-500">Última lectura: {systemHealth.checkedAt && new Date(systemHealth.checkedAt as any).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {systemHealth.alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-xl border px-4 py-3 ${alert.status === 'down' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${alert.status === 'down' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                    {alert.status === 'down' ? 'Crítico' : 'Degradado'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{alert.description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Warning Banner */}
      {summary.failedJobs > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-amber-800">Atención: Hay trabajos fallidos</h3>
            <p className="text-sm text-amber-700 mt-1">
              Se han detectado {summary.failedJobs} trabajos fallidos en el historial.
              {summary.pendingJobs > 0 && ` Actualmente hay ${summary.pendingJobs} trabajos pendientes o en proceso.`}
            </p>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
        <StatCard 
          title="Total trabajos" 
          value={summary.totalJobs.toLocaleString()} 
          icon={Activity} 
          color="text-blue-600" 
          bg="bg-blue-50" 
        />
        <StatCard 
          title="Completados" 
          value={summary.completedJobs.toLocaleString()} 
          icon={CheckCircle2} 
          color="text-emerald-600" 
          bg="bg-emerald-50" 
        />
        <StatCard 
          title="Tasa de éxito" 
          value={`${summary.successRate}%`} 
          icon={TrendingUp} 
          color="text-indigo-600" 
          bg="bg-indigo-50" 
        />
        <StatCard 
          title="Duración media" 
          value={`${summary.avgDurationSeconds ?? 0}s`} 
          icon={Clock} 
          color="text-purple-600" 
          bg="bg-purple-50" 
        />
        <StatCard 
          title="Costo total" 
          value={`$${formatUsd(summary.totalCostUsd)}`} 
          icon={DollarSign} 
          color="text-rose-600" 
          bg="bg-rose-50" 
        />
        <StatCard 
          title="1ra pasada" 
          value={`${summary.firstPassApprovalRatePct}%`} 
          icon={CheckCircle2} 
          color="text-emerald-700" 
          bg="bg-emerald-50" 
        />
        <StatCard 
          title="Proyección mensual" 
          value={`$${formatUsd(summary.projectedMonthlyCostUsd)}`} 
          icon={TrendingUp} 
          color="text-amber-600" 
          bg="bg-amber-50" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Daily Volume Area Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Volumen diario (últimos {daysBack} días)</h3>
          {dailyVolume.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyVolume} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="date" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="completed" name="Completados" stroke="#10B981" fillOpacity={1} fill="url(#colorCompleted)" />
                  <Area type="monotone" dataKey="failed" name="Fallidos" stroke="#EF4444" fillOpacity={1} fill="url(#colorFailed)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-400">Sin datos diarios aún.</div>
          )}
        </div>

        {/* Status Distribution Pie Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Distribución de estados</h3>
          {(summary.completedJobs > 0 || summary.failedJobs > 0) ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-400">Sin datos de estado aún.</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Provider Performance */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Rendimiento por proveedor</h3>
          {byProvider.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byProvider} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="provider" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value, name, props) => {
                      if (name === 'Completados' || name === 'Fallidos') return [value, name];
                      return [value, name];
                    }}
                    labelFormatter={(label) => `Proveedor: ${label}`}
                  />
                  <Legend />
                  <Bar dataKey="completed" name="Completados" stackId="a" fill="#10B981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="failed" name="Fallidos" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
             <div className="h-80 flex items-center justify-center text-gray-400">Sin datos de proveedores aún.</div>
          )}
        </div>

        {/* Top Clients */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Top clientes</h3>
          {topClients.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClients} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                  <XAxis type="number" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="clientNameSnapshot" type="category" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} width={100} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="completed" name="Completados" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400">Sin datos de clientes aún.</div>
          )}
        </div>
      </div>

      {/* Cost Section */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Análisis de Costos</h3>
          <div className="text-sm text-gray-500 mt-2 md:mt-0">
            Precios de referencia actuales:
            <ul className="flex gap-4 mt-1">
              {Object.entries(PROVIDER_COSTS).map(([provider, cost]) => (
                <li key={provider} className="bg-gray-50 px-2 py-1 rounded border border-gray-200">
                  <span className="font-medium text-gray-700">{provider}:</span> ${cost.toFixed(2)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Daily Cost Area Chart */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Gasto diario (últimos {daysBack} días)</h4>
            {dailyVolume.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#F43F5E" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="date" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Costo USD']}
                    />
                    <Area type="monotone" dataKey="costUsd" name="Costo USD" stroke="#F43F5E" fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">Sin datos de costos aún.</div>
            )}
          </div>

          {/* Cost by Provider & Client */}
          <div className="space-y-8">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-4">Costo por proveedor</h4>
              {byProvider.length > 0 ? (
                <div className="space-y-4">
                  {byProvider.map(provider => (
                    <div key={provider.provider}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700">{provider.provider}</span>
                        <span className="text-gray-900">${provider.totalCostUsd.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div 
                          className="bg-rose-500 h-2 rounded-full" 
                          style={{ width: `${Math.min(100, (provider.totalCostUsd / Math.max(1, summary.totalCostUsd)) * 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400">Sin datos de proveedores.</div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-4">Costo por cliente (Top 10)</h4>
              {topClients.length > 0 ? (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topClients} layout="vertical" margin={{ top: 0, right: 10, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                      <XAxis type="number" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                      <YAxis dataKey="clientNameSnapshot" type="category" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} width={100} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Costo USD']}
                      />
                      <Bar dataKey="totalCostUsd" name="Costo USD" fill="#F43F5E" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-gray-400">Sin datos de clientes.</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-gray-100 pt-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700">Historial de costos por cliente y modelo LLM</h4>
              <p className="mt-1 text-sm text-gray-500">
                Desglose acumulado usando el proveedor/modelo real guardado en cada output.
              </p>
            </div>
            <div className="text-xs text-gray-400">Top 50 combinaciones por costo</div>
          </div>

          {costByClientProvider.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Cliente</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Modelo LLM</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Imágenes</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Costo total</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Costo promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {costByClientProvider.map((entry) => {
                    const avgCost = entry.completed > 0 ? entry.totalCostUsd / entry.completed : 0;

                    return (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{entry.clientNameSnapshot}</div>
                          <div className="text-xs text-gray-400">{entry.clientId}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{entry.provider}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{entry.completed.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">${entry.totalCostUsd.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-600">${avgCost.toFixed(3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
              Sin desglose de cliente y modelo todavía.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Productividad por cliente y modelo</h3>
            <p className="mt-1 text-sm text-gray-500">
              Aprobación implícita actual = trabajos completados que quedaron como resultado final. Primera pasada = completados sin regeneración manual.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">Aprobadas 1ra pasada</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{summary.firstPassApprovedJobs.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">Tasa 1ra pasada</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{summary.firstPassApprovalRatePct}%</p>
            </div>
          </div>
        </div>

        {productivityByClientModel.length > 0 ? (
          <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Cliente / modelo</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Aprobadas</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">1ra pasada</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Tasa 1ra</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Regeneradas</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Costo/aprobada</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Duración media</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {productivityByClientModel.map((entry) => {
                  const firstPassRate = entry.completedJobs > 0
                    ? Math.round((entry.firstPassApprovedJobs / entry.completedJobs) * 100)
                    : 0;
                  const avgCostPerApproved = entry.completedJobs > 0 ? entry.totalCostUsd / entry.completedJobs : 0;
                  const avgDurationSeconds = entry.totalCompletedOutputs > 0
                    ? entry.totalDurationSeconds / entry.totalCompletedOutputs
                    : 0;

                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{entry.clientNameSnapshot}</div>
                        <div className="text-xs text-gray-500">{entry.modelNameSnapshot}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{entry.completedJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.firstPassApprovedJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${firstPassRate >= 80 ? 'bg-emerald-100 text-emerald-700' : firstPassRate >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                          {firstPassRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.regeneratedCompletedJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700">${avgCostPerApproved.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{avgDurationSeconds.toFixed(1)}s</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            Todavía no hay suficiente historial para calcular productividad por cliente y modelo.
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Experimentos A/B</h3>
            <p className="mt-1 text-sm text-gray-500">
              Comparativa de eficiencia entre modelos considerando regeneraciones, tiempo total y costo acumulado.
            </p>
          </div>

          {experimentBatches.length > 0 ? (
            <select
              value={selectedBatchId || ''}
              onChange={(event) => setSelectedBatchId(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700"
            >
              {experimentBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.clientNameSnapshot} / {batch.modelNameSnapshot} / {batch.id?.slice(0, 8)}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {experimentError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {experimentError}
          </div>
        ) : experimentLoading ? (
          <LoadingBlock />
        ) : !experimentComparison ? (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
            Todavía no hay experimentos A/B disponibles para comparar.
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl border border-gray-200 bg-slate-50 px-5 py-4">
              <p className="text-sm font-medium text-slate-900">{experimentComparison.recommendation}</p>
              <p className="mt-1 text-xs text-slate-500">
                {experimentComparison.mode === 'ab_paired' ? 'Paired' : 'Interleaved'} · {experimentComparison.comparableGroups} comparaciones · {experimentComparison.totalJobs} jobs
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {experimentComparison.arms.map((arm) => (
                <div
                  key={arm.armId}
                  className={`rounded-3xl border p-5 ${
                    experimentComparison.winningArmId === arm.armId
                      ? 'border-emerald-400 bg-emerald-900 text-white shadow-lg shadow-emerald-950/20'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4
                        className={`text-lg font-semibold ${
                          experimentComparison.winningArmId === arm.armId ? 'text-white' : 'text-gray-900'
                        }`}
                      >
                        {arm.label} · {arm.provider}
                      </h4>
                      <p
                        className={`mt-1 text-sm ${
                          experimentComparison.winningArmId === arm.armId ? 'text-emerald-100' : 'text-gray-500'
                        }`}
                      >
                        Score eficiencia: {arm.efficiencyScore.toFixed(3)}
                      </p>
                    </div>
                    {experimentComparison.winningArmId === arm.armId ? (
                      <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                        Mejor balance
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ExperimentMetric
                      label="Regeneraciones"
                      value={arm.manualRegenerationCount}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                    <ExperimentMetric
                      label="Tasa regen."
                      value={`${arm.regenerationRatePct}%`}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                    <ExperimentMetric
                      label="Costo total"
                      value={`$${arm.totalCostUsd.toFixed(2)}`}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                    <ExperimentMetric
                      label="Costo/job"
                      value={`$${arm.avgCostPerJobUsd.toFixed(3)}`}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                    <ExperimentMetric
                      label="Duración total"
                      value={`${arm.totalDurationSeconds}s`}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                    <ExperimentMetric
                      label="Media/job"
                      value={`${arm.avgDurationPerJobSeconds.toFixed(1)}s`}
                      highlighted={experimentComparison.winningArmId === arm.armId}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      {/* Model Generation Costs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <UserSquare2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-900">Generación de fotos de modelos (IA)</h2>
          <span className="ml-auto text-xs text-gray-400">costo estimado</span>
        </div>
        {!modelGenStats || (modelGenStats.totalPhotos === 0) ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Aún no hay generaciones de modelos registradas.
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">Fotos generadas</p>
                <p className="text-xl font-bold text-gray-900">{modelGenStats.totalPhotos}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">Costo total estimado</p>
                <p className="text-xl font-bold text-gray-900">${modelGenStats.totalCostUsd.toFixed(3)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">Costo promedio/foto</p>
                <p className="text-xl font-bold text-gray-900">
                  ${modelGenStats.totalPhotos > 0 ? (modelGenStats.totalCostUsd / modelGenStats.totalPhotos).toFixed(4) : '0.0000'}
                </p>
              </div>
            </div>
            {Object.keys(modelGenStats.byProvider).length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Por proveedor</p>
                <div className="space-y-2">
                  {(Object.entries(modelGenStats.byProvider) as [string, { photos: number; costUsd: number }][]).map(([provider, s]) => (
                    <div key={provider} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2 text-sm">
                      <span className="font-medium text-gray-700">{provider}</span>
                      <span className="text-gray-500">{s.photos} fotos · <span className="font-semibold text-gray-900">${s.costUsd.toFixed(3)}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {modelGenStats.recentLogs.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Últimas sesiones</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-400">
                        <th className="pb-2 font-medium">Proveedor</th>
                        <th className="pb-2 font-medium">Fotos</th>
                        <th className="pb-2 font-medium">Costo est.</th>
                        <th className="pb-2 font-medium">Usuario</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {modelGenStats.recentLogs.map((log) => (
                        <tr key={log.id} className="text-gray-700">
                          <td className="py-2 pr-4">{log.provider}</td>
                          <td className="py-2 pr-4">{log.completedPhotos}/{log.requestedPhotos}</td>
                          <td className="py-2 pr-4 font-medium">${log.estimatedCostUsd.toFixed(4)}</td>
                          <td className="py-2 text-gray-400 truncate max-w-[120px]">{log.createdByDisplayName ?? log.createdByUid?.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

function AlertInput({
  label,
  value,
  onChange,
  disabled,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  prefix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">
            {prefix}
          </span>
        ) : null}
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={`w-full rounded-xl border border-gray-300 py-2 pr-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 ${prefix ? 'pl-7' : 'pl-3'} ${disabled ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-800'}`}
        />
      </div>
    </label>
  );
}

function StatCard({ title, value, icon: Icon, color, bg }: { title: string, value: string | number, icon: any, color: string, bg: string }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${bg} ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function ExperimentMetric({
  label,
  value,
  highlighted = false,
}: {
  label: string;
  value: string | number;
  highlighted?: boolean;
}) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${highlighted ? 'bg-white/10' : 'bg-white'}`}>
      <p
        className={`text-xs uppercase tracking-[0.12em] ${
          highlighted ? 'text-emerald-100/80' : 'text-gray-400'
        }`}
      >
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold ${highlighted ? 'text-white' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
