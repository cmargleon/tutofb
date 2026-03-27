import React, { useEffect, useState } from 'react';
import { Bell, Settings } from 'lucide-react';
import { PageHeader, LoadingBlock } from '../components/ui';
import { useSystemHealth } from '../features/system/useSystemHealth';
import { updateSystemAlertSettings as saveSystemAlertSettings } from '../features/system/firebase';
import { useRole } from '../features/auth/AuthProvider';
import { useToast } from '../features/feedback/FeedbackProvider';

export const Configuracion: React.FC = () => {
  const role = useRole();
  const toast = useToast();

  const [alertForm, setAlertForm] = useState({
    dailyCostUsdThreshold: '',
    recentErrorRateThreshold: '10',
    pendingJobsThreshold: '25',
    staleProcessingJobsThreshold: '1',
  });

  const {
    data: systemHealth,
    loading: systemHealthLoading,
    error: systemHealthError,
    refresh: refreshSystemHealth,
  } = useSystemHealth(role.canAccessAnalytics);

  useEffect(() => {
    if (!systemHealth?.settings) return;
    setAlertForm({
      dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
      recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
      pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
      staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
    });
  }, [systemHealth?.settings]);

  const handleSave = async () => {
    try {
      await saveSystemAlertSettings({
        dailyCostUsdThreshold: alertForm.dailyCostUsdThreshold.trim()
          ? parseFloat(alertForm.dailyCostUsdThreshold)
          : null,
        recentErrorRateThreshold: parseFloat(alertForm.recentErrorRateThreshold),
        pendingJobsThreshold: parseInt(alertForm.pendingJobsThreshold, 10),
        staleProcessingJobsThreshold: parseInt(alertForm.staleProcessingJobsThreshold, 10),
      });
      await refreshSystemHealth();
      toast({
        tone: 'success',
        title: 'Configuración guardada',
        description: 'Los umbrales quedan aplicados para todo el equipo.',
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No se pudo guardar',
        description: err?.message || 'Revisa los valores e inténtalo nuevamente.',
      });
    }
  };

  const handleReset = () => {
    if (!systemHealth?.settings) return;
    setAlertForm({
      dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
      recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
      pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
      staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        title="Configuración"
        description="Ajustes del sistema compartidos con todo el equipo."
        icon={Settings}
      />

      {/* Alert thresholds */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-900">Alertas del sistema</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Umbrales compartidos para todo el equipo.{' '}
          {role.canManageUsers
            ? 'Solo los administradores pueden modificarlos.'
            : 'Estás viendo los valores actuales (solo lectura).'}
        </p>

        {systemHealthLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : systemHealthError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {systemHealthError}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <AlertField
                label="Límite de gasto diario (USD)"
                description="Genera una alerta si el gasto del día supera este monto."
                prefix="$"
                value={alertForm.dailyCostUsdThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, dailyCostUsdThreshold: v }))}
                disabled={!role.canManageUsers}
                placeholder="Sin límite"
              />
              <AlertField
                label="Tasa de errores recientes (%)"
                description="Alerta si el porcentaje de trabajos fallidos supera este umbral."
                value={alertForm.recentErrorRateThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, recentErrorRateThreshold: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Trabajos pendientes máximos"
                description="Alerta si hay más trabajos en cola que este número."
                value={alertForm.pendingJobsThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, pendingJobsThreshold: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Trabajos atascados máximos"
                description="Alerta si hay trabajos en proceso que llevan demasiado tiempo sin avanzar."
                value={alertForm.staleProcessingJobsThreshold}
                onChange={(v) =>
                  setAlertForm((f) => ({ ...f, staleProcessingJobsThreshold: v }))
                }
                disabled={!role.canManageUsers}
              />
            </div>

            {role.canManageUsers ? (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  onClick={() => void handleSave()}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Guardar
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  Descartar cambios
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

function AlertField({
  label,
  description,
  value,
  onChange,
  disabled,
  prefix,
  placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  prefix?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-0.5">{label}</span>
        <span className="block text-xs text-slate-400 mb-1.5">{description}</span>
        <div className="relative">
          {prefix ? (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
              {prefix}
            </span>
          ) : null}
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`w-full rounded-xl border border-slate-200 py-2 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${
              prefix ? 'pl-7' : 'pl-3'
            } ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-800'}`}
          />
        </div>
      </label>
    </div>
  );
}
