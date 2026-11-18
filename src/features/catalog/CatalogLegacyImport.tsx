import { useEffect, useState } from 'react';
import type { CatalogBatchPage, CatalogImportCandidate, CatalogProduct } from '../../../shared/src/types';
import { Button, INPUT_CLASS } from '../../components/ui';
import { applyMasterCatalogImport, getMasterCatalogProduct, listLegacyCatalogBatches, previewMasterCatalogImport } from './masterFirebase';
import { useToast } from '../feedback/FeedbackProvider';

function Candidate({ candidate, clientId, batchId, products, onApplied }: { candidate: CatalogImportCandidate; clientId: string; batchId: string; products: CatalogProduct[]; onApplied: () => void }) {
  const [target, setTarget] = useState<CatalogProduct | null>(null); const [targetId, setTargetId] = useState('');
  const [map, setMap] = useState<Record<string, string>>({}); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const toast = useToast();
  const id = candidate.linkedProductId || candidate.product.id;
  return <article className="rounded-lg border border-slate-200 p-4 space-y-3"><div><h4 className="font-semibold">{candidate.product.values.name || candidate.product.garmentId}</h4><p className="font-mono text-xs break-all text-slate-500">{candidate.product.id} · {candidate.product.variants.length} variantes</p></div>
    <p className="text-sm text-slate-600">{Object.entries(candidate.product.values).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
    {candidate.product.organizer?.source.issue && <p className="text-sm text-amber-800">{candidate.product.organizer.source.issue}</p>}
    {candidate.possibleDuplicateIds.length > 0 && <p className="text-sm text-amber-800">Posibles duplicados por SKU: {candidate.possibleDuplicateIds.join(', ')}. Se conservarán como incidencia; revisa la identidad antes de asociar.</p>}
    {(!candidate.linkedProductId || candidate.linkedProductId === candidate.product.id) && <label className="block text-sm">Destino<select className={`${INPUT_CLASS} mt-1`} value={targetId} disabled={busy} onChange={async e => {
      const selected = e.target.value; setTargetId(selected); setTarget(null); setMap({}); setConfirmed(false); setError(null);
      if (!selected) return; setBusy(true);
      try { setTarget((await getMasterCatalogProduct({ clientId, productId: selected })).product); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><option value="">Conservar identidad histórica / nueva ficha</option>{products.filter(p => p.id !== candidate.product.id).map(p => <option value={p.id} key={p.id}>{p.values.name || p.id} · {p.values.sku || p.id}</option>)}</select></label>}
    {target && <div className="space-y-2">
      <div className="rounded bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">Diferencias con la ficha destino</p>{Object.entries(candidate.product.values).filter(([key, value]) => Object.hasOwn(target.values, key) && target.values[key as keyof typeof target.values] !== value).map(([key, value]) => <p key={key}>{key}: ficha «{target.values[key as keyof typeof target.values] || '(vacío confirmado)'}» · fuente «{value}». Se conservará el dato de mayor prioridad y se registrará la diferencia.</p>)}</div>
      {candidate.product.variants.map(v => <label key={v.id} className="block text-sm">Variante de origen {v.values.sku || v.values.skc || v.id}<select value={map[v.id] || ''} className={`${INPUT_CLASS} mt-1`} onChange={e => setMap({ ...map, [v.id]: e.target.value })}><option value="">Selecciona variante canónica</option>{target.variants.map(t => <option key={t.id} value={t.id}>{t.values.sku || t.values.skc || t.id} · {t.values.color} {t.values.size}</option>)}</select></label>)}<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Verifiqué que esta generación pertenece al producto y a las variantes seleccionadas.</label></div>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <Button variant="secondary" size="sm" loading={busy} disabled={Boolean(targetId && (!target || !confirmed || candidate.product.variants.some(v => !map[v.id])))} onClick={async () => {
      setBusy(true); setError(null);
      try {
        await applyMasterCatalogImport({ clientId, batchId, legacyProductId: candidate.product.id, productId: target?.id || id, expectedRevision: target?.revision ?? candidate.currentRevision, expectedSourceRevision: candidate.currentRevision, fingerprint: candidate.fingerprint, confirmAssociation: confirmed, variantMap: map });
        toast({ title: 'Generación incorporada al catálogo', tone: 'success' }); onApplied();
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>{target ? 'Confirmar asociación' : candidate.linkedProductId ? 'Actualizar desde esta fuente' : 'Incorporar ficha'}</Button>
  </article>;
}
export function CatalogLegacyImport({ clientId, products, onApplied }: { clientId: string; products: CatalogProduct[]; onApplied: () => void }) {
  const [batches, setBatches] = useState<CatalogBatchPage>({ batches: [], nextCursor: null }); const [batchId, setBatchId] = useState('');
  const [candidates, setCandidates] = useState<CatalogImportCandidate[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; void listLegacyCatalogBatches({ clientId }).then(page => { if (live) setBatches(page); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [clientId]);
  const preview = async () => { setBusy(true); setError(null); setCandidates([]); try { setCandidates((await previewMasterCatalogImport({ clientId, batchId })).candidates); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <section aria-label="Incorporar histórico" className="tuto-surface p-5 space-y-4"><header><h2 className="font-semibold">Incorporar generaciones del histórico</h2><p className="mt-1 text-sm text-slate-500">La previsualización no escribe datos. Revisa cada artículo y confirma su incorporación o asociación. Las correcciones manuales se conservan y las diferencias quedan como incidencias.</p></header>
    <div className="flex flex-wrap items-end gap-3"><label className="flex-1 text-sm">Lote<select className={`${INPUT_CLASS} mt-1`} value={batchId} onChange={e => { setBatchId(e.target.value); setCandidates([]); }}><option value="">Selecciona un lote</option>{batches.batches.map(b => <option value={b.id} key={b.id}>{b.id}</option>)}</select></label><Button variant="secondary" loading={busy} disabled={!batchId} onClick={() => void preview()}>Previsualizar (dry-run)</Button>{batches.nextCursor && <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { const page = await listLegacyCatalogBatches({ clientId, cursor: batches.nextCursor! }); setBatches(current => ({ batches: [...current.batches, ...page.batches], nextCursor: page.nextCursor })); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Más lotes</Button>}</div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-2">{candidates.map(candidate => <Candidate key={`${candidate.product.id}:${candidate.currentRevision}`} candidate={candidate} clientId={clientId} batchId={batchId} products={products} onApplied={() => { onApplied(); void preview(); }} />)}</div>
  </section>;
}
