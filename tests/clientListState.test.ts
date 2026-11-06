import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '../shared/src/types';
import { clientDetailUrl, clientListUrl, readClientListState, selectClientPage, updateClientListFilters } from '../src/features/clients/clientListState';

const clients = Array.from({ length: 47 }, (_, index) => ({ id: `client-${index}`, name: `Cliente ${index}`, status: index === 46 ? 'archived' : 'active' } as Client));
test('client filtering covers the entire collection before applying the maximum 20 rows', () => {
  assert.equal(selectClientPage(clients, new URLSearchParams()).clients.length, 20);
  assert.equal(selectClientPage(clients, new URLSearchParams('page=2')).clients[0].id, 'client-20');
  assert.equal(selectClientPage(clients, new URLSearchParams('q=Cliente+45')).clients[0].id, 'client-45');
  assert.equal(selectClientPage(clients, new URLSearchParams('q=46')).filtered.length, 0);
  assert.equal(selectClientPage(clients, new URLSearchParams('q=46&status=archived&archived=1')).filtered.length, 1);
  assert.equal(selectClientPage(clients, new URLSearchParams('status=active&archived=1')).filtered.length, 46);
});
test('filter changes reset the page; shrinking data and invalid URLs clamp it', () => {
  assert.equal(updateClientListFilters(new URLSearchParams('q=old&page=3'), { q: 'new' }).get('page'), null);
  assert.equal(updateClientListFilters(new URLSearchParams('page=3'), { archived: '1' }).get('page'), null);
  assert.equal(updateClientListFilters(new URLSearchParams('page=3'), { status: 'active' }).get('page'), null);
  assert.equal(selectClientPage(clients.slice(0, 2), new URLSearchParams('page=3')).page, 1);
  for (const page of ['0', '-3', 'bad', '1.5']) assert.equal(readClientListState(new URLSearchParams({ page })).page, 1);
});
test('detail URLs round trip the list search, filters and page without accepting an external redirect', () => {
  const query = '?q=Cliente+4&archived=1&status=archived&page=2';
  const detail = new URL(clientDetailUrl('client', query, 'configuracion'), 'https://test.invalid');
  assert.equal(detail.pathname, '/clients/client');
  assert.equal(detail.searchParams.get('tab'), 'configuracion');
  assert.equal(clientListUrl(detail.searchParams), `/clients/lista${query}`);
  assert.ok(clientListUrl(new URLSearchParams('list=https://evil.invalid')).startsWith('/clients/lista?'));
});
