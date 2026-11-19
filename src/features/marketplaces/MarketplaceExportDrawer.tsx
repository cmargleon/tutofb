import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, X, CheckCircle2, AlertCircle, ChevronDown, ArrowDownRight, ImageOff, Loader2 } from 'lucide-react';
import { MARKETPLACES, type MarketplaceId } from '../../../shared/src/marketplaces';
import type { MarketplaceExportIssue, MarketplaceExportScope } from '../../../shared/src/types';
import { Button, LoadingBlock } from '../../components/ui';
import { useStorageAssetUrl } from '../storage/useStorageAssetUrl';
import { MarketplaceProductEditor } from './MarketplaceProductEditor';
import { useMarketplaceExport } from './useMarketplaceExport';

function OriginalProductThumbnail({ storagePath }: { storagePath?: string }) {
  const { url, loading } = useStorageAssetUrl(storagePath);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
    {url && url !== failedUrl
      ? <img src={url} alt="Foto original del producto" className="h-full w-full object-contain" onError={() => setFailedUrl(url)} />
      : loading && storagePath
        ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" role="img" aria-label="Cargando foto original" />
        : <ImageOff className="h-4 w-4 text-slate-400" role="img" aria-label="Foto original no disponible" />}
  </div>;
}

export function MarketplaceExportDrawer({ scope, onClose }: { key?: string; scope: MarketplaceExportScope; onClose: () => void }) {
  const state = useMarketplaceExport(scope); const dialog = useRef<HTMLDialogElement>(null); const [editing, setEditing] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<{ marketplaceId: MarketplaceId; pinned: boolean } | null>(null);
  const [focusedIssue, setFocusedIssue] = useState<MarketplaceExportIssue | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const preview = state.preview; const available = preview?.channels.filter(c => c.compatibleTemplates > 0).map(c => c.marketplaceId) || [];
  const canDownload = !state.analyzing && state.selected.length > 0 && state.selected.every(id => state.exportable(id));
  const goToIssue = (issue: MarketplaceExportIssue) => {
    setRequirements(null);
    if (issue.productId) {
      setEditing(issue.productId);
      setFocusedIssue({ ...issue });
      return;
    }
    const summary = dialog.current?.querySelector<HTMLDetailsElement>(`[data-validation-summary="${issue.marketplaceId}"]`);
    if (summary) {
      summary.open = true;
      summary.querySelector('summary')?.focus();
    }
  };
  return <dialog ref={dialog} aria-labelledby="marketplace-export-title" onCancel={e => { e.preventDefault(); if (requirements) setRequirements(null); else if (!state.busy) onClose(); }} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-3xl border-0 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40">
    <div className="flex h-full flex-col"><header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6"><div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Catálogo / Exportación</p><h2 id="marketplace-export-title" className="mt-2 text-xl font-semibold">Exportar a marketplaces</h2><p className="mt-2 text-sm text-slate-500">{preview?.clientName || 'Cargando cliente'} · {scope.catalogProductIds ? 'desde el catálogo' : `${scope.batchIds.length} lote(s)`} · {preview?.products.length ?? '…'} productos</p></div><Button variant="ghost" size="sm" aria-label="Cerrar exportación" disabled={state.busy} onClick={onClose}><X className="h-5 w-5" /></Button></header>
      <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
        {!scope.catalogProductIds && <p className="text-xs text-slate-500">Lotes: {scope.batchIds.join(', ')}</p>}
        {state.loading && <LoadingBlock message="Validando datos y plantillas, sin generar archivos…" />}
        {state.error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{state.error}<Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void state.refresh()}>Volver a validar</Button></div>}
        {preview && !state.loading && <>
          {state.analyzing && <p role="status" className="flex items-center gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{preview.autofillBackground ? 'Preparando el lote en segundo plano (Gemini, fotos cuadradas y enlaces)… Los datos se actualizan solos.' : 'Analizando con Gemini… El formulario se completará al terminar y conservará tus cambios.'}</p>}
          {!state.analyzing && (state.analysisError || preview.autofillIncomplete) && <p role="alert" className="text-sm text-amber-800">{state.analysisError ? `Gemini no pudo completar el análisis: ${state.analysisError}` : 'Gemini no pudo completar todas las sugerencias. Revisa el texto de venta y los avisos de los campos; no se reintenta automáticamente.'} <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void state.refresh(true)}>Reintentar con Gemini</Button></p>}
          {!preview.channels.length && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Este cliente no tiene marketplaces habilitados. <Link className="underline" to={`/clients/${scope.clientId}?tab=marketplaces`}>Configurar marketplaces</Link></p>}
          {preview.channels.length > 0 && <p className="text-sm text-slate-600">Selecciona los destinos y corrige los requisitos pendientes. Los enlaces de las fotos aprobadas se completan al descargar.</p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={state.busy || !available.length} onClick={() => state.select(available)}>Seleccionar todos</Button><Button size="sm" variant="ghost" disabled={state.busy} onClick={() => state.select([])}>Deseleccionar todos</Button></div>
          <div className="grid gap-3 sm:grid-cols-2">{preview.channels.map(c => {
            const expanded = requirements?.marketplaceId === c.marketplaceId;
            const panelId = `marketplace-requirements-${c.marketplaceId}`;
            const pending = c.issues.filter(issue => issue.blocking !== false);
            const status = !c.compatibleTemplates ? 'Falta plantilla compatible' : state.analyzing && pending.length ? 'Analizando con Gemini…' : pending.length === 1 ? '1 requisito pendiente'
              : pending.length ? `${pending.length} requisitos pendientes`
                : c.issues.length === 1 ? '1 aviso de Gemini' : `${c.issues.length} avisos de Gemini`;
            const directIssue = pending.length <= 1 ? pending[0] || c.issues[0] : undefined;
            return <div key={c.marketplaceId} className={`rounded-xl border p-4 ${c.ready ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
              <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" disabled={state.busy || !c.compatibleTemplates} checked={state.selected.includes(c.marketplaceId)} onChange={e => state.select(e.target.checked ? [...state.selected, c.marketplaceId] : state.selected.filter(id => id !== c.marketplaceId))} /><span className="font-semibold">{MARKETPLACES.find(m => m.id === c.marketplaceId)?.name}</span></label>
              {c.ready && <p className="mt-3 flex items-center gap-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4" />Listo para exportar</p>}
              {(!c.ready || c.issues.length > 0) &&
                <div className="relative mt-3"
                  onPointerLeave={() => setRequirements(current => current?.marketplaceId === c.marketplaceId && !current.pinned ? null : current)}
                  onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setRequirements(current => current?.marketplaceId === c.marketplaceId ? null : current); }}>
                  <button type="button" className="flex items-center gap-2 rounded text-left text-xs text-amber-800 hover:underline"
                    disabled={state.busy}
                    aria-expanded={directIssue ? undefined : expanded} aria-controls={expanded ? panelId : undefined}
                    onPointerEnter={e => { if (e.pointerType === 'mouse') setRequirements(current => current?.marketplaceId === c.marketplaceId ? current : { marketplaceId: c.marketplaceId, pinned: false }); }}
                    onClick={() => {
                      if (directIssue) goToIssue(directIssue);
                      else setRequirements(current => current?.marketplaceId === c.marketplaceId && current.pinned ? null : { marketplaceId: c.marketplaceId, pinned: true });
                    }}>
                    <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />{status}
                    {directIssue ? <ArrowDownRight aria-hidden="true" className="h-3 w-3 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />}
                  </button>
                  {expanded && <div id={panelId} className="absolute inset-x-0 top-full z-20 pt-1">
                    <ul tabIndex={0} className="max-h-48 list-disc space-y-1.5 overflow-y-auto rounded-lg border border-amber-200 bg-white py-3 pl-7 pr-3 text-xs leading-relaxed text-slate-700 shadow-lg">
                      {c.issues.map((issue, i) => <li key={i} className="break-words">
                        <button type="button" disabled={state.busy} className="rounded text-left hover:underline focus-visible:underline" onClick={() => goToIssue(issue)}>
                          {issue.productName && <strong>{issue.productName}: </strong>}{issue.message}
                        </button>
                      </li>)}
                    </ul>
                  </div>}
                </div>}
              {!c.compatibleTemplates && <Link className="mt-2 block text-xs text-indigo-700 underline" to={`/clients/${scope.clientId}?tab=marketplaces`}>Configurar plantillas</Link>}
            </div>;
          })}</div>
          {preview.channels.filter(c => c.issues.length > 0).map(c => <details key={c.marketplaceId} data-validation-summary={c.marketplaceId} className="rounded-xl border border-amber-200 p-4"><summary className="cursor-pointer text-sm font-medium">{MARKETPLACES.find(m => m.id === c.marketplaceId)?.name} · resumen de validación ({c.issues.length})</summary><ul className="mt-3 space-y-2 text-xs text-slate-600">{c.issues.map((issue, i) => <li key={i}><strong>{issue.productName}</strong> {issue.message} {issue.productId && <button type="button" disabled={state.busy} className="ml-2 text-indigo-700 underline" onClick={() => goToIssue(issue)}>Corregir información</button>}</li>)}</ul></details>)}
          <fieldset disabled={state.busy} aria-label="Datos de los productos" className="space-y-3">
            <h3 className="text-sm font-semibold">Datos del producto</h3>
            {preview.products.map(p => <div key={`${p.id}:${p.revision}`} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
                <div className="flex min-w-0 items-center gap-3">
                  <OriginalProductThumbnail storagePath={p.originalImages?.find(image => image.storagePath)?.storagePath} />
                  <div className="min-w-0 break-words">
                    <p className="text-sm font-semibold">{p.values.name || p.garmentId}</p>
                    <p className="mt-1 text-xs text-slate-500">{p.variants.length} variantes · {p.approvedImages.length} fotos aprobadas{p.legacyDrafts.length ? ' · datos históricos recuperados' : ''}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => { setFocusedIssue(null); setEditing(editing === p.id ? null : p.id); }}>{editing === p.id ? 'Cerrar datos' : 'Completar datos'}</Button>
              </div>
              {editing === p.id && <MarketplaceProductEditor analyzing={state.analyzing} focusedIssue={focusedIssue?.productId === p.id ? focusedIssue : null} product={p} scope={scope} preview={preview} onSaved={async () => { await state.refresh(); setFocusedIssue(null); setEditing(null); }} />}
            </div>)}
          </fieldset>
        </>}
        {state.result && <div role="status" className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm">{state.result.downloadUrl && <p>Descarga preparada: <a href={state.result.downloadUrl} className="text-indigo-700 underline">{state.result.fileName}</a>. Enlace válido durante 15 minutos.</p>}{state.result.failures.map(f => <p key={f.marketplaceId} className="whitespace-pre-line text-red-700">{f.marketplaceId}: {f.message}</p>)}{state.result.skippedProducts?.length ? <div className="space-y-1 text-amber-800"><p className="font-medium">Omitidos por requisitos pendientes ({state.result.skippedProducts.length}):</p>{state.result.skippedProducts.map(item => <p key={`${item.marketplaceId}-${item.productId}`} className="text-xs">{item.marketplaceId} · {item.productName}: {item.reasons[0]}</p>)}</div> : null}{state.result.failures.length > 0 && <p className="text-xs text-slate-500">Los destinos que fallaron quedan seleccionados para un reintento explícito. Los archivos válidos ya están disponibles.</p>}</div>}
      </div><footer className="shrink-0 border-t border-slate-200 bg-slate-50 p-5 sm:p-6"><p id="marketplace-download-help" className="mb-3 text-xs text-slate-500">Al pulsar Descargar, autorizas crear enlaces públicos para las fotos aprobadas que necesiten los destinos elegidos. Recibirás un Excel (XLSX) o un ZIP si se generan varios archivos.</p><label className="mb-3 flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={state.skipBlocked} disabled={state.busy} onChange={event => state.setSkipBlocked(event.target.checked)} />Omitir productos con requisitos pendientes y exportar solo los listos</label><div className="flex items-center justify-between gap-3"><span className="text-xs font-medium">{state.selected.length} destinos seleccionados</span><Button icon={Download} aria-describedby="marketplace-download-help" loading={state.busy} disabled={state.loading || !canDownload} onClick={() => void state.download()}>{state.busy ? 'Preparando descarga…' : state.result?.failures.length ? 'Descargar / reintentar fallidos' : 'Descargar'}</Button></div></footer>
    </div>
  </dialog>;
}
export function MarketplaceExportAction({ scope }: { key?: string; scope: MarketplaceExportScope }) {
  const [open, setOpen] = useState(false); const key = JSON.stringify(scope);
  useEffect(() => setOpen(false), [key]);
  return <><Button icon={Download} onClick={() => setOpen(true)}>Exportar a marketplaces</Button>{open && <MarketplaceExportDrawer key={key} scope={scope} onClose={() => setOpen(false)} />}</>;
}
