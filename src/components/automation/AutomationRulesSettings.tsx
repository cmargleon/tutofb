import { DEFAULT_AUTOMATION_RULES } from '../../../shared/src/automationConfig';
import { Button, INPUT_CLASS, LoadingBlock } from '../ui';
import { useRole } from '../../features/auth/AuthProvider';
import { useAutomationRulesSettings } from '../../features/automation/useAutomationRulesSettings';

export const AutomationRulesSettings = () => {
  const { value, setRule, loading, saving, save } = useAutomationRulesSettings();
  const role = useRole();
  if (loading) return <LoadingBlock message="Cargando reglas de automatización…" />;
  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="automation-rules-title">
    <div><h2 id="automation-rules-title" className="font-semibold text-slate-900">Reglas de decisión de automatización</h2>
      <p className="mt-2 text-sm text-slate-500">Valores globales para los clientes que heredan Sistema. Se aplican a trabajos nuevos; cada cliente puede definir sus propios umbrales.</p></div>
    <fieldset disabled={!role.canManageUsers || saving} className="grid gap-4 sm:grid-cols-2">
      {([
        ['garmentGenderMinConfidence', 'Confianza mínima de género', 'Con varios modelos disponibles, exige esta confianza para elegir el modelo según el género de la prenda.'],
        ['classificationMinConfidence', 'Confianza mínima de clasificación', 'Exige esta confianza para aceptar el tipo de artículo y sus vistas antes de generar.'],
      ] as const).map(([key, label, help]) => <label key={key} className="space-y-2 text-sm font-medium text-slate-700">{label}
        <input type="number" className={INPUT_CLASS} min="0.5" max="0.95" step="0.01" value={value[key] ?? ''} placeholder={`Predeterminado (${DEFAULT_AUTOMATION_RULES[key]})`} onChange={event => setRule(key, event.target.value)} />
        <span className="block text-xs font-normal text-slate-500">{help}</span>
      </label>)}
    </fieldset>
    <p className="text-xs text-slate-500">Valores entre 0.5 y 0.95. Un campo vacío usa el valor predeterminado de 0.65.</p>
    {role.canManageUsers && <Button loading={saving} onClick={() => void save()}>Guardar reglas de automatización</Button>}
  </section>;
};
