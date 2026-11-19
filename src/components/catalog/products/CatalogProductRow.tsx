import React from 'react';
import { Maximize2 } from 'lucide-react';
import { Badge, Button } from '../../ui';
import { formatDateTimeLong } from '../../../../shared/src/utils/dateUtils';
import { variantGroupLabel, variantGroupSizes, type CatalogProductView } from '../../../features/catalog/products/catalogProductView';
import { CatalogProductPhoto } from './CatalogProductPhoto';

/** One SPU: identification on the left, one tile per SKC with its main photo. */
export const CatalogProductRow: React.FC<{ product: CatalogProductView; onOpen: (groupKey: string | null) => void }> = ({ product, onOpen }) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 lg:w-72 lg:shrink-0">
        <h3 className="truncate text-base font-semibold text-slate-900" title={product.name}>{product.name}</h3>
        <p className="mt-0.5 text-sm text-slate-500">SPU <span className="font-mono text-slate-700">{product.spu || '—'}</span></p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {product.typeLabel
            ? <Badge tone="accent">{product.typeLabel}</Badge>
            : <Badge tone="warning">{product.rawCategory ? `Sin categoría · ${product.rawCategory}` : 'Sin categoría'}</Badge>}
          <Badge>{product.groups.length} {product.groups.length === 1 ? 'variante' : 'variantes'}</Badge>
          {product.skuCount > 0 && <Badge>{product.skuCount} SKU</Badge>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Creado {product.createdAt ? formatDateTimeLong(product.createdAt) : '—'}</p>
        <Button className="mt-3" variant="secondary" size="sm" icon={Maximize2} onClick={() => onOpen(null)}>Ver SPU completo</Button>
      </div>
      <ul className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1" aria-label={`Variantes de ${product.name}`}>
        {product.groups.map(group => {
          const sizes = variantGroupSizes(group);
          return <li key={group.key} className="w-32 shrink-0">
            <button type="button" onClick={() => onOpen(group.key)} className="group block w-full text-left" title={`Ver todas las fotos de ${variantGroupLabel(group)}`}>
              <CatalogProductPhoto photo={group.main} alt={`${product.name} · ${variantGroupLabel(group)}`} className="aspect-[3/4] w-full transition group-hover:border-indigo-400" />
              <p className="mt-1.5 truncate font-mono text-xs font-semibold text-slate-800">{variantGroupLabel(group)}</p>
              <p className="truncate text-xs text-slate-500">{[group.skc ? group.color : null, sizes.join(' · ')].filter(Boolean).join(' — ') || ' '}</p>
              <p className="text-[11px] text-slate-400">{group.photos.length} {group.photos.length === 1 ? 'foto' : 'fotos'}</p>
            </button>
          </li>;
        })}
        {product.unassigned.length > 0 && <li className="w-32 shrink-0">
          <button type="button" onClick={() => onOpen('unassigned')} className="block w-full text-left" title="Fotos sin variante asignada">
            <CatalogProductPhoto photo={product.unassigned[0]} alt={`${product.name} · sin variante`} className="aspect-[3/4] w-full opacity-70" />
            <p className="mt-1.5 truncate text-xs font-semibold text-slate-600">Sin variante</p>
            <p className="text-[11px] text-slate-400">{product.unassigned.length} {product.unassigned.length === 1 ? 'foto' : 'fotos'}</p>
          </button>
        </li>}
      </ul>
    </div>
  </article>
);
