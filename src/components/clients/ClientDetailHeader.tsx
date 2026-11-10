import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Archive, ChevronRight, Pencil, RotateCcw } from 'lucide-react';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { Badge, Breadcrumbs, Button, StatusBadge } from '../ui';
import { clientInitials } from './clientUtils';

export const ClientDetailHeader = ({ client, backUrl, onArchive, onRestore, onEdit }: {
  client: Client; backUrl: string; onArchive: () => void; onRestore: () => void; onEdit: () => void;
}) => {
  const archived = client.status === 'archived';
  const enabledChannels = MARKETPLACES.filter(channel => client.marketplaces?.[channel.id]?.enabled === true).length;
  return <div className="space-y-4">
    <Breadcrumbs>
      <Link to={backUrl} className="inline-flex items-center gap-1"><ArrowLeft aria-hidden="true" />Volver a la lista</Link>
      <ChevronRight aria-hidden="true" />
      <span className="tuto-breadcrumb-current">Ficha del cliente</span>
    </Breadcrumbs>
    <header className="tuto-page-header mb-0">
      <div className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-3 sm:gap-4">
        <span className="tuto-avatar tuto-avatar--lg" aria-hidden="true">{clientInitials(client.name)}</span>
        <div className="min-w-0">
          <h1>{client.name}</h1>
          <div className="tuto-page-header-meta mt-1.5">
            <StatusBadge status={archived ? 'archived' : 'active'} />
            <Badge tone={enabledChannels ? 'accent' : 'neutral'}>{enabledChannels} de {MARKETPLACES.length} marketplaces</Badge>
            {Number.isFinite(client.batchCount) ? <Badge>{client.batchCount} {client.batchCount === 1 ? 'lote' : 'lotes'}</Badge> : null}
          </div>
          <p className="mt-2">{archived ? 'Historial y configuraciones conservados. Puedes reactivar este cliente cuando lo necesites.' : 'Productos, canales y preferencias en un mismo espacio.'}</p>
        </div>
      </div>
      <div className="tuto-page-header-actions">
        <Button variant="secondary" icon={Pencil} onClick={onEdit}>Editar cliente</Button>
        <Button variant="ghost" icon={archived ? RotateCcw : Archive} onClick={archived ? onRestore : onArchive}>{archived ? 'Reactivar cliente' : 'Archivar cliente'}</Button>
      </div>
    </header>
  </div>;
};
