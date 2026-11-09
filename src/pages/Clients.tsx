import React, { useEffect } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { PageHeader, EmptyState, Surface, SearchInput, FilterBar, DataTable, Pagination, TableSkeleton, INPUT_CLASS, buttonClasses } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { ClientCreateForm } from '../components/clients/ClientCreateForm';
import { ClientListItem } from '../components/clients/ClientListItem';
import { CLIENTS_PAGE_SIZE, clientDetailUrl, readClientListState, updateClientListFilters } from '../features/clients/clientListState';

export const Clients = ({ view }: { view: 'create' | 'list' }) => {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = readClientListState(params);
  const listInput = { search: filters.search, status: filters.status as 'all' | 'active' | 'archived', showArchived: filters.showArchived, page: filters.page };
  const state = useClientManagement(undefined, listInput, view === 'create');
  const result = { clients: state.clients, page: state.pageInfo.page };
  const update = (patch: Record<string, string>) => setParams(current => updateClientListFilters(current, patch));
  useEffect(() => {
    if (!state.loading && state.pageInfo.queryKey === JSON.stringify(listInput) && result.page !== filters.page) update({ page: String(result.page) });
  }, [state.loading, result.page, filters.page, state.pageInfo.queryKey, JSON.stringify(listInput)]);
  if (location.hash.startsWith('#client-')) return <Navigate replace to={clientDetailUrl(location.hash.slice(8), location.search)} />;
  return <div className="mx-auto max-w-6xl space-y-6">
    <PageHeader title="Clientes" description={view === 'create' ? 'Crea un espacio de trabajo para tu cliente y define sus preferencias de generación.' : 'Gestiona tus relaciones, canales y preferencias de producción.'} icon={Users}
      actions={<Link to={view === 'create' ? '/clients/lista' : '/clients/crear'} className={buttonClasses(view === 'create' ? 'secondary' : 'primary')}>{view === 'list' && <Plus className="h-4 w-4" aria-hidden="true" />}{view === 'create' ? 'Ver clientes' : 'Crear cliente'}</Link>} />
    {state.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</p>}
    {view === 'create' ? <div className="max-w-2xl"><ClientCreateForm {...state} onSubmit={state.handleCreate} /></div> : <section aria-label="Lista de clientes">
      <Surface className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Directorio de clientes</h2>
          <span className="text-xs text-slate-500">Canales y configuración en cada ficha</span>
        </div>
        <FilterBar>
          <label className="min-w-48 flex-1 space-y-2 text-xs font-medium text-slate-600">Buscar por nombre<SearchInput aria-label="Buscar por nombre" value={filters.search} onChange={event => update({ q: event.target.value })} placeholder="Buscar un cliente…" /></label>
          <label className="space-y-2 text-xs font-medium text-slate-600">Estado<select aria-label="Estado" className={INPUT_CLASS} value={filters.status} onChange={event => update({ status: event.target.value === 'all' ? '' : event.target.value })}><option value="all">Todos los estados visibles</option><option value="active">Activo</option><option value="archived">Archivado</option></select></label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={filters.showArchived} onChange={event => update({ archived: event.target.checked ? '1' : '' })} />Mostrar archivados</label>
        </FilterBar>
        {state.loading ? <TableSkeleton /> : !result.clients.length ? <EmptyState icon={<Users className="h-5 w-5" />} title={state.error ? 'No se pudo cargar el directorio' : 'No hay clientes que mostrar'} description={state.error ? 'Vuelve a abrir el listado para intentar cargarlo de nuevo.' : 'Ajusta la búsqueda, el estado o la opción Mostrar archivados, o crea un cliente.'} /> : <>
          <p className="px-5 py-2 text-xs text-slate-500 sm:hidden">Desliza la tabla para ver todas las columnas y acciones.</p>
          <DataTable className="min-w-[800px]" caption="Clientes y canales habilitados administrativamente">
            <thead><tr>{['Cliente', 'Estado', 'Marketplaces habilitados', 'Último lote creado', 'Acciones'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{result.clients.map(client => <ClientListItem key={client.id} client={client} listSearch={location.search} onArchive={state.handleArchive} onRestore={state.handleRestore} />)}</tbody>
          </DataTable>
        </>}
        <Pagination page={result.page} hasMore={state.pageInfo.hasMore} loading={state.loading} onPageChange={page => update({ page: String(page) })}>
          {state.loading ? 'Cargando directorio…' : `${result.clients.length} ${result.clients.length === 1 ? 'cliente' : 'clientes'} en esta página · Máximo ${CLIENTS_PAGE_SIZE} por página`}
        </Pagination>
      </Surface>
    </section>}
  </div>;
};
