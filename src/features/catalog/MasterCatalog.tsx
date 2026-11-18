import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import { Button, INPUT_CLASS, ImageThumb, LoadingBlock, PageHeader } from '../../components/ui';
import { subscribeToClients } from '../clients/firebase';
import { useRole } from '../auth/AuthProvider';
import type { CatalogProduct, CatalogStatus, Client } from '../../../shared/src/types';
import { formatDateTimeLong } from '../../../shared/src/utils/dateUtils';
import { useMasterCatalog } from './useMasterCatalog';
import { CatalogProductForm } from './CatalogProductForm';
import { CatalogLegacyImport } from './CatalogLegacyImport';

const statusLabels = { draft: 'Borrador', active: 'Activa', archived: 'Archivada' };
function ClientProducts({ clientId }: { clientId: string }) {
  const catalog = useMasterCatalog(clientId); const [historyOpen, setHistoryOpen] = useState(false); const role = useRole();
  const create = () => {
    const product: CatalogProduct = { id: crypto.randomUUID(), clientId, values: {}, variants: [{ id: crypto.randomUUID(), values: {} }], marketplaces: {}, revision: 0, updatedAt: null, updatedByUid: '',
      catalog: { version: 1, status: 'draft', createdAt: null, evidence: {}, attributes: {}, searchKeys: [], issues: [] } };
    catalog.setDetail({ product, links: [], nextCursor: null });
  };
  return <div className="space-y-5">
    <section className="tuto-surface p-4 flex flex-wrap gap-3 items-end"><label className="flex-1 min-w-52 text-sm font-medium">Buscar producto<input className={`${INPUT_CLASS} mt-1`} aria-label="Buscar producto" value={catalog.search} placeholder="Nombre, SKU, SKC o SPU" onChange={e => catalog.setSearch(e.target.value)} /></label><label className="text-sm font-medium">Estado<select className={`${INPUT_CLASS} mt-1`} aria-label="Estado" value={catalog.status} onChange={e => catalog.setStatus(e.target.value as CatalogStatus | '')}><option value="">Todos</option>{Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><Button variant="secondary" disabled={!role.canEvaluate} onClick={() => setHistoryOpen(open => !open)}>{historyOpen ? 'Cerrar histórico' : 'Incorporar histórico'}</Button><Button icon={Plus} disabled={!role.canEvaluate} onClick={create}>Nuevo producto</Button></section>
    {catalog.error && <p role="alert" className="tuto-alert tuto-alert--warning">{catalog.error}</p>}
    {historyOpen && <CatalogLegacyImport clientId={clientId} products={catalog.products} onApplied={catalog.refresh} />}
    {catalog.detail && <CatalogProductForm key={`${catalog.detail.product.id}:${catalog.detail.product.revision}`} detail={catalog.detail} onClose={() => catalog.setDetail(null)} onSaved={async id => { catalog.refresh(); await catalog.open(id); }} />}
    {catalog.loading ? <LoadingBlock message="Cargando catálogo maestro…" /> : <section aria-label="Productos maestros" className="tuto-surface overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-4">Producto</th><th className="p-4">Referencia</th><th className="p-4">Variantes</th><th className="p-4">Ficha</th><th className="p-4">Actualización</th></tr></thead><tbody className="divide-y divide-slate-100">{catalog.products.map(product => <tr key={product.id} className="hover:bg-emerald-50/40"><td className="p-4"><button className="flex items-center gap-3 text-left" onClick={() => void catalog.open(product.id)}><span className="block h-16 w-12 shrink-0 rounded bg-slate-100">{product.catalog?.thumbnailPath ? <ImageThumb storagePath={product.catalog.thumbnailPath} alt={product.values.name || 'Producto'} /> : <Package className="m-3 h-6 w-6 text-slate-400" />}</span><span><span className="tuto-link font-semibold">{product.values.name || 'Sin nombre'}</span><span className="block text-xs text-slate-500">{product.values.brand || 'Marca sin confirmar'}</span></span></button></td><td className="p-4 font-mono text-xs">{product.values.sku || product.variants[0]?.values.sku || product.variants[0]?.values.skc || 'Sin referencia'}<span className="block font-sans text-slate-500">{product.values.price ? `${product.values.price} ${product.values.currency || '(moneda pendiente)'}` : 'Precio sin confirmar'}</span></td><td className="p-4">{product.variants.length}</td><td className="p-4"><span className="font-medium">{statusLabels[product.catalog?.status || 'draft']}</span>{(!product.values.name || !product.values.brand || !product.values.currency || !product.variants.length) && <span className="block text-xs text-amber-700">Datos pendientes</span>}{Boolean(product.catalog?.issues.length) && <span className="block text-xs text-amber-800">{product.catalog!.issues.length} incidencias</span>}{product.organizerOverrides && !product.variants.length && <span className="block text-xs text-amber-800">Incorporar fuente del Organizador</span>}</td><td className="p-4 text-xs text-slate-500">{formatDateTimeLong(product.updatedAt)}</td></tr>)}</tbody></table></div>
      {!catalog.products.length && <div className="p-10 text-center"><Package className="mx-auto mb-3 h-8 w-8 text-slate-300" /><h2 className="font-semibold">{catalog.search || catalog.status ? 'Sin coincidencias' : 'Crea la primera ficha de este cliente'}</h2><p className="mt-2 text-sm text-slate-500">Puedes crear productos sin fotografías o incorporar generaciones desde el histórico.</p></div>}
      <footer className="border-t border-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Página {catalog.history.length + 1} · {catalog.products.length} fichas · búsqueda por inicio de nombre o identificador exacto</p><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={!catalog.history.length} onClick={catalog.previous}>Anterior</Button><Button variant="secondary" size="sm" disabled={!catalog.nextCursor} onClick={catalog.next}>Siguiente</Button></div></footer>
    </section>}
  </div>;
}
export function MasterCatalog({ client }: { client?: Client }) {
  const [params, setParams] = useSearchParams(); const [clients, setClients] = useState<Client[]>([]); const [error, setError] = useState<string | null>(null);
  const clientId = client?.id || params.get('clientId') || '';
  useEffect(() => client ? undefined : subscribeToClients(setClients, e => setError(e.message)), [client]);
  return <div className={client ? 'space-y-5' : 'tuto-page'}>
    <PageHeader title="Catálogo maestro" icon={Package} description="Una ficha comercial por producto. Conserva sus datos, variantes y fotografías a través de cada generación." actions={<Link className="tuto-link text-sm" to={client ? `?tab=productos&catalogView=photos` : `/catalogo${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`}>Ver catálogo de fotografías</Link>} />
    <nav aria-label="Vistas del catálogo" className="flex gap-5 border-b border-slate-200 pb-3 text-sm"><span aria-current="page" className="font-semibold text-emerald-800">Productos maestros</span><Link className="tuto-link" to={client ? '?tab=productos&catalogView=photos' : `/catalogo${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`}>Fotografías</Link></nav>
    {!client && <label className="block max-w-md text-sm font-medium">Cliente<select id="master-catalog-client" className={`${INPUT_CLASS} mt-1`} value={clientId} onChange={e => setParams(e.target.value ? { clientId: e.target.value } : {})}><option value="">Selecciona un cliente</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {error && <p role="alert" className="tuto-alert tuto-alert--warning">{error}</p>}
    {clientId ? <ClientProducts key={clientId} clientId={clientId} /> : <p className="tuto-surface p-8 text-sm text-slate-500">Selecciona un cliente para consultar su catálogo comercial.</p>}
  </div>;
}
