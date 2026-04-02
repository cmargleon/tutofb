import React from 'react';
import { UserSquare2 } from 'lucide-react';
import type { ModelGenerationStats } from '../../features/analytics/useModelGenerationLogs';

interface AnalyticsModelGenSectionProps {
  modelGenStats: ModelGenerationStats | null;
}

export function AnalyticsModelGenSection({ modelGenStats }: AnalyticsModelGenSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
        <UserSquare2 className="w-5 h-5 text-indigo-600" />
        <h2 className="text-sm font-semibold text-gray-900">Fotos de modelos (IA)</h2>
        <span className="ml-auto text-xs text-gray-400">costo estimado</span>
      </div>

      {!modelGenStats || modelGenStats.totalPhotos === 0 ? (
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
                ${modelGenStats.totalPhotos > 0
                  ? (modelGenStats.totalCostUsd / modelGenStats.totalPhotos).toFixed(4)
                  : '0.0000'}
              </p>
            </div>
          </div>

          {Object.keys(modelGenStats.byProvider).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Por proveedor</p>
              <div className="space-y-2">
                {(Object.entries(modelGenStats.byProvider) as [string, { photos: number; costUsd: number }][]).map(
                  ([provider, s]) => (
                    <div key={provider} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2 text-sm">
                      <span className="font-medium text-gray-700">{provider}</span>
                      <span className="text-gray-500">
                        {s.photos} fotos ·{' '}
                        <span className="font-semibold text-gray-900">${s.costUsd.toFixed(3)}</span>
                      </span>
                    </div>
                  )
                )}
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
                        <td className="py-2 text-gray-400 truncate max-w-[120px]">
                          {log.createdByDisplayName ?? log.createdByUid?.slice(0, 8)}
                        </td>
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
  );
}
