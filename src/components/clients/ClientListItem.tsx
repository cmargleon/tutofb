import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { clientDetailUrl } from '../../features/clients/clientListState';
import { Badge, Button, StatusBadge, buttonClasses } from '../ui';
import { clientInitials } from './clientUtils';

export const ClientListItem: React.FC<{
  client: Client;
  listSearch: string;
  onArchive: (client: Client) => void;
  onRestore: (client: Client) => void;
}> = ({ client, listSearch, onArchive, onRestore }) => {
  const navigate = useNavigate();
  const url = clientDetailUrl(client.id!, listSearch);
  const archived = client.status === 'archived';
  const channels = MARKETPLACES.filter(channel => client.marketplaces?.[channel.id]?.enabled === true);
  return <tr className="cursor-pointer" onClick={() => navigate(url)}>
    <th scope="row" className="min-w-56 text-left">
      <Link className="group inline-flex items-center gap-3 rounded-md" to={url} onClick={event => event.stopPropagation()}>
        <span className="tuto-avatar" aria-hidden="true">{clientInitials(client.name)}</span>
        <span className="break-words font-semibold text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-light)] group-hover:underline">{client.name}</span>
      </Link>
    </th>
    <td className="whitespace-nowrap"><StatusBadge status={archived ? 'archived' : 'active'} /></td>
    <td>{channels.length ? <div className="flex flex-wrap gap-1">{channels.map(channel => <Badge key={channel.id} tone="accent" className="tuto-badge--square">{channel.name}</Badge>)}</div> : <span className="text-xs text-[var(--color-text-dim)]">Ninguno habilitado</span>}</td>
    <td className="is-numeric">{Number.isFinite(client.batchCount) ? client.batchCount : '—'}</td>
    <td className="whitespace-nowrap text-xs text-[var(--color-text-muted)]">{client.lastBatchCreatedAt ? formatDateTimeLong(client.lastBatchCreatedAt) : 'Sin lotes registrados'}</td>
    <td className="whitespace-nowrap" onClick={event => event.stopPropagation()}>
      <div className="tuto-table-actions">
        <Link className={buttonClasses('ghost', 'sm')} to={clientDetailUrl(client.id!, listSearch, 'configuracion')}>Editar</Link>
        <Button size="sm" variant="ghost" onClick={() => archived ? onRestore(client) : onArchive(client)}>{archived ? 'Reactivar' : 'Archivar'}</Button>
        <Link className={buttonClasses('secondary', 'sm')} to={url}>Abrir<ChevronRight aria-hidden="true" /></Link>
      </div>
    </td>
  </tr>;
};
