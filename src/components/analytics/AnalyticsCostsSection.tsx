import React from 'react';
import { Bot, DollarSign, TrendingUp } from 'lucide-react';
import { AnalyticsStatCard } from './AnalyticsStatCard';
import { formatUsd } from './analyticsUtils';
import { PROVIDER_PRICE_LABELS } from '../../../shared/src/constants/providerCosts';
import type { AnalyticsSummary, AnalyticsDailyVolume, AnalyticsProviderStats, AnalyticsClientProviderStats } from '../../../shared/src/types';
import { ClientProviderCostTable, CostTrendChart, ProviderCostBreakdown } from './AnalyticsCostBreakdown';

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
              {Object.entries(PROVIDER_PRICE_LABELS).map(([provider, label]) => (
                <li key={provider} className="bg-gray-50 px-2 py-1 rounded border border-gray-200 text-xs">
                  <span className="font-medium text-gray-700">{provider}:</span> {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <CostTrendChart dailyVolume={dailyVolume} daysBack={daysBack} />
          <ProviderCostBreakdown byProvider={byProvider} totalCostUsd={summary.totalCostUsd} />
        </div>

        <ClientProviderCostTable costRows={costRows} />
      </div>
    </>
  );
}
