import React, { useEffect } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { Button, PageHeader, LoadingBlock, EmptyState } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { ClientCreateForm } from '../components/clients/ClientCreateForm';
import { ClientListItem } from '../components/clients/ClientListItem';
import { clientDetailUrl, readClientListState, selectClientPage, updateClientListFilters } from '../features/clients/clientListState';

export const Clients = ({ view }: { view: 'create' | 'list' }) => {
  const state = useClientManagement();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = readClientListState(params);
  const result = selectClientPage(state.clients, params);
  const update = (patch: Record<string, string>) => setParams(current => updateClientListFilters(current, patch), { replace: true });
  useEffect(() => {
    if (!state.loading && result.page !== filters.page) update({ page: String(result.page) });
  }, [state.loading, result.page, filters.page]);
  if (location.hash.startsWith('#client-')) return <Navigate replace to={clientDetailUrl(location.hash.slice(8), location.search)} />;
  return <div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageHeader title="Clientes" description={view === 'create' ? 'Alta de cliente y prompt base de generación.' : 'Un espacio para cada cliente. Sus canales, fuentes y preferencias, en una sola ficha.'} icon={Users} />
      <Link to={view === 'create' ? '/clients/lista' : '/clients/crear'} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">{view === 'create' ? 'Ver clientes' : 'Crear cliente'}</Link>
    </div>
    {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</p>}
    {view === 'create' ? <div className="max-w-2xl"><ClientCreateForm {...state} onSubmit={state.handleCreate} /></div> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Lista de clientes">
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 p-4">
        <label className="min-w-48 flex-1 space-y-1 text-xs font-medium text-slate-600">Buscar por nombre<input aria-label="Buscar por nombre" type="search" value={filters.search} onChange={event => update({ q: event.target.value })} placeholder="Nombre del cliente…" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="space-y-1 text-xs font-medium text-slate-600">Estado<select aria-label="Estado" className="block rounded-lg border border-slate-300 px-3 py-2 text-sm" value={filters.status} onChange={event => update({ status: event.target.value === 'all' ? '' : event.target.value })}><option value="all">Todos los estados visibles</option><option value="active">Activo</option><option value="archived">Archivado</option></select></label>
        <label className="flex items-center gap-2 py-2 text-sm text-slate-600"><input type="checkbox" checked={filters.showArchived} onChange={event => update({ archived: event.target.checked ? '1' : '' })} />Mostrar archivados</label>
      </div>
      {state.loading ? <LoadingBlock /> : !result.filtered.length ? <EmptyState title="No hay clientes que mostrar" description="Ajusta la búsqueda, el estado o la opción Mostrar archivados, o crea un cliente." /> : <div className="overflow-x-auto"><p className="px-4 py-2 text-xs text-slate-500 sm:hidden">Desliza la tabla para ver todas las columnas y acciones.</p><table className="w-full min-w-[680px] text-sm"><caption className="sr-only">Clientes y canales habilitados administrativamente</caption><thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500"><tr>{['Cliente', 'Estado', 'Marketplaces habilitados', 'Último lote creado', 'Acciones'].map(label => <th key={label} className="px-4 py-3 font-medium" scope="col">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{result.clients.map(client => <ClientListItem key={client.id} client={client} listSearch={location.search} onArchive={state.handleArchive} onRestore={state.handleRestore} />)}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-xs text-slate-500"><span>{result.filtered.length} clientes · Página {result.page} de {result.totalPages} · Máximo 20 por página</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={result.page === 1} onClick={() => update({ page: String(result.page - 1) })}>Anterior</Button><Button variant="secondary" size="sm" disabled={result.page === result.totalPages} onClick={() => update({ page: String(result.page + 1) })}>Siguiente</Button></div></div>
    </section>}
  </div>;
};
