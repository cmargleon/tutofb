import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsClientProviderStats, AnalyticsDailyVolume, AnalyticsProviderStats } from '../../../shared/src/types';
import { AnalyticsChartTooltip } from './AnalyticsChartTooltip';

interface CostTrendChartProps {
  dailyVolume: AnalyticsDailyVolume[];
  daysBack: number;
}

interface ProviderCostBreakdownProps {
  byProvider: AnalyticsProviderStats[];
  totalCostUsd: number;
}

interface ClientProviderCostTableProps {
  costRows: AnalyticsClientProviderStats[];
}

export const CostTrendChart: React.FC<CostTrendChartProps> = ({ dailyVolume, daysBack }) => (
  <div>
    <h4 className="mb-4 text-sm font-medium text-gray-700">Gasto diario (últimos {daysBack} días)</h4>
    {dailyVolume.length > 0 ? (
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={256}>
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
            <Tooltip content={<AnalyticsChartTooltip />} />
            <Area type="monotone" dataKey="costUsd" name="Costo USD" stroke="#F43F5E" fillOpacity={1} fill="url(#colorCost)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <div className="flex h-64 items-center justify-center text-gray-400">Sin datos de costos.</div>
    )}
  </div>
);

export const ProviderCostBreakdown: React.FC<ProviderCostBreakdownProps> = ({ byProvider, totalCostUsd }) => {
  const progressMax = Math.max(1, totalCostUsd);

  return (
    <div>
      <h4 className="mb-4 text-sm font-medium text-gray-700">Por proveedor</h4>
      {byProvider.length > 0 ? (
        <div className="space-y-4">
          {byProvider.map((provider) => (
            <div key={provider.provider}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-gray-700">{provider.provider}</span>
                <span className="text-gray-900">${provider.totalCostUsd.toFixed(2)}</span>
              </div>
              <progress
                className="analytics-cost-progress"
                max={progressMax}
                value={Math.min(provider.totalCostUsd, progressMax)}
                aria-label={`Costo de ${provider.provider}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-400">Sin datos de proveedores.</div>
      )}
    </div>
  );
};

export const ClientProviderCostTable: React.FC<ClientProviderCostTableProps> = ({ costRows }) => (
  <div className="mt-8 border-t border-gray-100 pt-8">
    <div className="mb-4 flex items-start justify-between gap-4">
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
);
