import { OrganizerCommercialLink } from './OrganizerCommercialLink';
import { Link } from 'react-router-dom';
import type { CatalogSourceAlert } from '../../../shared/src/types';

export function CatalogSourceAlerts({ alerts, clientId }: { alerts: CatalogSourceAlert[]; clientId: string }) {
  if (!alerts.length) return null;
  // A historical group can span several garment items: each garment gets its alert, the batch shows the group once.
  const groups = new Set<string>();
  const visible = alerts.filter(alert => {
    if (!alert.link) return true;
    if (groups.has(alert.link.groupId)) return false;
    groups.add(alert.link.groupId); return true;
  });
  return <div className="space-y-2 px-4 py-3" aria-label="Avisos de origen">
    {visible.map((alert, index) => <div key={`${alert.itemId}:${alert.photoId}:${index}`} className={`text-sm ${alert.severity === 'error' ? 'text-red-700' : 'text-amber-800'}`}>
      <strong>{alert.severity === 'error' ? 'Error · Bloquea exportación' : alert.link ? 'Aviso · Pendiente de vínculo · Bloquea exportación' : 'Aviso'}</strong> · {alert.message}{' '}
      <Link className="tuto-link underline" to={`/organizador?${new URLSearchParams({ clientId, view: alert.photoId ? 'photos' : 'conflicts', ...(alert.photoId ? { photoId: alert.photoId } : {}) })}`}>
        {alert.photoId ? 'Ver foto en el Organizador' : 'Ver en el Organizador'}
      </Link>
      {alert.link && alert.photoId && <OrganizerCommercialLink clientId={clientId} photoId={alert.photoId} initial={alert.link} />}
    </div>)}
  </div>;
}
