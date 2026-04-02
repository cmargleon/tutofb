import React from 'react';
import { Bot, DollarSign, TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { AnalyticsStatCard } from './AnalyticsStatCard';
import { formatUsd } from './analyticsUtils';
import { PROVIDER_COSTS } from '../../../shared/src/constants/providerCosts';
import type { AnalyticsSummary, AnalyticsDailyVolume, AnalyticsProviderStats, AnalyticsClientProviderStats } from '../../../shared/src/types';

interface AnalyticsCostsSectionProps {
  summary: AnalyticsSummary;
  dailyVolume: AnalyticsDailyVolume[];
  byProvider: AnalyticsProviderStats[];
  costRows: AnalyticsClientProviderStats[];
  daysBack: number;
  todayCostUsd: number;
  geminiImageReviewCostUsd: number;
}

export function AnalyticsCostsSection({
  summary,
  dailyVolume,
  byProvider,
  costRows,
  daysBack,
  todayCostUsd,
  geminiImageReviewCostUsd,
}: AnalyticsCostsSectionProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <AnalyticsStatCard title="Costo total" value={`$${formatUsd(summary.totalCostUsd)}`} icon={DollarSign} color="text-rose-600" bg="bg-rose-50" />
        <AnalyticsStatCard title="Proyección mensual" value={`$${formatUsd(summary.projectedMonthlyCostUsd)}`} icon={TrendingUp} color="text-amber-600" bg="bg-amber-50" />
        <AnalyticsStatCard title="Gasto hoy" value={`$${formatUsd(todayCostUsd)}`} icon={DollarSign} color="text-orange-600" bg="bg-orange-50" />
        <AnalyticsStatCard title="Auto review (Gemini)" value={`$${formatUsd(geminiImageReviewCostUsd, 4)}`} icon={Bot} color="text-sky-600" bg="bg-sky-50" />
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Desglose de costos</h3>
          <div className="text-sm text-gray-500 mt-2 md:mt-0">
            Precios actuales:
            <ul className="flex gap-3 mt-1">
              {Object.entries(PROVIDER_COSTS).map(([provider, cost]) => (
                <li key={provider} className="bg-gray-50 px-2 py-1 rounded border border-gray-200 text-xs">
                  <span className="font-medium text-gray-700">{provider}:</span> ${cost.toFixed(2)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Gasto diario (últimos {daysBack} días)</h4>
            {dailyVolume.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#F43F5E" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="date" stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6B7280" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Costo USD']}
                    />
                    <Area type="monotone" dataKey="costUsd" name="Costo USD" stroke="#F43F5E" fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">Sin datos de costos.</div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Por proveedor</h4>
            {byProvider.length > 0 ? (
              <div className="space-y-4">
                {byProvider.map((provider) => (
                  <div key={provider.provider}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{provider.provider}</span>
                      <span className="text-gray-900">${provider.totalCostUsd.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-rose-500 h-2 rounded-full"
                        style={{ width: `${Math.min(100, (provider.totalCostUsd / Math.max(1, summary.totalCostUsd)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400">Sin datos de proveedores.</div>
            )}
          </div>
        </div>

        <div className="mt-8 border-t border-gray-100 pt-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700">Costo por cliente y proveedor</h4>
              <p className="mt-1 text-sm text-gray-500">Top 10 combinaciones por gasto acumulado.</p>
            </div>
          </div>

          {costRows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Cliente</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Proveedor</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Imágenes</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Costo total</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Costo promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {costRows.map((entry) => {
                    const avgCost = entry.completed > 0 ? entry.totalCostUsd / entry.completed : 0;
                    return (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{entry.clientNameSnapshot}</div>
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
              Sin desglose disponible todavía.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
