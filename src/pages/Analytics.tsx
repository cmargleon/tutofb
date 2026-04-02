import React, { useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { useAnalyticsDashboard } from '../features/analytics/useAnalyticsDashboard';
import { useModelGenerationLogs } from '../features/analytics/useModelGenerationLogs';
import { useGeminiUsageAnalytics } from '../features/analytics/useGeminiUsageAnalytics';
import { PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { useSystemHealth } from '../features/system/useSystemHealth';
import { useRole } from '../features/auth/AuthProvider';
import type { GeminiUsageFeature, GeminiUsageStatus } from '../../shared/src/types';
import { AnalyticsSectionLabel } from '../components/analytics/AnalyticsSectionLabel';
import { AnalyticsOperationSection } from '../components/analytics/AnalyticsOperationSection';
import { AnalyticsProductionSection } from '../components/analytics/AnalyticsProductionSection';
import { AnalyticsCostsSection } from '../components/analytics/AnalyticsCostsSection';
import { AnalyticsGeminiSection } from '../components/analytics/AnalyticsGeminiSection';
import { AnalyticsModelGenSection } from '../components/analytics/AnalyticsModelGenSection';

export const Analytics: React.FC = () => {
  const [daysBack, setDaysBack] = useState(30);
  const [geminiFeatureFilter, setGeminiFeatureFilter] = useState<GeminiUsageFeature | 'all'>('all');
  const [geminiStatusFilter, setGeminiStatusFilter] = useState<GeminiUsageStatus | 'all'>('all');
  const [geminiModelFilter, setGeminiModelFilter] = useState('');
  const role = useRole();

  const { data, loading, error } = useAnalyticsDashboard(daysBack);
  const { data: systemHealth } = useSystemHealth(role.canAccessAnalytics);
  const { stats: modelGenStats } = useModelGenerationLogs();
  const { data: geminiUsage, loading: geminiUsageLoading, error: geminiUsageError } = useGeminiUsageAnalytics(daysBack, {
    feature: geminiFeatureFilter,
    model: geminiModelFilter,
    status: geminiStatusFilter,
  });

  if (loading) {
    return (
      <div className="p-8">
        <PageHeader title="Analíticas" description="Operación, producción y costos." />
        <LoadingBlock message="Cargando métricas..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <PageHeader title="Analíticas" description="Operación, producción y costos." />
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
        <PageHeader title="Analíticas" description="Operación, producción y costos." />
        <EmptyState
          icon={<Activity className="w-6 h-6" />}
          title="Sin datos aún"
          description="No hay métricas disponibles en este momento."
        />
      </div>
    );
  }

  const todayCostUsd = systemHealth?.todayCostUsd ?? (dailyVolume.length > 0 ? dailyVolume[dailyVolume.length - 1].costUsd : 0);
  const costAlertTriggered = Boolean(systemHealth?.alerts.some((a) => a.id === 'daily_cost'));
  const sharedDailyCostThreshold = systemHealth?.settings?.dailyCostUsdThreshold ?? null;
  const geminiImageReviewCostUsd = geminiUsage.byFeature.find((e) => e.key === 'image_review')?.totalCostUsd || 0;
  const costRows = costByClientProvider.slice(0, 10);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader title="Analíticas" description="Operación, producción y costos." />
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
        </div>
      </div>

      <AnalyticsSectionLabel label="Operación" />
      <AnalyticsOperationSection
        summary={summary}
        systemHealth={systemHealth}
        todayCostUsd={todayCostUsd}
        costAlertTriggered={costAlertTriggered}
        sharedDailyCostThreshold={sharedDailyCostThreshold}
      />

      <AnalyticsSectionLabel label="Producción" />
      <AnalyticsProductionSection
        summary={summary}
        dailyVolume={dailyVolume}
        byProvider={byProvider}
        topClients={topClients}
        productivityByClientModel={productivityByClientModel}
        daysBack={daysBack}
        geminiImageReviewCostUsd={geminiImageReviewCostUsd}
      />

      <AnalyticsSectionLabel label="Costos" />
      <AnalyticsCostsSection
        summary={summary}
        dailyVolume={dailyVolume}
        byProvider={byProvider}
        costRows={costRows}
        daysBack={daysBack}
        todayCostUsd={todayCostUsd}
        geminiImageReviewCostUsd={geminiImageReviewCostUsd}
      />

      <AnalyticsGeminiSection
        geminiUsage={geminiUsage}
        geminiUsageLoading={geminiUsageLoading}
        geminiUsageError={geminiUsageError}
        geminiFeatureFilter={geminiFeatureFilter}
        setGeminiFeatureFilter={setGeminiFeatureFilter}
        geminiStatusFilter={geminiStatusFilter}
        setGeminiStatusFilter={setGeminiStatusFilter}
        geminiModelFilter={geminiModelFilter}
        setGeminiModelFilter={setGeminiModelFilter}
      />

      <AnalyticsModelGenSection modelGenStats={modelGenStats} />
    </div>
  );
};
