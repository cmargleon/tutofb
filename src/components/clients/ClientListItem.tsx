import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { clientDetailUrl } from '../../features/clients/clientListState';
import { Button, StatusBadge } from '../ui';

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
    <th scope="row" className="min-w-52 text-left font-medium text-slate-900"><Link className="rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" to={url} onClick={event => event.stopPropagation()}><span className="flex items-center gap-3"><span className="tuto-avatar" aria-hidden="true">{client.name.slice(0, 2).toLocaleUpperCase('es')}</span><span className="break-words">{client.name}</span></span></Link></th>
    <td className="whitespace-nowrap"><StatusBadge status={archived ? 'archived' : 'active'} /></td>
    <td className="text-xs text-slate-600">{channels.length ? <div className="flex flex-wrap gap-1">{channels.map(channel => <span key={channel.id} className="rounded border border-slate-200 px-2 py-1">{channel.name}</span>)}</div> : 'Ninguno habilitado'}</td>
    <td className="text-xs text-slate-500">{client.lastBatchCreatedAt ? formatDateTimeLong(client.lastBatchCreatedAt) : 'Sin lotes registrados'}</td>
    <td className="whitespace-nowrap" onClick={event => event.stopPropagation()}><div className="flex flex-wrap items-center gap-2">
      <Link className="text-xs font-medium text-indigo-700 hover:underline" to={url}>Abrir</Link>
      <Link className="text-xs font-medium text-slate-700 hover:underline" to={clientDetailUrl(client.id!, listSearch, 'configuracion')}>Editar</Link>
      <Button size="sm" variant="ghost" onClick={() => archived ? onRestore(client) : onArchive(client)}>{archived ? 'Reactivar' : 'Archivar'}</Button>
    </div></td>
  </tr>;
};
