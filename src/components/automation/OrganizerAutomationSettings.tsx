import { Button, LoadingBlock } from '../ui';
import { useRole } from '../../features/auth/AuthProvider';
import { useOrganizerAutomationSettings } from '../../features/organizer/useOrganizerAutomationSettings';
import { DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED } from '../../../shared/src/types';

export const OrganizerAutomationSettings = () => {
  const { config, loading, saving, toggle } = useOrganizerAutomationSettings();
  const role = useRole();
  const settings = [
    {
      key: 'organizerWatcherEnabled',
      title: 'Vigilancia automática del Organizador',
      enabled: config.organizerWatcherEnabled !== false,
      description: 'Controla la vigilancia de Google Drive para todos los clientes que la tienen activada.',
      help: 'Al desactivarla, dejan de iniciarse nuevas ejecuciones automáticas. Las ejecuciones en curso y las manuales siguen disponibles.',
    },
    {
      key: 'organizerAutoGenerationEnabled',
      title: 'Generar fotos después de organizar',
      enabled: config.organizerAutoGenerationEnabled ?? DEFAULT_ORGANIZER_AUTO_GENERATION_ENABLED,
      description: 'Envía las fotos nuevas al flujo de automatización después de organizar sus copias. Cada cliente puede desactivarlo en su ficha, en Automatizaciones.',
      help: 'Al desactivar la generación, las próximas fotos solo se organizan. Los trabajos ya enviados continúan.',
    },
  ] as const;

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="organizer-automation-title">
    <h2 id="organizer-automation-title" className="font-semibold text-slate-900">Organizador inteligente</h2>
    {loading ? <LoadingBlock message="Cargando automatización del organizador…" /> : settings.map(({ key, title, enabled, description, help }) => (
      <div key={key} className="space-y-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{description}</p>
        <div className="flex flex-wrap items-center gap-4">
          <span className={`text-sm font-medium ${enabled ? 'text-emerald-700' : 'text-slate-600'}`}>{enabled ? 'Activada' : 'Desactivada'}</span>
          <Button role="switch" aria-label={title} aria-checked={enabled} variant={enabled ? 'secondary' : 'primary'}
            disabled={!role.canManageUsers || saving !== null} loading={saving === key}
            onClick={() => void toggle(key, !enabled, key === 'organizerWatcherEnabled' ? 'Vigilancia automática' : 'Generación después de organizar')}>
            {enabled ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">{help}</p>
      </div>
    ))}
  </section>;
};
