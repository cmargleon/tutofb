import { Button, LoadingBlock } from '../ui';
import { useRole } from '../../features/auth/AuthProvider';
import { useOrganizerAutomationSettings } from '../../features/organizer/useOrganizerAutomationSettings';

export const OrganizerAutomationSettings = () => {
  const { enabled, loading, saving, toggle } = useOrganizerAutomationSettings();
  const role = useRole();
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="organizer-automation-title">
    <div>
      <h2 id="organizer-automation-title" className="font-semibold text-slate-900">Generar fotos después de organizar</h2>
      <p className="mt-2 text-sm text-slate-500">Envía las fotos nuevas al flujo de automatización al terminar de organizar sus copias, aunque no coincidan con el Excel. Se aplica a todos los clientes con automatización habilitada.</p>
    </div>
    {loading ? <LoadingBlock message="Cargando automatización del organizador…" /> : <div className="flex flex-wrap items-center gap-4">
      <span className={`text-sm font-medium ${enabled ? 'text-emerald-700' : 'text-slate-600'}`}>{enabled ? 'Activada' : 'Desactivada'}</span>
      <Button role="switch" aria-label="Generar fotos después de organizar" aria-checked={enabled} variant={enabled ? 'secondary' : 'primary'}
        disabled={!role.canManageUsers} loading={saving} onClick={() => void toggle()}>{enabled ? 'Desactivar' : 'Activar'}</Button>
    </div>}
    <p className="text-xs text-slate-500">Al desactivarlo, las próximas fotos se organizan sin enviarse a generar. Los trabajos ya enviados continúan.</p>
  </section>;
};
