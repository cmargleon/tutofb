import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { clientDetailUrl } from '../../features/clients/clientListState';
import { Button } from '../ui';

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
  return <tr className="cursor-pointer transition-colors hover:bg-slate-50 focus-within:bg-indigo-50/50" onClick={() => navigate(url)}>
    <th scope="row" className="px-4 py-3 text-left font-medium text-slate-900"><Link className="rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" to={url} onClick={event => event.stopPropagation()}>{client.name}</Link></th>
    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${archived ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{archived ? 'Archivado' : 'Activo'}</span></td>
    <td className="px-4 py-3 text-xs text-slate-600">{channels.length ? <div className="flex flex-wrap gap-1">{channels.map(channel => <span key={channel.id} className="rounded border border-slate-200 px-2 py-1">{channel.name}</span>)}</div> : 'Ninguno habilitado'}</td>
    <td className="px-4 py-3 text-xs text-slate-500">{client.lastBatchCreatedAt ? formatDateTimeLong(client.lastBatchCreatedAt) : 'Sin lotes registrados'}</td>
    <td className="px-4 py-3" onClick={event => event.stopPropagation()}><div className="flex flex-wrap items-center gap-2">
      <Link className="text-xs font-medium text-indigo-700 hover:underline" to={url}>Abrir</Link>
      <Link className="text-xs font-medium text-slate-700 hover:underline" to={clientDetailUrl(client.id!, listSearch, 'configuracion')}>Editar</Link>
      <Button size="sm" variant="ghost" onClick={() => archived ? onRestore(client) : onArchive(client)}>{archived ? 'Reactivar' : 'Archivar'}</Button>
    </div></td>
  </tr>;
};
