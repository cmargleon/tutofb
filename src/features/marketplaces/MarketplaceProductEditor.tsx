import { canUseSpreadsheetTemplate, isSpreadsheetTemplateActive } from '../../../shared/src/types';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { MasterProduct, MarketplaceExportIssue, MarketplaceExportPreview, MarketplaceExportScope, ProductDraftInput, PublishedMarketplaceImage, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { MARKETPLACES, type MarketplaceId } from '../../../shared/src/marketplaces';
import { isMarketplaceSquareField, marketplaceSquareCandidates, MARKETPLACE_ADAPTERS } from '../../../shared/src/marketplaceExport/adapters';
import { ProductDraftEditor } from '../../components/product-drafts/ProductDraftEditor';
import { Button, INPUT_CLASS, ImageThumb } from '../../components/ui';
import { saveMasterProduct } from './exportFirebase';
import { useMarketplaceImagePublication } from './useMarketplaceImagePublication';
import { masterCategory, variantCategory } from '../catalog/productFields';
const variantFieldByIssue: Partial<Record<string, string>> = {
  weight_unit: 'weightUnit', dimension_unit: 'dimensionUnit', duplicate_sku: 'sku', variants: 'sku',
};

function focusRequirement(editor: HTMLElement, issue: MarketplaceExportIssue) {
  const channel = editor.querySelector<HTMLDetailsElement>(`[data-export-channel="${issue.marketplaceId}"]`);
  const variant = issue.variantId ? `[data-draft-row="${CSS.escape(issue.variantId)}"]` : '';
  const findField = (section: Element | null, field: string) =>
    section?.querySelector<HTMLElement>(`[data-draft-field="${CSS.escape(field)}"]${variant}:is(summary, :enabled)`);
  const variantField = variantFieldByIssue[issue.code]
    || (issue.code === 'catalog_identifier' ? (issue.marketplaceId === 'amazon' ? 'asin' : 'catalogId') : undefined);
  let target = issue.field ? findField(channel, issue.field) : undefined;
  if (!target && variantField) target = findField(editor.querySelector('[data-export-variants]'), variantField);
  if (!target && issue.code === 'gtin_authorization') target = findField(channel, 'gtinExemption');
  if (!target && issue.code === 'organizer_identity') target = editor.querySelector<HTMLElement>('[data-export-identity]');
  if (!target && (issue.code.startsWith('gallery_') || issue.code === 'images_pending')) {
    target = channel?.querySelector<HTMLElement>('[data-export-photos]');
  }
  if (!target && issue.code === 'category') target = channel?.querySelector<HTMLElement>('[data-export-category]');
  target ||= channel?.querySelector<HTMLElement>('[data-export-template]');
  target ||= channel?.querySelector<HTMLElement>('summary') || editor.querySelector<HTMLElement>('input:enabled');
  if (!target) return;
  for (let details = target.closest('details'); details && editor.contains(details); details = details.parentElement?.closest('details') || null) {
    details.open = true;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center' });
}

/** Warning beside a field whose Gemini option is uncertain; the reason shows on hover, keyboard focus or tap. */
function AutofillWarning({ reason }: { reason: string }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <span className="relative shrink-0 pt-2" onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false); }}>
    <button type="button" aria-label="Sugerencia de Gemini con poca certeza" aria-describedby={id} aria-expanded={open}
      className="rounded text-amber-600 hover:text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
    </button>
    <span role="tooltip" id={id} hidden={!open} className="absolute right-0 top-full z-30 mt-1 w-72 max-w-[80vw] rounded-lg border border-amber-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-lg">{reason}</span>
  </span>;
}

export const MarketplaceProductEditor = ({ product, preview, scope, focusedIssue, analyzing = false, onSaved }: {
  product: MasterProduct;
  analyzing?: boolean;
  preview: MarketplaceExportPreview;
  scope: MarketplaceExportScope;
  focusedIssue: MarketplaceExportIssue | null;
  onSaved: () => Promise<void>;
}) => {
  const [value, setValue] = useState(product); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [publicUrlsAuthorized, setPublicUrlsAuthorized] = useState(false);
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const editor = useRef<HTMLFieldSetElement>(null);
  const editedCategories = useRef(new Set<MarketplaceId>());
  const editedCopyFields = useRef(new Set<'name' | 'description'>());
  // A finished Gemini analysis refreshes the suggestions without discarding the operator's unsaved edits.
  useEffect(() => {
    setValue(current => {
      const values = { ...current.values };
      for (const field of ['name', 'description'] as const) {
        const suggestion = product.values[field];
        if (product.evidence[field]?.source === 'ai' && suggestion && !editedCopyFields.current.has(field)) {
          values[field] = suggestion;
        }
      }
      const marketplaces = { ...current.marketplaces };
      for (const channel of Object.keys(product.marketplaceCategorySuggestions || {}) as MarketplaceId[]) {
        if (!editedCategories.current.has(channel) && !marketplaces[channel]?.categoryId) {
          marketplaces[channel] = { ...product.marketplaces[channel]!, ...marketplaces[channel],
            templateId: product.marketplaces[channel]!.templateId, categoryId: product.marketplaces[channel]!.categoryId };
        }
      }
      return { ...current, values, marketplaces, marketplaceAutofill: product.marketplaceAutofill, marketplaceSquares: product.marketplaceSquares, evidence: { ...current.evidence, ...product.evidence } };
    });
  }, [product]);
  useLayoutEffect(() => {
    if (editor.current && focusedIssue) focusRequirement(editor.current, focusedIssue);
  }, [focusedIssue]);
  const publication = useMarketplaceImagePublication(scope, product.id, (channel, images) => setValue(current => ({
    ...current,
    publishedImages: { ...current.publishedImages, [channel]: { ...current.publishedImages?.[channel], ...Object.fromEntries(images.map(image => [image.outputId, image])) } },
    marketplaces: { ...current.marketplaces, [channel]: { ...current.marketplaces[channel]!, imageUrls: { ...current.marketplaces[channel]?.imageUrls, ...Object.fromEntries(images.map(image => [image.outputId, image.url])) } } },
  })));
  const draft = (categoryId: string, rows: ProductDraftInput['rows']): ProductDraftInput => ({ garmentId: value.id, garmentName: value.values.name || value.garmentId, categoryId, categoryName: categoryId, rows });
  const patchChannel = (id: MarketplaceId, patch: Partial<NonNullable<MasterProduct['marketplaces'][MarketplaceId]>>) => setValue(current => ({ ...current, marketplaces: { ...current.marketplaces, [id]: { ...current.marketplaces[id], ...patch } } }));
  const changeMasterValues = (nextValues: MasterProduct['values']) => {
    for (const field of ['name', 'description'] as const) {
      if ((value.values[field] || '') !== (nextValues[field] || '')) editedCopyFields.current.add(field);
    }
    const current = value.marketplaces.amazon;
    const requirements = current?.requirements;
    const changedBrandOrCategory = nextValues.brand !== value.values.brand || nextValues.category !== value.values.category;
    setValue({ ...value, values: nextValues, ...(changedBrandOrCategory && requirements && preview.channels.some(c => c.marketplaceId === 'amazon') ? { marketplaces: { ...value.marketplaces, amazon: { ...current, requirements: { ...requirements, gtinExemptionByVariant: Object.fromEntries(Object.keys(requirements.gtinExemptionByVariant || {}).map(id => [id, 'pending'])) } } } } : {}) });
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { await saveMasterProduct({ ...scope, productId: value.id, expectedRevision: product.revision, organizerSourceRevision: product.organizer?.revision, confirmOrganizerIdentity: confirmIdentity, authorizePublicImages: publicUrlsAuthorized, values: value.values, variants: value.variants, marketplaces: Object.fromEntries(Object.entries(value.marketplaces).filter(([id]) => preview.channels.some(c => c.marketplaceId === id))) }); await onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <fieldset ref={editor} disabled={busy || publication.busyChannel !== null} className="space-y-5 border-t border-slate-200 pt-4">
    {product.organizer?.source.issue && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p>{product.organizer.source.issue}</p>
      {product.organizer.source.pendingCommercialLink ? <p className="mt-2">Vincula el grupo SINCOD a una fila del Excel desde los avisos del lote en Catálogo o desde Organizador; la confirmación manual no aplica a estas fotos.</p>
        : product.organizer.confirmedIdentity ? <p className="mt-2">Identidad confirmada en Catálogo.</p> : <label className="mt-2 flex gap-2">
        <input data-export-identity type="checkbox" checked={confirmIdentity} onChange={event => setConfirmIdentity(event.target.checked)} />
        Verifiqué el SKC o SKU y la correspondencia de las fotos para cada variante que guardo.
      </label>}
    </div>}
    <p className="text-xs text-slate-500">Los campos desconocidos permanecen vacíos. Indica moneda y unidades explícitamente; las asociaciones de la plantilla deben usar las mismas unidades. Las correcciones se comparten entre destinos.</p>
    <ProductDraftEditor categories={[masterCategory]} drafts={[draft(masterCategory.id!, [{ id: value.id, values: value.values }])]} layout="form" multilineFields={['description']} renderFieldNote={(_, column) => {
      const field = column.key;
      return (field === 'name' || field === 'description') && value.evidence[field]?.source === 'ai' && !editedCopyFields.current.has(field)
        ? <p className="mt-1 text-xs text-slate-500">Sugerencia de Gemini</p> : null;
    }} showDraftTabs={false} showSummaryCard={false} showGeneratedImagesSummary={false} showAddRowButton={false} showRowActions={false} onChangeRows={(_, rows) => changeMasterValues(rows[0].values)} />
    <details data-export-variants><summary className="cursor-pointer text-sm font-semibold">Variantes · {value.variants.length}</summary><ProductDraftEditor categories={[variantCategory]} drafts={[draft(variantCategory.id!, value.variants.map(v => ({ id: v.id, values: v.values })))]} showDraftTabs={false} showSummaryCard={true} showGeneratedImagesSummary={false} onChangeRows={(_, rows) => setValue({ ...value, variants: rows.map(r => ({ id: r.id, values: r.values, attributes: value.variants.find(v => v.id === r.id)?.attributes || {} })), marketplaces: Object.fromEntries(Object.entries(value.marketplaces as MasterProduct['marketplaces']).map(([id, data]) => [id, !preview.channels.some(c => c.marketplaceId === id) ? data : { ...data, rows: data.rows?.filter(r => rows.some(v => v.id === r.id)), ...(data.requirements ? { requirements: { ...data.requirements, gtinExemptionByVariant: Object.fromEntries(Object.entries(data.requirements.gtinExemptionByVariant || {}).filter(([variantId]) => rows.some(row => row.id === variantId))) } } : {}) }])) })} /></details>
    {preview.channels.map(channel => {
      const id = channel.marketplaceId; const data = value.marketplaces[id];
      const templates = preview.templates.filter(t => t.exportConfig?.marketplaceId === id && canUseSpreadsheetTemplate(t, t.id === product.marketplaces[id]?.templateId) && t.exportConfig.validationStatus === 'compatible');
      const categories = preview.categories.filter(c => c.templateId === data?.templateId); const category = categories.find(c => c.id === data?.categoryId);
      const template = templates.find(t => t.id === data?.templateId);
      const original = product.marketplaces[id];
      const sameTemplate = data?.templateId === original?.templateId && data?.categoryId === original?.categoryId;
      const projection = sameTemplate ? value : { ...value, marketplaceAutofill: { ...value.marketplaceAutofill, [id]: undefined } };
      // The form, validation and workbook share this projection: overrides first, then Gemini's options.
      const adapted = category && template ? MARKETPLACE_ADAPTERS[id].prepare(projection, template, category) : undefined;
      const resolvedValuesByRow = Object.fromEntries((adapted?.rows || []).map(row => [row.variantId, row.values]));
      const autofillRows = sameTemplate ? value.marketplaceAutofill?.[id] || [] : [];
      const notices = new Set(adapted?.issues.filter(issue => ['verify_suggestion', 'autofill_failed', 'required'].includes(issue.code))
        .map(issue => JSON.stringify([issue.code, issue.variantId, issue.field])));
      const draftRows = value.variants.map(variant => ({ id: variant.id, values: data?.rows?.find(row => row.id === variant.id)?.values || {} }));
      return <details key={id} data-export-channel={id} className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{MARKETPLACES.find(m => m.id === id)?.name} · plantilla y datos de salida</summary><div className="mt-4 space-y-4">
        <label className="block text-xs font-medium">Plantilla<select data-export-template className={INPUT_CLASS} value={data?.templateId || ''} onChange={e => { editedCategories.current.add(id); const suggested = product.marketplaceCategorySuggestions?.[id]; patchChannel(id, { templateId: e.target.value, categoryId: suggested?.templateId === e.target.value ? suggested.categoryId : '', rows: [], imageUrls: { ...Object.fromEntries(Object.values((value.publishedImages?.[id] || {}) as Record<string, PublishedMarketplaceImage>).map(image => [image.outputId, image.url])), ...data?.imageUrls }, ...(id === 'amazon' ? { requirements: { gtinExemptionByVariant: {} } } : {}) }); }}><option value="">Seleccionar plantilla</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · v{t.exportConfig!.version}{!isSpreadsheetTemplateActive(t) ? ' · Histórica vinculada' : ''}</option>)}</select></label>
        {data?.templateId && <label className="block text-xs font-medium">Categoría<select data-export-category className={INPUT_CLASS} value={data.categoryId} onChange={e => { editedCategories.current.add(id); patchChannel(id, { categoryId: e.target.value, rows: [], ...(id === 'amazon' ? { requirements: { gtinExemptionByVariant: {} } } : {}) }); }}><option value="">Seleccionar categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {category && product.marketplaceCategorySuggestions?.[id]?.categoryId === category.id
          && product.marketplaceCategorySuggestions?.[id]?.templateId === data?.templateId && !editedCategories.current.has(id)
          && <p className="text-xs text-indigo-800">Categoría sugerida por Gemini. {product.marketplaceCategorySuggestions?.[id]?.reason}</p>}
        {data && category && id === 'amazon' && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">Exenciones de GTIN de Amazon. Confirma la aprobación externamente para esta marca/categoría; este requisito no se comparte con otros destinos.</p>{value.variants.map(variant => <label key={variant.id} className="block text-xs">Exención · {variant.values.sku || variant.id}<select data-draft-field="gtinExemption" data-draft-row={variant.id} className={INPUT_CLASS} value={data.requirements ? data.requirements.gtinExemptionByVariant?.[variant.id] || '' : variant.values.gtinExemption || ''} onChange={e => { const next = { ...data.requirements?.gtinExemptionByVariant }; if (e.target.value) next[variant.id] = e.target.value as 'pending' | 'approved'; else delete next[variant.id]; patchChannel(id, { requirements: { gtinExemptionByVariant: next, brandSnapshot: value.values.brand || '', categoryIdSnapshot: data.categoryId } }); }}><option value="">Sin exención confirmada</option><option value="pending">Pendiente de autorización externa</option><option value="approved">Aprobada externamente para Amazon</option></select></label>)}</div>}
        {data && category && <><p className="text-xs text-slate-500">Las opciones de Gemini ya están seleccionadas y se incluirán en el Excel. El icono de advertencia indica poca certeza; un cambio manual tiene prioridad y se aplica solo a este destino.</p>
          {analyzing && <p role="status" className="flex items-center gap-2 text-xs text-indigo-800"><Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />Analizando con Gemini…</p>}
          <ProductDraftEditor categories={[category]} drafts={[draft(category.id!, draftRows)]} resolvedValuesByRow={resolvedValuesByRow}
            layout="form" showDraftTabs={false} showSummaryCard={false} showGeneratedImagesSummary={false} showAddRowButton={false} showRowActions={false}
            onChangeRows={(_, rows) => patchChannel(id, { rows })}
            renderCustomField={(row, column) => {
              if (!isMarketplaceSquareField(id, column.key)) return null;
              const square = sameTemplate ? value.marketplaceSquares?.[row.id] : undefined;
              return <div data-draft-field={column.key} data-draft-row={row.id} tabIndex={-1} className="space-y-1.5">
                {square && <div className="h-20 w-20"><ImageThumb storagePath={square.storagePath} alt={column.label} fit="contain" previewOnClick /></div>}
                {square?.url ? <input aria-label={column.label} className={INPUT_CLASS} readOnly value={square.url} /> :
                  <p className="text-xs text-slate-500">{square ? 'El enlace se completa al descargar.' :
                    analyzing ? 'Preparando la foto cuadrada…' :
                    !marketplaceSquareCandidates(value, row.id).length ? 'Falta una foto aprobada.' : 'Se prepara automáticamente para la descarga.'}</p>}
              </div>;
            }}
            renderFieldAdornment={(row, column) => {
              if (!notices.has(JSON.stringify(['verify_suggestion', row.id, column.key]))) return null;
              const reason = autofillRows.find(item => item.id === row.id)?.reasons?.[column.key];
              return <AutofillWarning reason={`Gemini sugiere «${resolvedValuesByRow[row.id]?.[column.key]}» con poca certeza.${reason ? ` ${reason}` : ''}`} />;
            }}
            renderFieldNote={(row, column) => {
              const failure = autofillRows.find(item => item.id === row.id)?.failures?.[column.key];
              if (!failure || resolvedValuesByRow[row.id]?.[column.key]
                || !['autofill_failed', 'required'].some(code => notices.has(JSON.stringify([code, row.id, column.key])))) return null;
              return <p className="mt-1 text-xs text-amber-800">Pendiente: {failure}</p>;
            }} />
          {value.photoAssignments && <div className="rounded-lg border p-3 text-xs"><p className="font-medium">Selección del plan por variante y posición</p>{value.photoAssignments.filter(a => a.channel === id).sort((a, b) => a.variantId.localeCompare(b.variantId) || a.position - b.position).map(a => <p key={`${a.variantId}-${a.position}`}>{a.variantId} · {a.role === 'main' ? 'Portada' : `Foto ${a.position}`} · {a.eligible ? 'Validada' : a.required ? 'Obligatoria pendiente' : 'Pendiente'}{a.eligible && value.photoAssignments!.filter(other => other.outputId === a.outputId && other.eligible).length > 1 ? ' · compartida con otros destinos' : ''}</p>)}</div>}
          <div data-export-photos tabIndex={-1} className="rounded-lg bg-slate-50 p-3 text-xs"><p>{value.approvedImages.length} imágenes aprobadas · {value.pendingImages} pendientes</p><p className="mt-2">Los enlaces que falten se crean al descargar el Excel. Si necesitas copiarlos antes, puedes prepararlos aquí o registrar enlaces de tu propio alojamiento. Cualquier persona con el enlace puede ver la copia publicada.</p>
            <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={publicUrlsAuthorized} onChange={e => setPublicUrlsAuthorized(e.target.checked)} />Autorizo publicar copias de estas fotografías aprobadas y usar sus URL públicas en marketplaces.</label>
            <Button className="mt-3" size="sm" disabled={!publicUrlsAuthorized || !value.approvedImages.length} loading={publication.busyChannel === id} onClick={() => void publication.publish(id, publicUrlsAuthorized)}>Preparar URL para {MARKETPLACES.find(m => m.id === id)?.name}</Button>
            <p className="mt-2 text-slate-500">Las copias se preparan en JPG. Revisa también los requisitos de contenido, categoría e imagen principal del destino.</p>
            {Object.entries((data.imageUrls || {}) as Record<string, string>).filter(([outputId]) => !value.approvedImages.some(img => img.outputId === outputId)).map(([outputId]) => <p key={outputId} className="mt-2 text-amber-800">La imagen vinculada {outputId} ya no está aprobada. Su URL no se exportará. <Button variant="ghost" size="sm" onClick={() => { const next = { ...data.imageUrls }; delete next[outputId]; patchChannel(id, { imageUrls: next }); }}>Retirar URL anterior</Button></p>)}
            {value.approvedImages.filter(img => !value.photoAssignments || value.photoAssignments.some(a => a.channel === id && a.outputId === img.outputId && a.eligible)).map((img, i) => <div key={img.outputId} className="mt-3"><span className="mb-2 block h-24 w-20"><ImageThumb storagePath={img.storagePath} alt={`Foto aprobada ${i + 1}`} fit="contain" /></span><label className="block">URL pública · foto aprobada {i + 1}<input className={INPUT_CLASS} type="url" disabled={!publicUrlsAuthorized} placeholder="Se completa al descargar" value={data.imageUrls?.[img.outputId] || ''} onChange={e => patchChannel(id, { imageUrls: { ...data.imageUrls, [img.outputId]: e.target.value } })} /></label>{data.imageUrls?.[img.outputId] && <div className="mt-2 flex items-center gap-3"><Button variant="ghost" size="sm" onClick={() => void publication.copyUrl(data.imageUrls![img.outputId])}>Copiar URL</Button><a className="text-indigo-700 underline" href={data.imageUrls[img.outputId]} target="_blank" rel="noopener noreferrer">Abrir imagen publicada</a></div>}</div>)}
          </div></>}
      </div></details>;
    })}
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Procedencia y sugerencias de IA</summary>
      {Object.entries(value.organizer?.source.origins || {}).flatMap(([id, rows]) => rows.map(row => <p className="mt-2 break-words" key={`${id}-${row.fileId}-${row.tab}-${row.row}`}>{value.variants.find(v => v.id === id)?.values.skc || value.variants.find(v => v.id === id)?.values.sku || ''} · {row.fileName} · versión {row.version} · {row.tab} · fila {row.row}</p>))}
      {value.organizer?.category && <p className="mt-2">{value.organizer.category.marketplaceId} · {value.organizer.category.categoryId || 'Categoría pendiente'}{value.organizer.category.version && ` · plantilla v${value.organizer.category.version}`} · confianza {value.organizer.category.confidence ?? 'no disponible'} · {value.organizer.category.reason}</p>}
      {Object.entries(value.evidence as MasterProduct['evidence']).map(([key, e]) => <p className="mt-2 break-words" key={key}>{key}: {e.original} · {e.source} · confianza {e.confidence ?? 'no disponible'}</p>)}
    </details>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {publication.error && <p role="alert" className="whitespace-pre-line text-sm text-red-700">{publication.error}</p>}
    <Button size="sm" loading={busy} onClick={() => void save()}>Guardar y volver a validar</Button>
  </fieldset>;
};
