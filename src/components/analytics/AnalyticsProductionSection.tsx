import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { AnalyticsReviewMetric } from './AnalyticsReviewMetric';
import { COLORS, formatUsd } from './analyticsUtils';
import type { AnalyticsSummary, AnalyticsDailyVolume, AnalyticsProviderStats, AnalyticsClientStats, AnalyticsClientModelStats } from '../../../shared/src/types';

interface AnalyticsProductionSectionProps {
  summary: AnalyticsSummary;
  dailyVolume: AnalyticsDailyVolume[];
  byProvider: AnalyticsProviderStats[];
  topClients: AnalyticsClientStats[];
  productivityByClientModel: AnalyticsClientModelStats[];
  daysBack: number;
  geminiImageReviewCostUsd: number;
}

export function AnalyticsProductionSection({
  summary,
  dailyVolume,
  byProvider,
  topClients,
  productivityByClientModel,
  daysBack,
  geminiImageReviewCostUsd,
}: AnalyticsProductionSectionProps) {
  const pieData = [
    { name: 'Completados', value: summary.completedJobs },
    { name: 'Fallidos', value: summary.failedJobs },
  ];

  return (
    <>
      {/* Auto review quality */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Calidad del auto review</h3>
            <p className="mt-1 text-sm text-gray-500">
              Cuentan como intervención humana: regeneración manual y selección manual, no solo los reintentos de Gemini.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Costo de auto review: <span className="font-semibold">${formatUsd(geminiImageReviewCostUsd, 4)}</span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnalyticsReviewMetric
            label="Sin corrección humana"
            value={`${summary.humanReviewAvoidedJobs.toLocaleString()} · ${summary.humanReviewAvoidedRatePct}%`}
            detail="Aprobados por Gemini y cerrados sin intervención."
          />
          <AnalyticsReviewMetric
            label="Con corrección humana"
            value={`${summary.jobsWithHumanIntervention.toLocaleString()} · ${summary.humanInterventionRatePct}%`}
            detail={`${summary.humanInterventionCount.toLocaleString()} acciones · ${summary.manualSelectionCount.toLocaleString()} selecciones manuales`}
          />
          <AnalyticsReviewMetric
            label="Precisión de Gemini"
            value={`${summary.geminiPrecisionPct}%`}
            detail="Porcentaje de decisiones de Gemini que coincidieron con la revisión humana."
          />
          <AnalyticsReviewMetric
            label="Gemini aprobó pero se corrigió"
            value={`${summary.geminiFalsePositiveJobs.toLocaleString()} · ${summary.geminiFalsePositiveRatePct}%`}
            detail="Gemini dio el visto bueno, pero alguien lo regeneró o seleccionó otra versión."
          />
          <AnalyticsReviewMetric
            label="Gemini rechazó pero se aprobó"
            value={`${summary.geminiFalseNegativeJobs.toLocaleString()} · ${summary.geminiFalseNegativeRatePct}%`}
            detail="Gemini lo rechazó, pero la revisión humana terminó aprobándolo."
          />
          <AnalyticsReviewMetric
            label="Aprobados por Gemini"
            value={summary.geminiApprovedJobs.toLocaleString()}
            detail={`${summary.geminiTruePositiveJobs.toLocaleString()} cerraron sin necesitar corrección humana.`}
          />
        </div>
      </div>

      {/* Volume + Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">
            Volumen diario (últimos {daysBack} días)
          </h3>
          {dailyVolume.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyVolume} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="date" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
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

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Estados</h3>
          {summary.completedJobs > 0 || summary.failedJobs > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-gray-400">Sin datos aún.</div>
          )}
        </div>
      </div>

      {/* Provider + Top Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Por proveedor</h3>
          {byProvider.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byProvider} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="provider" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} labelFormatter={(l) => `Proveedor: ${l}`} />
                  <Legend />
                  <Bar dataKey="completed" name="Completados" stackId="a" fill="#10B981" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="failed" name="Fallidos" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400">Sin datos de proveedores.</div>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Top clientes</h3>
          {topClients.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClients} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                  <XAxis type="number" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="clientNameSnapshot" type="category" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} width={100} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="completed" name="Completados" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400">Sin datos de clientes.</div>
          )}
        </div>
      </div>

      {/* Productivity table */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Productividad por cliente y modelo</h3>
            <p className="mt-1 text-sm text-gray-500">
              Primera pasada excluye regeneraciones y selecciones manuales.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">Aprobadas 1ra pasada</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{summary.firstPassApprovedJobs.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">Con corrección humana</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{summary.humanInterventionRatePct}%</p>
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
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Corrección humana</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Gem. aprobó/corregido</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Gem. rechazó/aprobado</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Regeneradas</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Costo/aprobada</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Duración media</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {productivityByClientModel.map((entry) => {
                  const firstPassRate = entry.completedJobs > 0
                    ? Math.round((entry.firstPassApprovedJobs / entry.completedJobs) * 100) : 0;
                  const avgCostPerApproved = entry.completedJobs > 0
                    ? entry.totalCostUsd / entry.completedJobs : 0;
                  const avgDurationSeconds = entry.totalCompletedOutputs > 0
                    ? entry.totalDurationSeconds / entry.totalCompletedOutputs : 0;
                  const interventionRate = entry.totalJobs > 0
                    ? Math.round((entry.jobsWithHumanIntervention / entry.totalJobs) * 100) : 0;

                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{entry.clientNameSnapshot}</div>
                        <div className="text-xs text-gray-500">{entry.modelNameSnapshot}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{entry.completedJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.firstPassApprovedJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          firstPassRate >= 80 ? 'bg-emerald-100 text-emerald-700'
                          : firstPassRate >= 60 ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                        }`}>
                          {firstPassRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{interventionRate}%</td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.geminiFalsePositiveJobs.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{entry.geminiFalseNegativeJobs.toLocaleString()}</td>
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
    </>
  );
}
