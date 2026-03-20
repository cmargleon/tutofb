import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  AreaChart, Area, PieChart, Pie, Cell 
} from 'recharts';
import { 
  Activity, CheckCircle2, XCircle, Clock, DollarSign, TrendingUp, AlertTriangle 
} from 'lucide-react';
import { useAnalyticsDashboard } from '../features/analytics/useAnalyticsDashboard';
import { PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { PROVIDER_COSTS } from '../../shared/src/constants/providerCosts';

const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6'];

export const Analytics: React.FC = () => {
  const { data, loading, error } = useAnalyticsDashboard();

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

  const { summary, dailyVolume, byProvider, topClients } = data;

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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <PageHeader 
        title="Analytics" 
        description="Volumen de generación, costos por proveedor y actividad por cliente."
      />

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
          value={`${summary.avgDurationSeconds}s`} 
          icon={Clock} 
          color="text-purple-600" 
          bg="bg-purple-50" 
        />
        <StatCard 
          title="Costo total" 
          value={`$${summary.totalCostUsd.toFixed(2)}`} 
          icon={DollarSign} 
          color="text-rose-600" 
          bg="bg-rose-50" 
        />
        <StatCard 
          title="Proyección mensual" 
          value={`$${summary.projectedMonthlyCostUsd.toFixed(2)}`} 
          icon={TrendingUp} 
          color="text-amber-600" 
          bg="bg-amber-50" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Daily Volume Area Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Volumen diario (últimos 30 días)</h3>
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
            <h4 className="text-sm font-medium text-gray-700 mb-4">Gasto diario (últimos 30 días)</h4>
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
      </div>
    </div>
  );
};

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
