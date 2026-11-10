import React from 'react';
import { Button, LoadingBlock } from '../ui';
import { useRole } from '../../features/auth/AuthProvider';
import { useAutomationBudgetSettings } from '../../features/automation/useAutomationBudgetSettings';

export const AutomationBudgetSettings = () => {
  const { value, setValue, loading, saving, save } = useAutomationBudgetSettings();
  const role = useRole();
  if (loading) return <LoadingBlock message="Cargando presupuesto de automatización…" />;
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="automation-budget-title">
    <div><h2 id="automation-budget-title" className="font-semibold text-slate-900">Presupuesto de automatización</h2>
      <p className="mt-2 text-sm text-slate-500">Límites por pedido automático. Los cambios se comprueban antes de cada nueva operación pagada.</p></div>
    <fieldset disabled={!role.canManageUsers || saving} className="grid gap-4 sm:grid-cols-2">
      {([
        ['defaultBudgetUsd', 'Presupuesto predeterminado por trabajo (USD)', 0.01, 10000, 0.01],
        ['maxBudgetUsd', 'Presupuesto máximo por trabajo (USD)', 0.01, 10000, 0.01],
        ['maxReviewAttempts', 'Máximo de intentos de calidad por imagen', 1, 10, 1],
        ['maxOperationalRetries', 'Máximo de reintentos operativos', 0, 10, 1],
      ] as const).map(([key, label, min, max, step]) => <label key={key} className="space-y-2 text-sm font-medium text-slate-700">{label}
        <input type="number" className="tuto-field w-full" min={min} max={max} step={step} value={Number.isFinite(value[key]) ? value[key] : ''} onChange={(e) => setValue({ ...value, [key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>)}
    </fieldset>
    <p className="text-xs text-slate-500">Los intentos de calidad incluyen la primera generación. El gasto reservado se controla en el servidor; las tarifas estimadas requieren autorización explícita y no representan un máximo de facturación del proveedor.</p>
    {role.canManageUsers && <Button loading={saving} onClick={() => void save()}>Guardar presupuesto de automatización</Button>}
  </section>;
};
