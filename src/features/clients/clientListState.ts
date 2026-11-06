import type { Client } from '../../../shared/src/types';

export const CLIENTS_PAGE_SIZE = 20;
export const readClientListState = (params: URLSearchParams) => ({
  search: params.get('q') ?? '',
  status: ['active', 'archived'].includes(params.get('status') ?? '') ? params.get('status')! : 'all',
  showArchived: params.get('archived') === '1',
  page: Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(params.get('page'))) || 1)),
});

export const selectClientPage = (clients: Client[], params: URLSearchParams) => {
  const state = readClientListState(params);
  const query = state.search.trim().toLowerCase();
  const filtered = clients.filter(client => (state.showArchived || client.status !== 'archived')
    && (state.status === 'all' || (client.status ?? 'active') === state.status)
    && client.name.toLowerCase().includes(query));
  const totalPages = Math.max(1, Math.ceil(filtered.length / CLIENTS_PAGE_SIZE));
  const page = Math.min(totalPages, state.page);
  return { filtered, totalPages, page, clients: filtered.slice((page - 1) * CLIENTS_PAGE_SIZE, page * CLIENTS_PAGE_SIZE) };
};

export const updateClientListFilters = (current: URLSearchParams, patch: Record<string, string>) => {
  const next = new URLSearchParams(current);
  Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
  if (Object.keys(patch).some(key => key !== 'page')) next.delete('page');
  return next;
};

export const clientDetailUrl = (id: string, listSearch: string, tab = 'resumen') => {
  const params = new URLSearchParams({ tab });
  if (listSearch) params.set('list', listSearch.replace(/^\?/, ''));
  return `/clients/${encodeURIComponent(id)}?${params}`;
};
export const clientListUrl = (detailParams: URLSearchParams) => {
  const search = new URLSearchParams(detailParams.get('list') ?? '').toString();
  return `/clients/lista${search ? `?${search}` : ''}`;
};
