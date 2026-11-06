import React from 'react';
import { Link } from 'react-router-dom';
import type { Client } from '../../../shared/src/types';
import { Button } from '../ui';

export const ClientDetailHeader = ({ client, backUrl, onArchive, onRestore, onEdit }: {
  client: Client; backUrl: string; onArchive: () => void; onRestore: () => void; onEdit: () => void;
}) => <header className="space-y-4"><Link to={backUrl} className="text-sm font-medium text-indigo-700 hover:underline">← Volver a la lista</Link><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Ficha del cliente</p><h1 className="break-words text-2xl font-semibold text-slate-900">{client.name}</h1><p className="mt-2 text-sm text-slate-500">{client.status === 'archived' ? 'Archivado · historial y configuraciones conservados' : 'Activo'}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={onEdit}>Editar cliente</Button><Button variant="ghost" onClick={client.status === 'archived' ? onRestore : onArchive}>{client.status === 'archived' ? 'Reactivar cliente' : 'Archivar cliente'}</Button></div></div></header>;
