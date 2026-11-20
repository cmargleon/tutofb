import { useEffect, useState } from 'react';
import type { OrganizerLinkCandidates, OrganizerLinkPreview, OrganizerLinkResult } from '../../../shared/src/types';
import { Button } from '../ui';
import { organizer } from '../../features/organizer/firebase';
import { useConfirm, useToast } from '../../features/feedback/FeedbackProvider';

const labels: Record<string, string> = { name: 'Nombre', description: 'Descripción', brand: 'Marca', category: 'Categoría', color: 'Color', size: 'Talla', pack: 'Pack', sku: 'SKU', skc: 'SKC', price: 'Precio', inventory: 'Stock', weight: 'Peso', weightUnit: 'Unidad de peso', length: 'Largo', width: 'Ancho', height: 'Alto', dimensionUnit: 'Unidad de medidas' };
const labelFor = (field: string) => field.startsWith('marketplaces.') ? `Datos de ${field.split('.')[1]}` : labels[field.split('.').at(-1)!.split('#')[0]] || field;

/** Association only: all product editing stays in the marketplace export drawer. */
export function OrganizerCommercialLink({ clientId, photoId, initial, disabled, onLinked }: {
  clientId: string; photoId: string; initial?: OrganizerLinkCandidates; disabled?: boolean; onLinked?: () => void;
}) {
  const [group, setGroup] = useState(initial);
  const [preview, setPreview] = useState<OrganizerLinkPreview>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, 'source' | 'target' | 'excel'>>({});
  const [loadError, setLoadError] = useState<string>();
  useEffect(() => {
    if (initial) return;
    let active = true;
    organizer<OrganizerLinkCandidates>({ action: 'linkCandidates', clientId, photoId })
      .then(value => { if (active) setGroup(value); })
      .catch(error => { if (active) setLoadError((error as Error).message); });
    return () => { active = false; };
  }, [clientId, photoId, initial]);
  const confirm = useConfirm(); const toast = useToast();
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { toast({ title: 'No se pudo completar el vínculo', description: (error as Error).message, tone: 'error' }); }
    finally { setBusy(false); }
  };
  const load = () => void run(async () => {
    setPreview(undefined);
    setGroup(await organizer<OrganizerLinkCandidates>({ action: 'linkCandidates', clientId, photoId }));
    setOpen(true);
  });
  const select = (variantId: string) => void run(async () => {
    setResolutions({});
    setPreview(await organizer<OrganizerLinkPreview>({ action: 'previewLink', clientId, photoId, variantId }));
  });
  const apply = () => void run(async () => {
    if (!preview) return;
    if (!await confirm({ title: 'Vincular ficha comercial', description: `${preview.group.name}: ${preview.group.photoIds.length} fotos se vincularán a ${preview.values.variants.map(v => v.values.sku || v.values.skc).join(', ')}.`,
      impact: `Se incorporarán ${preview.sourceProductIds.length} fichas provisionales a la ficha ${preview.productId}, conservando fotos, revisión y publicaciones.`, confirmLabel: 'Confirmar vínculo' })) return;
    await organizer<OrganizerLinkResult>({ action: 'link', clientId, photoId, variantId: preview.variantId, previewToken: preview.previewToken,
      requestId: crypto.randomUUID(), resolutions });
    setOpen(false); setPreview(undefined); setGroup({ ...preview.group, state: 'linked', candidates: [], message: 'Ficha comercial vinculada' });
    window.dispatchEvent(new Event('organizer-commercial-linked'));
    toast({ title: 'Ficha vinculada', description: 'Se conservaron las imágenes y se incorporaron los datos del Excel.', tone: 'success' });
    onLinked?.();
  });
  if (group?.state === 'linked') return <p className="text-sm text-emerald-800">Ficha comercial vinculada</p>;
  return <div className="space-y-3">
    {!initial && group && <p className={`text-sm ${group.severity === 'error' ? 'text-red-700' : 'text-amber-800'}`}>{group.severity === 'error' ? 'Error' : 'Aviso'} · {group.message}</p>}
    {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
    <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={load}>{busy ? 'Consultando…' : 'Vincular a fila del Excel'}</Button>
    {open && group && <section aria-label="Vincular ficha comercial" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-slate-900">
      <p className="font-semibold">{group.name} · {group.photoIds.length} fotos · Pendiente de vínculo</p>
      <p className="text-sm">{group.message}</p>
      <p className="text-xs text-slate-600">Filas sin fotos del Excel sincronizado. Elegir una fila requiere confirmación.</p>
      <ul className="divide-y divide-amber-200">{group.candidates.map(candidate => <li key={candidate.variantId} className="flex flex-wrap items-center justify-between gap-3 py-2">
        <div><p className="text-sm font-medium">{candidate.name} · {[...candidate.skcs, ...candidate.skus].join(' / ')}</p>
          <p className="text-xs">{[candidate.color, candidate.pack, candidate.sizes.join(', ')].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-slate-600">{candidate.origins.map(row => `${row.fileName} · ${row.tab} · fila ${row.row}`).join('; ')}</p></div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => select(candidate.variantId)}>Revisar vínculo</Button>
      </li>)}</ul>
      {preview && <div className="space-y-3 border-t border-amber-200 pt-3">
        <p className="text-sm font-semibold">Ficha destino: {preview.values.values.name || preview.productId}</p>
        <p className="text-xs">Se vincularán las {preview.group.photoIds.length} fotos del grupo, incluidas sus vistas y generaciones existentes.</p>
        <p className="text-xs">Fichas provisionales: {preview.sourceProductIds.join(', ') || 'Ninguna'}</p>
        <dl className="grid grid-cols-2 gap-1 text-xs">{Object.entries(preview.values.values).map(([field, value]) => <div key={field}><dt className="text-slate-600">{labelFor(field)}</dt><dd>{value}</dd></div>)}</dl>
        {preview.conflicts.map(conflict => <label key={conflict.field} className="block text-sm">Resolver {labelFor(conflict.field)}
          <select className="mt-1 block w-full rounded border bg-white p-2" value={resolutions[conflict.field] || ''} onChange={event => setResolutions({ ...resolutions, [conflict.field]: event.target.value as 'source' | 'target' | 'excel' })}>
            <option value="">Elige el valor que se conservará</option>
            <option value="source">Provisional: {conflict.source}</option><option value="target">Ficha destino: {conflict.target}</option><option value="excel">Excel: {conflict.excel}</option>
          </select>
        </label>)}
        <Button size="sm" disabled={busy || preview.conflicts.some(conflict => !resolutions[conflict.field])} onClick={apply}>Confirmar vínculo del grupo</Button>
      </div>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cerrar</Button>
    </section>}
  </div>;
}
