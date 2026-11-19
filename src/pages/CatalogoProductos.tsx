import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, RefreshCw } from 'lucide-react';
import type { CatalogProductGroup, Client } from '../../shared/src/types';
import { CATALOG_PRODUCT_GROUPS, catalogFamiliesOfGroup } from '../../shared/src/clientCatalog/browse';
import { Alert, Button, EmptyState, PageHeader, Pagination, TableSkeleton } from '../components/ui';
import { subscribeToClients } from '../features/clients/firebase';
import { PRODUCT_PAGE_SIZES, UNCLASSIFIED_TYPE, useCatalogProducts } from '../features/catalog/products/useCatalogProducts';
import { catalogProductView } from '../features/catalog/products/catalogProductView';
import { CatalogProductRow } from '../components/catalog/products/CatalogProductRow';
import { CatalogProductDetail } from '../components/catalog/products/CatalogProductDetail';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Catálogo → Productos: SPU list of one client, filtered by template category and creation date. */
export const CatalogoProductos: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const clientId = params.get('clientId') ?? '';
  const group = (CATALOG_PRODUCT_GROUPS.some(g => g.id === params.get('group')) ? params.get('group') : '') as CatalogProductGroup | '';
  const families = catalogFamiliesOfGroup(group);
  const requestedType = params.get('typeId') ?? '';
  const typeId = requestedType === UNCLASSIFIED_TYPE || families.some(f => f.productTypes.some(t => t.id === requestedType)) ? requestedType : '';
  const from = DATE_PATTERN.test(params.get('from') ?? '') ? params.get('from')! : '';
  const to = DATE_PATTERN.test(params.get('to') ?? '') ? params.get('to')! : '';
  const pageSize = PRODUCT_PAGE_SIZES.find(size => String(size) === params.get('pageSize')) ?? 20;
  const [detail, setDetail] = useState<{ productId: string; focus: string | null } | null>(null);

  useEffect(() => subscribeToClients(setClients, error => setClientsError(error.message)), []);

  const update = (changes: Record<string, string>) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const list = useCatalogProducts({ clientId, group, typeId, from, to, pageSize });
  const products = useMemo(() => list.products.map(catalogProductView), [list.products]);
  const opened = detail ? products.find(product => product.id === detail.productId) : undefined;
  const rangeInvalid = Boolean(from && to && from > to);
  const pages = list.total === null ? null : Math.max(1, Math.ceil(list.total / pageSize));

  return <div className="tuto-page">
    <PageHeader title="Productos" icon={Package} description="Productos (SPU) de cada cliente con sus variantes (SKC). Se muestra la foto principal de cada variante; abre el producto para ver todas." />
    <section className="tuto-surface space-y-4 p-4" aria-label="Filtros">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,15rem)_10rem_minmax(0,16rem)_10rem_10rem_8rem]">
        <label className="block"><span className="tuto-label mb-1.5 block">Cliente</span>
          <select className="tuto-field" value={clientId} onChange={event => update({ clientId: event.target.value })}>
            <option value="">Selecciona un cliente...</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="tuto-label mb-1.5 block">Tipo</span>
          <select className="tuto-field" value={group} disabled={!clientId} onChange={event => update({ group: event.target.value, typeId: typeId === UNCLASSIFIED_TYPE ? typeId : '' })}>
            <option value="">Ropa y objetos</option>
            {CATALOG_PRODUCT_GROUPS.map(item => <option key={item.id} value={item.id}>Solo {item.label.toLocaleLowerCase('es')}</option>)}
          </select>
        </label>
        <label className="block"><span className="tuto-label mb-1.5 block">Categoría</span>
          <select className="tuto-field" value={typeId} disabled={!clientId} onChange={event => update({ typeId: event.target.value })}>
            <option value="">Todas las categorías</option>
            {families.map(family => <optgroup key={family.id} label={family.tab}>
              {family.productTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
            </optgroup>)}
            <option value={UNCLASSIFIED_TYPE}>Sin categoría</option>
          </select>
        </label>
        <label className="block"><span className="tuto-label mb-1.5 block">Creado desde</span>
          <input type="date" className="tuto-field" value={from} max={to || undefined} disabled={!clientId} onChange={event => update({ from: event.target.value })} />
        </label>
        <label className="block"><span className="tuto-label mb-1.5 block">Creado hasta</span>
          <input type="date" className="tuto-field" value={to} min={from || undefined} disabled={!clientId} onChange={event => update({ to: event.target.value })} />
        </label>
        <label className="block"><span className="tuto-label mb-1.5 block">Por página</span>
          <select className="tuto-field" value={pageSize} disabled={!clientId} onChange={event => update({ pageSize: event.target.value })}>
            {PRODUCT_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      {clientId && <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
        <span>{list.total === null ? 'Contando productos…' : `${list.total} ${list.total === 1 ? 'producto' : 'productos'}`}</span>
        {(group || typeId || from || to) && <Button variant="ghost" size="sm" onClick={() => update({ group: '', typeId: '', from: '', to: '' })}>Quitar filtros</Button>}
        <Button className="ml-auto" variant="ghost" size="sm" icon={RefreshCw} onClick={list.refresh}>Actualizar</Button>
      </div>}
    </section>

    {clientsError && <Alert tone="danger" title="No se pudieron cargar los clientes">{clientsError}</Alert>}
    {!clientId ? <EmptyState icon={<Package />} title="Selecciona un cliente" description="Elige un cliente para ver sus productos." />
      : rangeInvalid ? <Alert tone="warning">La fecha «desde» es posterior a la fecha «hasta».</Alert>
      : list.error ? <Alert tone="danger" title="No se pudieron cargar los productos" action={<Button size="sm" variant="secondary" onClick={list.refresh}>Reintentar</Button>}>{list.error}</Alert>
      : list.loading ? <div className="tuto-surface"><TableSkeleton message="Cargando productos…" rows={Math.min(pageSize, 6)} /></div>
      : products.length === 0 ? <EmptyState icon={<Package />} title="Sin productos" description={group || typeId || from || to ? 'Ningún producto coincide con los filtros.' : 'Este cliente todavía no tiene productos en el catálogo. Se crean al generar fotos.'} />
      : <>
        <div className="space-y-3">{products.map(product => <CatalogProductRow key={product.id} product={product} onOpen={focus => setDetail({ productId: product.id, focus })} />)}</div>
        <Pagination page={list.page} hasMore={list.hasMore} loading={list.loading} onPageChange={list.goToPage}>
          {`${(list.page - 1) * pageSize + 1}–${(list.page - 1) * pageSize + products.length}`}{list.total !== null ? ` de ${list.total}` : ''}{pages ? ` · ${pages} ${pages === 1 ? 'página' : 'páginas'}` : ''}
        </Pagination>
      </>}

    {opened && <CatalogProductDetail key={`${opened.id}:${detail?.focus}`} product={opened} clientId={clientId} focus={detail?.focus ?? null} onClose={() => setDetail(null)} />}
  </div>;
};
