import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { CatalogPhoto } from '../../../../shared/src/types';
import { Badge, buttonClasses } from '../../ui';
import { formatDateTimeLong } from '../../../../shared/src/utils/dateUtils';
import { variantGroupLabel, variantGroupSizes, type CatalogProductView } from '../../../features/catalog/products/catalogProductView';
import { CatalogProductPhoto } from './CatalogProductPhoto';

interface Section { key: string; title: string; subtitle: string; photos: CatalogPhoto[] }

const sectionsOf = (product: CatalogProductView): Section[] => [
  ...product.groups.map(group => ({
    key: group.key, title: variantGroupLabel(group),
    subtitle: [group.skc ? group.color : null, variantGroupSizes(group).join(' · '), group.variants.map(v => v.values.sku).filter(Boolean).join(', ')].filter(Boolean).join(' — '),
    photos: group.photos,
  })),
  ...(product.unassigned.length ? [{ key: 'unassigned', title: 'Sin variante', subtitle: 'Fotos que no se pudieron asignar a un SKC.', photos: product.unassigned }] : []),
];

/**
 * Full SPU (all SKC) or a single SKC with every photo. Read-only: product data is edited in the lote's
 * "Exportar a marketplaces" drawer.
 */
export const CatalogProductDetail: React.FC<{ product: CatalogProductView; clientId: string; focus: string | null; onClose: () => void }> = ({ product, clientId, focus, onClose }) => {
  const [scope, setScope] = useState<string | null>(focus);
  const [viewer, setViewer] = useState<{ photos: CatalogPhoto[]; index: number } | null>(null);
  const all = sectionsOf(product);
  const sections = scope ? all.filter(section => section.key === scope) : all;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (viewer) setViewer(null); else onClose(); }
      if (viewer && event.key === 'ArrowRight') setViewer(v => v && { ...v, index: (v.index + 1) % v.photos.length });
      if (viewer && event.key === 'ArrowLeft') setViewer(v => v && { ...v, index: (v.index - 1 + v.photos.length) % v.photos.length });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, onClose]);

  const editBatch = product.batchIds[0];
  const current = viewer?.photos[viewer.index];
  return <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-slate-950/65 p-0 sm:items-center sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="catalog-product-title" onClick={event => event.stopPropagation()}
      className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-3xl sm:border sm:border-slate-200">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="min-w-0">
          <h2 id="catalog-product-title" className="truncate text-lg font-semibold text-slate-900">{product.name}</h2>
          <p className="mt-1 text-sm text-slate-500">SPU <span className="font-mono text-slate-700">{product.spu || '—'}</span> · Creado {product.createdAt ? formatDateTimeLong(product.createdAt) : '—'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {product.typeLabel ? <Badge tone="accent">{product.typeLabel}</Badge> : <Badge tone="warning">Sin categoría</Badge>}
            {product.rawCategory && product.rawCategory !== product.typeLabel && <Badge>Categoría de la ficha: {product.rawCategory}</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editBatch && <Link className={buttonClasses('secondary', 'sm')} to={`/catalogo?clientId=${encodeURIComponent(clientId)}&batchId=${encodeURIComponent(editBatch)}`}>Abrir lote para editar</Link>}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
      </header>
      {all.length > 1 && <nav aria-label="Variantes" className="flex gap-2 overflow-x-auto border-b border-slate-200 px-5 py-3">
        <button type="button" onClick={() => setScope(null)} className={buttonClasses(scope ? 'ghost' : 'secondary', 'sm')}>SPU completo</button>
        {all.map(section => <button key={section.key} type="button" onClick={() => setScope(section.key)} className={`${buttonClasses(scope === section.key ? 'secondary' : 'ghost', 'sm')} font-mono`}>{section.title}</button>)}
      </nav>}
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {sections.map(section => <section key={section.key} aria-label={section.title}>
          <h3 className="font-mono text-sm font-semibold text-slate-900">{section.title}</h3>
          {section.subtitle && <p className="text-xs text-slate-500">{section.subtitle}</p>}
          {section.photos.length === 0
            ? <p className="mt-2 text-sm text-slate-500">Esta variante todavía no tiene fotos generadas.</p>
            : <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {section.photos.map((photo, index) => <li key={photo.jobId}>
                <button type="button" className="block w-full" onClick={() => setViewer({ photos: section.photos, index })} title="Ver en grande">
                  <CatalogProductPhoto photo={photo} alt={`${section.title} · foto ${index + 1}`} className="aspect-[3/4] w-full hover:border-indigo-400" />
                </button>
                <p className="mt-1 text-[11px] text-slate-500">{index === 0 ? 'Principal' : `Foto ${index + 1}`}{photo.view ? ` · ${photo.view}` : ''}</p>
              </li>)}
            </ul>}
        </section>)}
      </div>
    </div>
    {current && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/90 p-4" onClick={event => { event.stopPropagation(); setViewer(null); }}>
      <div className="relative h-full w-full max-w-4xl" onClick={event => event.stopPropagation()}>
        <CatalogProductPhoto full photo={current} alt="Foto en grande" className="h-full w-full border-0 bg-transparent" />
        {viewer!.photos.length > 1 && <>
          <button type="button" aria-label="Anterior" onClick={() => setViewer(v => v && { ...v, index: (v.index - 1 + v.photos.length) % v.photos.length })} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" aria-label="Siguiente" onClick={() => setViewer(v => v && { ...v, index: (v.index + 1) % v.photos.length })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"><ChevronRight className="h-6 w-6" /></button>
        </>}
        <button type="button" aria-label="Cerrar foto" onClick={() => setViewer(null)} className="absolute right-2 top-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"><X className="h-5 w-5" /></button>
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">{viewer!.index + 1} / {viewer!.photos.length}</p>
      </div>
    </div>}
  </div>;
};
