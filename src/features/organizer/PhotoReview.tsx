import { useEffect, useRef, useState } from 'react';
import type { OrganizerPhoto, OrganizerVariant } from '../../../shared/src/types';
import { Button } from '../../components/ui';
import { organizer } from './firebase';

const thumbnailCache = new Map<string, string>();
const label = (variant: OrganizerVariant) => [variant.visual, variant.name, variant.color, variant.capacity, variant.pack].filter(Boolean).join(' · ');
export function PhotoReview({ clientId, photo, products, group, disabled, correct }: {
  clientId: string; photo: OrganizerPhoto; products: OrganizerVariant[]; group: string[]; disabled: boolean;
  correct: (variantIds: string[], photoIds: string[], referenceVariantIds: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(photo.variantIds || (photo.variantId ? [photo.variantId] : []));
  const [eligible, setEligible] = useState(photo.referenceEligibleFor || (photo.variantId ? [photo.variantId] : []));
  const [search, setSearch] = useState('');
  const [applyGroup, setApplyGroup] = useState(false);
  const [thumbnail, setThumbnail] = useState('');
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelected(photo.variantIds || (photo.variantId ? [photo.variantId] : []));
    setEligible(photo.referenceEligibleFor || (photo.variantId ? [photo.variantId] : []));
  }, [photo]);
  useEffect(() => {
    if (!photo.copyUrl || !container.current) return;
    let current = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const key = `${clientId}:${photo.id}:${photo.copyUrl}`;
      if (thumbnailCache.has(key)) { setThumbnail(thumbnailCache.get(key)!); return; }
      void organizer<{ mimeType: 'image/jpeg'; base64: string }>({ action: 'thumbnail', clientId, photoId: photo.id }).then(result => {
        if (!current) return;
        const data = `data:${result.mimeType};base64,${result.base64}`;
        if (thumbnailCache.size >= 200) thumbnailCache.delete(thumbnailCache.keys().next().value!);
        thumbnailCache.set(key, data); setThumbnail(data);
      }).catch(() => { if (current) setError('Miniatura no disponible; abre el origen para revisar.'); });
    }, { rootMargin: '100px' });
    observer.observe(container.current);
    return () => { current = false; observer.disconnect(); };
  }, [clientId, photo.id, photo.copyUrl]);
  const candidates = new Map((photo.candidateDetails || []).map(candidate => [candidate.id, candidate]));
  const options = products.filter(product => !search || label(product).toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => (candidates.get(b.id)?.score || 0) - (candidates.get(a.id)?.score || 0) || label(a).localeCompare(label(b)));
  return <div ref={container} className="grid gap-4 sm:grid-cols-[160px_1fr]">
    <div>{thumbnail ? <img className="h-40 w-40 rounded-lg object-contain bg-slate-50" src={thumbnail} alt={photo.name} /> : <p className="text-xs text-slate-500">{error || 'Miniatura pendiente'}</p>}</div>
    <div className="space-y-2">
      <p className="text-sm">Identidad: {photo.identityState === 'shared' ? 'Foto compartida' : photo.variantId ? 'Variante asociada' : photo.baseId ? `Producto base ${photo.baseId}; variante pendiente` : 'Por identificar'} · Calidad: {photo.quality === undefined ? 'sin evaluar' : `${Math.round(photo.quality * 100)} %`}</p>
      {products.filter(product => Object.values(product.references).flat().includes(photo.id)).map(product => <p className="text-xs text-slate-600" key={product.id}>
        Referencia {product.referenceState === 'approved' ? 'aprobada' : 'propuesta'} para {label(product)} · requiere aprobación independiente de la identidad.
      </p>)}
      {photo.provisionalCode && !photo.variantId && <p className="text-xs text-slate-500">Nombre provisional: {photo.provisionalCode}; no confirma un SKU.</p>}
      {photo.candidateDetails?.slice(0, 5).map(candidate => <p key={candidate.id} className="text-xs text-slate-600"><strong>{candidate.label}</strong> · {candidate.evidence.join(' · ')}</p>)}
      <details><summary className="cursor-pointer text-sm font-medium text-indigo-700">Corregir asociación</summary>
        <form className="mt-3 grid gap-2" onSubmit={async event => { event.preventDefault(); await correct(selected, applyGroup ? group : [], eligible); }}>
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={`Buscar producto para ${photo.name}`} placeholder="Buscar por código, nombre o color" value={search} onChange={event => setSearch(event.target.value)} />
          <select className="min-h-28 rounded-lg border border-slate-300 p-2 text-sm" multiple aria-label={`Productos de ${photo.name}`} value={selected} disabled={disabled}
            onChange={event => {
              const next = Array.from(event.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>, option => option.value);
              setEligible(next.length === 1 ? next : selected.length > 1 ? eligible.filter(id => next.includes(id)) : []); setSelected(next);
            }}>
            {options.map(product => <option key={product.id} value={product.id}>{label(product)}</option>)}
          </select>
          <p className="text-xs text-slate-500">Selecciona varios productos si la imagen es compartida. La asociación no aprueba la foto como referencia para generar.</p>
          {selected.length > 1 && <fieldset className="grid gap-1 rounded-lg bg-slate-50 p-3 text-xs"><legend>Artículos para los que la foto es apta como referencia</legend>
            {products.filter(product => selected.includes(product.id)).map(product => <label key={product.id}><input type="checkbox" disabled={disabled} checked={eligible.includes(product.id)}
              onChange={event => setEligible(old => event.target.checked ? [...old, product.id] : old.filter(id => id !== product.id))} /> {label(product)}</label>)}
            <p>Confirma cada artículo visible y sus atributos. Las referencias propuestas todavía necesitarán aprobación.</p>
          </fieldset>}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" type="button" onClick={() => { setSelected([]); setEligible([]); }}>Dejar sin identificar</Button>
            {group.length > 1 && <label className="text-xs"><input type="checkbox" checked={applyGroup} onChange={event => setApplyGroup(event.target.checked)} /> Aplicar a {Math.min(group.length, 25)} fotos con la misma evidencia; conservar excepciones humanas</label>}
            <Button size="sm" variant="secondary" disabled={disabled}>Guardar asociación</Button>
          </div>
        </form>
      </details>
    </div>
  </div>;
}
