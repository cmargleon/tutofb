import React, { useLayoutEffect, useRef, useState } from 'react';
import type { MasterProduct, MarketplaceExportIssue, MarketplaceExportPreview, MarketplaceExportScope, ProductDraftInput, PublishedMarketplaceImage, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { PRODUCT_FIELDS, VARIANT_FIELDS } from '../../../shared/src/types';
import { MARKETPLACES, type MarketplaceId } from '../../../shared/src/marketplaces';
import { MARKETPLACE_ADAPTERS } from '../../../shared/src/marketplaceExport/adapters';
import { ProductDraftEditor } from '../../components/product-drafts/ProductDraftEditor';
import { Button, INPUT_CLASS, ImageThumb } from '../../components/ui';
import { saveMasterProduct } from './exportFirebase';
import { useMarketplaceImagePublication } from './useMarketplaceImagePublication';
const labels: Record<string, string> = { name: 'Nombre', description: 'Descripción', brand: 'Marca', category: 'Categoría conceptual', sku: 'SKU interno', material: 'Material', composition: 'Composición', price: 'Precio', currency: 'Moneda (código ISO)', weightUnit: 'Unidad de peso', dimensionUnit: 'Unidad de dimensiones', inventory: 'Inventario', weight: 'Peso', length: 'Largo', width: 'Ancho', height: 'Alto', color: 'Color', size: 'Talla', gtin: 'GTIN / EAN / UPC', asin: 'ASIN', catalogId: 'ID de catálogo', spu: 'SPU', skc: 'SKC', parentSku: 'SKU padre', parentage: 'Relación (parent / child)', relationshipType: 'Tipo de relación', variationTheme: 'Tema de variante', gtinExemption: 'Exención GTIN (pending / approved)' };
const categoryFor = (id: string, fields: readonly string[]): SpreadsheetTemplateCategory => ({ id, templateId: '', clientId: '', sheetName: id, label: id, rowStart: 1, attributes: [], columns: fields.map((key, index) => ({ key, label: labels[key] || key, index, letter: String(index), required: false, requirementLabel: null, guidance: null, validation: null })), createdAt: null, updatedAt: null });
const masterCategory = categoryFor('producto-maestro', PRODUCT_FIELDS); const variantCategory = categoryFor('variantes', VARIANT_FIELDS.filter(field => field !== 'gtinExemption'));
const variantFieldByIssue: Partial<Record<string, string>> = {
  weight_unit: 'weightUnit', dimension_unit: 'dimensionUnit', duplicate_sku: 'sku', variants: 'sku',
};

function focusRequirement(editor: HTMLElement, issue: MarketplaceExportIssue) {
  const channel = editor.querySelector<HTMLDetailsElement>(`[data-export-channel="${issue.marketplaceId}"]`);
  const variant = issue.variantId ? `[data-draft-row="${CSS.escape(issue.variantId)}"]` : '';
  const findField = (section: Element | null, field: string) =>
    section?.querySelector<HTMLElement>(`[data-draft-field="${CSS.escape(field)}"]${variant}:enabled`);
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

export const MarketplaceProductEditor = ({ product, preview, scope, focusedIssue, onSaved }: {
  product: MasterProduct;
  preview: MarketplaceExportPreview;
  scope: MarketplaceExportScope;
  focusedIssue: MarketplaceExportIssue | null;
  onSaved: () => Promise<void>;
}) => {
  const [value, setValue] = useState(product); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [publicUrlsAuthorized, setPublicUrlsAuthorized] = useState(false);
  const [confirmIdentity, setConfirmIdentity] = useState(false);
  const editor = useRef<HTMLFieldSetElement>(null);
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
      {product.organizer.confirmedIdentity ? <p className="mt-2">Identidad confirmada en Catálogo.</p> : <label className="mt-2 flex gap-2">
        <input data-export-identity type="checkbox" checked={confirmIdentity} onChange={event => setConfirmIdentity(event.target.checked)} />
        Verifiqué el SKC o SKU y la correspondencia de las fotos para cada variante que guardo.
      </label>}
    </div>}
    <p className="text-xs text-slate-500">Los campos desconocidos permanecen vacíos. Indica moneda y unidades explícitamente; las asociaciones de la plantilla deben usar las mismas unidades. Las correcciones se comparten entre destinos.</p>
    <ProductDraftEditor categories={[masterCategory]} drafts={[draft(masterCategory.id!, [{ id: value.id, values: value.values }])]} layout="form" showDraftTabs={false} showSummaryCard={false} showGeneratedImagesSummary={false} showAddRowButton={false} showRowActions={false} onChangeRows={(_, rows) => changeMasterValues(rows[0].values)} />
    <details data-export-variants><summary className="cursor-pointer text-sm font-semibold">Variantes · {value.variants.length}</summary><ProductDraftEditor categories={[variantCategory]} drafts={[draft(variantCategory.id!, value.variants.map(v => ({ id: v.id, values: v.values })))]} showDraftTabs={false} showSummaryCard={true} showGeneratedImagesSummary={false} onChangeRows={(_, rows) => setValue({ ...value, variants: rows.map(r => ({ id: r.id, values: r.values, attributes: value.variants.find(v => v.id === r.id)?.attributes || {} })), marketplaces: Object.fromEntries(Object.entries(value.marketplaces as MasterProduct['marketplaces']).map(([id, data]) => [id, !preview.channels.some(c => c.marketplaceId === id) ? data : { ...data, rows: data.rows?.filter(r => rows.some(v => v.id === r.id)), ...(data.requirements ? { requirements: { ...data.requirements, gtinExemptionByVariant: Object.fromEntries(Object.entries(data.requirements.gtinExemptionByVariant || {}).filter(([variantId]) => rows.some(row => row.id === variantId))) } } : {}) }])) })} /></details>
    {preview.channels.map(channel => {
      const id = channel.marketplaceId; const data = value.marketplaces[id];
      const templates = preview.templates.filter(t => t.exportConfig?.marketplaceId === id && (t.status !== 'archived' || (t.id === data?.templateId && !!t.exportConfig.supersededByTemplateId)) && t.exportConfig.validationStatus === 'compatible');
      const categories = preview.categories.filter(c => c.templateId === data?.templateId); const category = categories.find(c => c.id === data?.categoryId);
      const template = templates.find(t => t.id === data?.templateId);
      const resolvedRows = category && template ? MARKETPLACE_ADAPTERS[id].prepare(value, template, category).rows : [];
      const resolvedValuesByRow = Object.fromEntries(resolvedRows.map(row => [row.variantId, row.values]));
      return <details key={id} data-export-channel={id} className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{MARKETPLACES.find(m => m.id === id)?.name} · plantilla y datos de salida</summary><div className="mt-4 space-y-4">
        <label className="block text-xs font-medium">Plantilla<select data-export-template className={INPUT_CLASS} value={data?.templateId || ''} onChange={e => { const c = preview.categories.find(c => c.templateId === e.target.value); patchChannel(id, { templateId: e.target.value, categoryId: c?.id || '', rows: [], imageUrls: { ...Object.fromEntries(Object.values((value.publishedImages?.[id] || {}) as Record<string, PublishedMarketplaceImage>).map(image => [image.outputId, image.url])), ...data?.imageUrls }, ...(id === 'amazon' ? { requirements: { gtinExemptionByVariant: {} } } : {}) }); }}><option value="">Seleccionar plantilla</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · v{t.exportConfig!.version}{t.status === 'archived' ? ' · Histórica vinculada' : ''}</option>)}</select></label>
        {data?.templateId && <label className="block text-xs font-medium">Categoría<select data-export-category className={INPUT_CLASS} value={data.categoryId} onChange={e => patchChannel(id, { categoryId: e.target.value, rows: [], ...(id === 'amazon' ? { requirements: { gtinExemptionByVariant: {} } } : {}) })}><option value="">Seleccionar categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
        {data && category && id === 'amazon' && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">Exenciones de GTIN de Amazon. Confirma la aprobación externamente para esta marca/categoría; este requisito no se comparte con otros destinos.</p>{value.variants.map(variant => <label key={variant.id} className="block text-xs">Exención · {variant.values.sku || variant.id}<select data-draft-field="gtinExemption" data-draft-row={variant.id} className={INPUT_CLASS} value={data.requirements ? data.requirements.gtinExemptionByVariant?.[variant.id] || '' : variant.values.gtinExemption || ''} onChange={e => { const next = { ...data.requirements?.gtinExemptionByVariant }; if (e.target.value) next[variant.id] = e.target.value as 'pending' | 'approved'; else delete next[variant.id]; patchChannel(id, { requirements: { gtinExemptionByVariant: next, brandSnapshot: value.values.brand || '', categoryIdSnapshot: data.categoryId } }); }}><option value="">Sin exención confirmada</option><option value="pending">Pendiente de autorización externa</option><option value="approved">Aprobada externamente para Amazon</option></select></label>)}</div>}
        {data && category && <><p className="text-xs text-slate-500">El formulario muestra los valores que se exportarán. Si editas un campo aquí, el cambio se aplica a este destino.</p><ProductDraftEditor categories={[category]} drafts={[draft(category.id!, value.variants.map(v => ({ id: v.id, values: data.rows?.find(r => r.id === v.id)?.values || {} })))]} resolvedValuesByRow={resolvedValuesByRow} layout="form" showDraftTabs={false} showSummaryCard={false} showGeneratedImagesSummary={false} showAddRowButton={false} showRowActions={false} onChangeRows={(_, rows) => patchChannel(id, { rows })} />
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
