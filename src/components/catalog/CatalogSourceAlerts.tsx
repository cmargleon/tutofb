import { Link } from 'react-router-dom';
import type { CatalogSourceAlert } from '../../../shared/src/types';

export function CatalogSourceAlerts({ alerts, clientId }: { alerts: CatalogSourceAlert[]; clientId: string }) {
  if (!alerts.length) return null;
  return <div className="space-y-2 px-4 py-3" aria-label="Avisos de origen">
    {alerts.map((alert, index) => <p key={`${alert.itemId}:${alert.photoId}:${index}`} className={`text-sm ${alert.severity === 'error' ? 'text-red-700' : 'text-amber-800'}`}>
      <strong>{alert.severity === 'error' ? 'Error · Bloquea exportación' : 'Aviso'}</strong> · {alert.message}{' '}
      <Link className="tuto-link underline" to={`/organizador?${new URLSearchParams({ clientId, view: alert.photoId ? 'photos' : 'conflicts', ...(alert.photoId ? { photoId: alert.photoId } : {}) })}`}>
        {alert.photoId ? 'Ver foto en el Organizador' : 'Ver en el Organizador'}
      </Link>
    </p>)}
  </div>;
}
