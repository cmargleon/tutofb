import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Pencil, Users } from 'lucide-react';
import type { Client } from '../../../shared/src/types';
import { Breadcrumbs, Button, PageHeader, StatusBadge } from '../ui';

export const ClientDetailHeader = ({ client, backUrl, onArchive, onRestore, onEdit }: {
  client: Client; backUrl: string; onArchive: () => void; onRestore: () => void; onEdit: () => void;
}) => <div className="space-y-5">
  <Breadcrumbs><Link to={backUrl}>← Volver a la lista</Link><ChevronRight className="h-3 w-3" aria-hidden="true" /><span>Ficha del cliente</span></Breadcrumbs>
  <PageHeader title={client.name} icon={Users} description={client.status === 'archived' ? 'Historial y configuraciones conservados. Puedes reactivar este cliente cuando lo necesites.' : 'Productos, canales y preferencias en un mismo espacio.'}
    actions={<><Button variant="secondary" icon={Pencil} onClick={onEdit}>Editar cliente</Button><Button variant="ghost" onClick={client.status === 'archived' ? onRestore : onArchive}>{client.status === 'archived' ? 'Reactivar cliente' : 'Archivar cliente'}</Button></>} />
  <StatusBadge status={client.status === 'archived' ? 'archived' : 'active'} />
</div>;
