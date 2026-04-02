import React from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock, TrendingUp } from 'lucide-react';
import { AnalyticsStatCard } from './AnalyticsStatCard';
import { formatUsd } from './analyticsUtils';
import type { AnalyticsSummary, SystemHealthSnapshot } from '../../../shared/src/types';

interface AnalyticsOperationSectionProps {
  summary: AnalyticsSummary;
  systemHealth: SystemHealthSnapshot | null | undefined;
  todayCostUsd: number;
  costAlertTriggered: boolean;
  sharedDailyCostThreshold: number | null;
}

export function AnalyticsOperationSection({
  summary,
  systemHealth,
  todayCostUsd,
  costAlertTriggered,
  sharedDailyCostThreshold,
}: AnalyticsOperationSectionProps) {
  return (
    <>
      {costAlertTriggered && systemHealth && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-800">Alerta de gasto diario activa</p>
            <p className="mt-1 text-sm text-rose-700">
              El gasto de hoy es <strong>${formatUsd(todayCostUsd)}</strong>, superando el umbral de{' '}
              <strong>${formatUsd(sharedDailyCostThreshold)}</strong>. Ve a{' '}
              <a href="/configuracion" className="underline">Configuración</a> para ajustarlo.
            </p>
          </div>
        </div>
      )}

      {systemHealth?.alerts.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Alertas activas</h3>
              <p className="mt-1 text-sm text-slate-600">Estado operativo del sistema.</p>
            </div>
            <div className="text-xs text-slate-500">
              Última lectura:{' '}
              {systemHealth.checkedAt &&
                new Date(systemHealth.checkedAt as any).toLocaleTimeString('es-MX', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {systemHealth.alerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-xl border px-4 py-3 ${
                  alert.status === 'down' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      alert.status === 'down' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {alert.status === 'down' ? 'Crítico' : 'Degradado'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{alert.description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary.failedJobs > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-amber-800">Hay trabajos fallidos</h3>
            <p className="text-sm text-amber-700 mt-1">
              {summary.failedJobs} trabajos fallidos en el historial.
              {summary.pendingJobs > 0 && ` ${summary.pendingJobs} en cola o en proceso actualmente.`}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-4">
        <AnalyticsStatCard title="Total generados" value={summary.totalJobs.toLocaleString()} icon={Activity} color="text-blue-600" bg="bg-blue-50" />
        <AnalyticsStatCard title="Completados" value={summary.completedJobs.toLocaleString()} icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-50" />
        <AnalyticsStatCard title="Tasa de éxito" value={`${summary.successRate}%`} icon={TrendingUp} color="text-indigo-600" bg="bg-indigo-50" />
        <AnalyticsStatCard title="Tiempo promedio" value={`${summary.avgDurationSeconds ?? 0}s`} icon={Clock} color="text-purple-600" bg="bg-purple-50" />
      </div>
    </>
  );
}
