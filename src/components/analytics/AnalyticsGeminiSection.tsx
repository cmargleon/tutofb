import React from 'react';
import { Bot } from 'lucide-react';
import { LoadingBlock } from '../ui';
import { GEMINI_FEATURE_LABELS, GEMINI_STATUS_LABELS, formatUsd } from './analyticsUtils';
import type { GeminiUsageFeature, GeminiUsageStatus } from '../../../shared/src/types';
import type { GeminiUsageAnalyticsData, GeminiUsageFilters } from '../../features/analytics/useGeminiUsageAnalytics';

interface AnalyticsGeminiSectionProps {
  geminiUsage: GeminiUsageAnalyticsData;
  geminiUsageLoading: boolean;
  geminiUsageError: string | null;
  geminiFeatureFilter: GeminiUsageFilters['feature'];
  setGeminiFeatureFilter: (v: GeminiUsageFeature | 'all') => void;
  geminiStatusFilter: GeminiUsageFilters['status'];
  setGeminiStatusFilter: (v: GeminiUsageStatus | 'all') => void;
  geminiModelFilter: string;
  setGeminiModelFilter: (v: string) => void;
}

export function AnalyticsGeminiSection({
  geminiUsage,
  geminiUsageLoading,
  geminiUsageError,
  geminiFeatureFilter,
  setGeminiFeatureFilter,
  geminiStatusFilter,
  setGeminiStatusFilter,
  geminiModelFilter,
  setGeminiModelFilter,
}: AnalyticsGeminiSectionProps) {
  const geminiFeatureBreakdown = geminiUsage.byFeature.slice(0, 3);
  const geminiModelBreakdown = geminiUsage.byModel.slice(0, 3);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-emerald-600" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Uso de Gemini</h2>
            <p className="text-xs text-gray-500">
              Costo aproximado: ${formatUsd(0.25, 2)}/1M input · ${formatUsd(1.5, 2)}/1M output.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:ml-auto">
          <select
            value={geminiFeatureFilter}
            onChange={(e) => setGeminiFeatureFilter(e.target.value as GeminiUsageFeature | 'all')}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">Todos los flujos</option>
            {Object.entries(GEMINI_FEATURE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={geminiStatusFilter}
            onChange={(e) => setGeminiStatusFilter(e.target.value as GeminiUsageStatus | 'all')}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">Todos los estados</option>
            {Object.entries(GEMINI_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={geminiModelFilter}
            onChange={(e) => setGeminiModelFilter(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="">Todos los modelos</option>
            {geminiUsage.availableModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>

      {geminiUsageError ? (
        <div className="px-6 py-6 text-sm text-rose-600">{geminiUsageError}</div>
      ) : geminiUsageLoading ? (
        <div className="px-6 py-6"><LoadingBlock message="Cargando uso de Gemini..." /></div>
      ) : geminiUsage.summary.totalCalls === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-400">
          No hay llamadas a Gemini para los filtros seleccionados.
        </div>
      ) : (
        <div className="p-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Llamadas</p>
              <p className="text-xl font-bold text-gray-900">{geminiUsage.summary.totalCalls.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Costo aprox.</p>
              <p className="text-xl font-bold text-gray-900">${formatUsd(geminiUsage.summary.totalCostUsd, 4)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Tokens de entrada</p>
              <p className="text-xl font-bold text-gray-900">{geminiUsage.summary.inputTokens.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Tokens de salida</p>
              <p className="text-xl font-bold text-gray-900">{geminiUsage.summary.outputTokens.toLocaleString()}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Por flujo</p>
              <div className="space-y-2">
                {geminiFeatureBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-700">
                      {GEMINI_FEATURE_LABELS[entry.key as GeminiUsageFeature] || entry.label}
                    </span>
                    <span className="text-gray-500">
                      {entry.calls} llamadas ·{' '}
                      <span className="font-semibold text-gray-900">${formatUsd(entry.totalCostUsd, 4)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Por modelo</p>
              <div className="space-y-2">
                {geminiModelBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="font-medium text-gray-700">{entry.label}</span>
                    <span className="text-gray-500">
                      {entry.calls} llamadas ·{' '}
                      <span className="font-semibold text-gray-900">${formatUsd(entry.totalCostUsd, 4)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
