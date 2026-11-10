import React, { useEffect } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { PageHeader, EmptyState, Surface, SearchInput, FilterBar, DataTable, Pagination, TableSkeleton, INPUT_CLASS, buttonClasses, Page, Alert } from '../components/ui';
import { useClientManagement } from '../features/clients/useClientManagement';
import { ClientCreateForm } from '../components/clients/ClientCreateForm';
import { ClientListItem } from '../components/clients/ClientListItem';
import { CLIENTS_PAGE_SIZE, clientDetailUrl, readClientListState, updateClientListFilters } from '../features/clients/clientListState';

const COLUMNS: Array<[string, string?]> = [['Cliente'], ['Estado'], ['Marketplaces'], ['Lotes', 'is-numeric'], ['Último lote'], ['Acciones', 'text-right']];

export const Clients = ({ view }: { view: 'create' | 'list' }) => {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const filters = readClientListState(params);
  const listInput = { search: filters.search, status: filters.status as 'all' | 'active' | 'archived', showArchived: filters.showArchived, page: filters.page };
  const state = useClientManagement(undefined, listInput, view === 'create');
  const result = { clients: state.clients, page: state.pageInfo.page };
  const update = (patch: Record<string, string>) => setParams(current => updateClientListFilters(current, patch));
  const hasFilters = !!filters.search || filters.status !== 'all' || filters.showArchived;
  useEffect(() => {
    if (!state.loading && state.pageInfo.queryKey === JSON.stringify(listInput) && result.page !== filters.page) update({ page: String(result.page) });
  }, [state.loading, result.page, filters.page, state.pageInfo.queryKey, JSON.stringify(listInput)]);
  if (location.hash.startsWith('#client-')) return <Navigate replace to={clientDetailUrl(location.hash.slice(8), location.search)} />;

  return <Page>
    <PageHeader
      title="Clientes"
      description={view === 'create' ? 'Crea un espacio de trabajo para tu cliente y define sus preferencias de generación.' : 'Gestiona tus relaciones, canales y preferencias de producción.'}
      icon={Users}
      actions={view === 'create'
        ? <Link to="/clients/lista" className={buttonClasses('secondary')}>Ver clientes</Link>
        : <Link to="/clients/crear" className={buttonClasses('primary')}><Plus aria-hidden="true" />Crear cliente</Link>}
    />
    {state.error && <Alert tone="danger">{state.error}</Alert>}
    {view === 'create' ? <div className="max-w-2xl"><ClientCreateForm {...state} onSubmit={state.handleCreate} /></div> : <section aria-label="Lista de clientes">
      <Surface className="overflow-hidden">
        <FilterBar>
          <label className="min-w-56 flex-1"><span className="sr-only">Buscar por nombre</span><SearchInput aria-label="Buscar por nombre" value={filters.search} onChange={event => update({ q: event.target.value })} placeholder="Buscar un cliente por nombre…" /></label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><span>Estado</span><select aria-label="Estado" className={`${INPUT_CLASS} w-auto min-w-44`} value={filters.status} onChange={event => update({ status: event.target.value === 'all' ? '' : event.target.value })}><option value="all">Todos los estados visibles</option><option value="active">Activo</option><option value="archived">Archivado</option></select></label>
          <label className="flex min-h-9 items-center gap-2 text-sm text-[var(--color-text-secondary)]"><input type="checkbox" checked={filters.showArchived} onChange={event => update({ archived: event.target.checked ? '1' : '' })} />Mostrar archivados</label>
        </FilterBar>
        {state.loading ? <TableSkeleton /> : !result.clients.length ? <EmptyState
          icon={<Users />}
          title={state.error ? 'No se pudo cargar el directorio' : 'No hay clientes que mostrar'}
          description={state.error ? 'Vuelve a abrir el listado para intentar cargarlo de nuevo.' : hasFilters ? 'Ajusta la búsqueda, el estado o la opción Mostrar archivados.' : 'Crea tu primer cliente para empezar a generar fotografías.'}
          action={!state.error && !hasFilters ? <Link to="/clients/crear" className={buttonClasses('primary')}><Plus aria-hidden="true" />Crear cliente</Link> : undefined}
        /> : <>
          <p className="px-5 py-2 text-xs text-[var(--color-text-muted)] sm:hidden">Desliza la tabla para ver todas las columnas y acciones.</p>
          <DataTable className="min-w-[860px]" caption="Clientes y canales habilitados administrativamente">
            <thead><tr>{COLUMNS.map(([label, className]) => <th key={label} scope="col" className={className}>{label}</th>)}</tr></thead>
            <tbody>{result.clients.map(client => <ClientListItem key={client.id} client={client} listSearch={location.search} onArchive={state.handleArchive} onRestore={state.handleRestore} />)}</tbody>
          </DataTable>
        </>}
        <Pagination page={result.page} hasMore={state.pageInfo.hasMore} loading={state.loading} onPageChange={page => update({ page: String(page) })}>
          {state.loading ? 'Cargando directorio…' : `${result.clients.length} ${result.clients.length === 1 ? 'cliente' : 'clientes'} en esta página · Máximo ${CLIENTS_PAGE_SIZE} por página`}
        </Pagination>
      </Surface>
    </section>}
  </Page>;
};
