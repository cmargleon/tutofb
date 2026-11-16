import type { MarketplaceId } from '../marketplaces';
import type { MasterProduct, MasterVariant, MarketplaceExportIssue, ProductMarketplaceData, SpreadsheetTemplate, SpreadsheetTemplateCategory, TemplateColumnMapping } from '../types';
import { getProductDraftColumnAllowedValues } from '../utils/spreadsheetDraftColumns';

export const normalizeMarketplaceColumnKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
export function suggestedMarketplaceSource(marketplaceId: MarketplaceId, key: string) {
  const normalized = normalizeMarketplaceColumnKey(key);
  const aliases = MARKETPLACE_ADAPTERS[marketplaceId].aliases;
  if (aliases[normalized]) return aliases[normalized];
  if (marketplaceId !== 'shein') return '';
  const detail = normalized.match(/^detail_img_(10|[1-9])$/)?.[1];
  return detail ? `image.${detail}` : aliases[normalized.replace(/\[.*\]$/, '')] || '';
}
export interface AdaptedProduct {
  rows: Array<{ variantId: string; values: Record<string, string> }>;
  issues: MarketplaceExportIssue[];
  pendingImageOutputIds: string[];
}
export interface MarketplaceAdapter {
  id: MarketplaceId;
  aliases: Record<string, string>;
  prepare(product: MasterProduct, template: SpreadsheetTemplate, category: SpreadsheetTemplateCategory): AdaptedProduct;
}
const common: Record<string, string> = { nombre: 'product.name', descripcion: 'product.description', marca: 'product.brand', precio: 'variant.price', inventario: 'variant.inventory', talla: 'variant.size', name: 'product.name', description: 'product.description', brand: 'product.brand', sku: 'variant.sku', price: 'variant.price', inventory: 'variant.inventory', color: 'variant.color', size: 'variant.size', gtin: 'variant.gtin' };
export const isValidGtin = (value: string) => {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = [...value].map(Number); const check = digits.pop();
  return (10 - digits.reverse().reduce((sum, n, i) => sum + n * (i % 2 === 0 ? 3 : 1), 0) % 10) % 10 === check;
};
export const safePublicImageUrl = (value: string, publishedUrls: readonly string[] = []) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return false;
    // Google URLs are accepted only when resolved from this product's server-owned publication registry.
    if (url.hostname === 'storage.googleapis.com') return publishedUrls.includes(value)
      && /^\/[a-z0-9-]+\/images\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.jpg$/.test(url.pathname);
    return !/localhost|(^|\.)local$|firebase|googleapis|drive\.google|cloudfunctions|127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|\[|^0\./i.test(url.hostname);
  } catch { return false; }
};
export const isImageField = (key: string) => /(?:img|image|foto|picture|imagen)/i.test(key);
const approvedImageOutputId = (product: MasterProduct, channel: MarketplaceId, variantId: string, source?: string) => {
  const match = source?.match(/^image\.(\d+)$/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!product.photoAssignments) return product.approvedImages[index]?.outputId;
  const assignment = product.photoAssignments.find(a => a.channel === channel && a.variantId === variantId && a.position === index + 1 && a.eligible);
  return product.approvedImages.find(image => image.outputId === assignment?.outputId)?.outputId;
};
const sourceValue = (source: string, p: MasterProduct, v: MasterVariant, data: ProductMarketplaceData, rowIndex: number, template: SpreadsheetTemplate) => {
  const [kind, ...parts] = source.split('.'); const key = parts.join('.');
  if (kind === 'product') return p.values[key as keyof typeof p.values] ?? '';
  if (kind === 'variant') return v.values[key as keyof typeof v.values] ?? p.values[key as keyof typeof p.values] ?? '';
  if (kind === 'attribute') return v.attributes?.[key] ?? '';
  if (kind === 'literal') return key;
  if (kind === 'assignment') { const main = p.photoAssignments?.find(a => a.channel === template.exportConfig?.marketplaceId && a.variantId === v.id && a.position === 1 && a.eligible); return key === 'imageType' ? String(main?.imageType ?? '') : key === 'imageSort' ? String(main?.imageSort ?? '') : ''; }
  if (kind === 'legacy') {
    const draft = p.legacyDrafts.find(d => (d.templateId === data.templateId || d.templateId === template.exportConfig?.replacesTemplateId || template.exportConfig?.legacyTemplateIds?.includes(d.templateId)) && d.categoryId === data.categoryId);
    return draft?.rows[rowIndex]?.values[key] || '';
  }
  return '';
};
const createAdapter = (id: MarketplaceId, aliases: Record<string, string>): MarketplaceAdapter => ({
  id, aliases: { ...common, ...aliases },
  prepare(product, template, category) {
    category = { ...category, validationMode: 'template' };
    const issues: MarketplaceExportIssue[] = [];
    const pendingImageOutputIds = new Set<string>();
    const issue = (code: string, message: string, field?: string, variantId?: string, blocking = true) => issues.push({
      marketplaceId: id, productId: product.id, productName: product.values.name || product.garmentId, code, message,
      ...(field ? { field } : {}), ...(variantId ? { variantId } : {}),
      ...(blocking ? {} : { blocking: false as const }),
    });
    const data = product.marketplaces[id];
    if (!data || data.templateId !== template.id || data.categoryId !== category.id) { issue('category', 'Categoría sin configurar.'); return { rows: [], issues, pendingImageOutputIds: [] }; }
    if (!product.approvedImages.length) issue('images_pending', 'Imágenes pendientes de aprobación.');
    if (product.photoAssignments) for (const variant of product.variants) {
      const assignments = product.photoAssignments.filter(a => a.channel === id && a.variantId === variant.id).sort((a, b) => a.position - b.position);
      const eligible = assignments.filter(a => a.eligible && a.outputId);
      if (!assignments.some(a => a.role === 'main' && a.position === 1 && a.eligible) || assignments.some(a => a.required && !a.eligible)) issue('gallery_pending', `Variante ${variant.id}: portada o fotografía obligatoria pendiente para ${id}.`, undefined, variant.id);
      const limit = id === 'amazon' || id === 'tiktok-shop' ? 9 : id === 'shein' ? 11 : 10;
      if (eligible.length > limit) issue('gallery_limit', `La galería de ${variant.id} supera ${limit} imágenes.`, undefined, variant.id);
      if (new Set(eligible.map(a => a.outputId)).size !== eligible.length || new Set(assignments.map(a => a.position)).size !== assignments.length) issue('gallery_duplicate', `Archivo o posición repetida en ${variant.id}.`, undefined, variant.id);
      if (id === 'tiktok-shop' && new Set(eligible.map(a => a.angle)).size !== eligible.length) issue('gallery_angle', `Ángulo repetido en ${variant.id}.`, undefined, variant.id);
    }
    const mappings = template.exportConfig?.mappings[category.id!] || {};
    const dropdownColumns = category.columns.filter(column => column.dropdownOptions?.length || column.dropdownDependency || column.dropdownFormula)
      .sort((a, b) => Number(Boolean(a.dropdownDependency)) - Number(Boolean(b.dropdownDependency)));
    if (product.organizer && !Object.values(mappings).some(mapping => mapping.source === 'image.0'))
      issue('image_mapping', 'Asocia la portada aprobada a su columna de imagen principal en la plantilla.');
    const publishedUrls = Object.values(product.publishedImages?.[id] || {}).map(image => image.url);
    const nonemptySkus = product.variants.map(v => v.values.sku || product.values.sku || '').filter(Boolean);
    if (new Set(nonemptySkus).size !== nonemptySkus.length) issue('duplicate_sku', 'Las variantes deben tener SKU distintos; corrige los duplicados.');
    const rows = product.variants.map((variant, rowIndex) => {
      const rowIssue = (code: string, message: string, field?: string) => issue(code, message, field, variant.id);
      const overrides = data.rows?.find(r => r.id === variant.id)?.values || {};
      const autoRow = product.marketplaceAutofill?.[id]?.find(row => row.id === variant.id);
      const autofill = autoRow?.values || {};
      const tentative = new Set<string>();
      const imageOutputs = new Map<string, string>();
      const values: Record<string, string> = Object.fromEntries(category.columns.map(column => {
        const mapping = mappings[column.key];
        const imageSource = mapping?.source.startsWith('image.');
        const outputId = approvedImageOutputId(product, id, variant.id, mapping?.source);
        if (outputId) imageOutputs.set(column.key, outputId);
        if (Object.prototype.hasOwnProperty.call(overrides, column.key) && overrides[column.key].trim()) return [column.key, overrides[column.key]];
        const original = imageSource ? (outputId && data.imageUrls?.[outputId] || '') : sourceValue(mapping?.source || '', product, variant, data, rowIndex, template);
        const mapped = mapping?.valueMap && Object.prototype.hasOwnProperty.call(mapping.valueMap, original) ? mapping.valueMap[original] : original;
        return [column.key, mapped];
      }));
      // Normalize only an exact equivalent of a mapped value. Explicit overrides stay as entered.
      const autoFields = new Set([...Object.keys(autofill), ...(autoRow?.inferredFields || [])]);
      const columnsToResolve = autoFields.size
        ? [...dropdownColumns, ...category.columns.filter(column => autoFields.has(column.key) && !dropdownColumns.includes(column))]
        : dropdownColumns;
      const resolved = new Set<string>();
      const resolveOption = (column: SpreadsheetTemplateCategory['columns'][number]) => {
        if (resolved.has(column.key)) return;
        resolved.add(column.key);
        const parent = column.dropdownDependency && columnsToResolve.find(c => c.key === column.dropdownDependency?.columnKey);
        if (parent) resolveOption(parent);
        const value = values[column.key];
        if (Object.hasOwn(overrides, column.key) && overrides[column.key].trim()) return;
        const allowed = getProductDraftColumnAllowedValues(category, column, values);
        if (Object.hasOwn(autofill, column.key) && allowed.includes(autofill[column.key])) {
          values[column.key] = autofill[column.key];
          if (autoRow?.tentativeFields?.includes(column.key) || parent && tentative.has(parent.key)) tentative.add(column.key);
          return;
        }
        if (autoRow?.inferredFields.includes(column.key)) { values[column.key] = ''; return; }
        if (!value || allowed.includes(value)) return;
        const normalize = (text: string) => text.trim().normalize('NFC').toLowerCase();
        const matches = allowed.filter(option => normalize(option) === normalize(value));
        if (matches.length === 1) values[column.key] = matches[0];
      };
      columnsToResolve.forEach(resolveOption);
      for (const column of category.columns) {
        const mapping: TemplateColumnMapping | undefined = mappings[column.key];
        const value = values[column.key];
        const outputId = imageOutputs.get(column.key);
        const normalizedKey = normalizeMarketplaceColumnKey(column.key);
        // A valid low-certainty suggestion completes the field; it is reported only as a warning.
        if (tentative.has(column.key)) issue('verify_suggestion', `${column.label} (variante ${rowIndex + 1}): Gemini sugiere «${value}» con poca certeza.`
          + (autoRow?.reasons?.[column.key] ? ` ${autoRow.reasons[column.key]}` : ''), column.key, variant.id, false);
        const failure = !value.trim() && !Object.hasOwn(autofill, column.key) ? autoRow?.failures?.[column.key] : undefined;
        if (!value.trim() && outputId && !data.imageUrls?.[outputId]) {
          pendingImageOutputIds.add(outputId);
          continue;
        }
        if ((column.required || mapping?.required) && !value.trim()) rowIssue('required', `Falta ${column.label} en variante ${rowIndex + 1}.${failure ? ` ${failure}` : ''}`, column.key);
        else if (failure) issue('autofill_failed', `${column.label} (variante ${rowIndex + 1}) sigue pendiente. ${failure}`, column.key, variant.id, false);
        const allowed = getProductDraftColumnAllowedValues(category, column, values);
        if (value && allowed.length && !allowed.includes(value)) rowIssue('enum', `${column.label}: «${value}» no está en los valores permitidos.`, column.key);
        if (value && column.dropdownFormula && !allowed.length) rowIssue('unresolved_list', `${column.label}: lista dependiente sin resolver; requiere un adaptador específico.`, column.key);
        if (value && (isImageField(column.key) || isImageField(column.label) || mapping?.source.startsWith('image.')) && (!safePublicImageUrl(value, publishedUrls) || !product.approvedImages.some(img => data.imageUrls?.[img.outputId] === value))) rowIssue('image_url', `${column.label}: publica la fotografía aprobada o configura su URL pública permanente; las URLs privadas o temporales no son válidas.`, column.key);
        if (value && product.photoAssignments && mapping?.source.startsWith('image.') && value !== (outputId && data.imageUrls?.[outputId])) rowIssue('image_assignment', `${column.label}: imagen fuera de la asignación aprobada de variante/canal/posición.`, column.key);
        if (value && mapping?.dataType === 'number' && (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) rowIssue('number', `${column.label}: número inválido.`, column.key);
        if (value && (mapping?.source === 'variant.gtin' || /^(gtin|ean|upc|universal_product_code|codigo_universal)$/.test(normalizedKey)) && !isValidGtin(value)) rowIssue('gtin', `${column.label}: GTIN inválido; no se generará uno automáticamente.`, column.key);
        if (value && (mapping?.source === 'variant.asin' || normalizedKey === 'asin') && !/^[A-Z0-9]{10}$/.test(value)) rowIssue('asin', `${column.label}: ASIN inválido.`, column.key);
      }
      if (product.organizer) {
        const measurement = (key: string) => category.columns.some(c => mappings[c.key]?.source === `variant.${key}` && values[c.key]);
        if (measurement('weight') && !variant.values.weightUnit && !product.values.weightUnit)
          rowIssue('weight_unit', `Falta la unidad del peso en variante ${variant.values.sku || variant.values.skc || rowIndex + 1}.`);
        if (['length', 'width', 'height'].some(measurement) && !variant.values.dimensionUnit && !product.values.dimensionUnit)
          rowIssue('dimension_unit', `Falta la unidad de dimensiones en variante ${variant.values.sku || variant.values.skc || rowIndex + 1}.`);
      }
      if (id === 'mercado-libre' && template.exportConfig?.operation === 'existing_catalog') {
        if (!variant.values.catalogId || !category.columns.some(c => mappings[c.key]?.source === 'variant.catalogId' && values[c.key])) rowIssue('catalog_identifier', 'Vinculación a catálogo: falta el ID de catálogo y su asociación a la plantilla.');
      }
      if (id === 'amazon') {
        // Legacy input is read for compatibility; new corrections are scoped to the destination.
        const exemptionScopeMatches = !data.requirements || (data.requirements.brandSnapshot === (product.values.brand || '') && data.requirements.categoryIdSnapshot === data.categoryId);
        const gtinExemption = data.requirements ? (exemptionScopeMatches ? data.requirements.gtinExemptionByVariant?.[variant.id] : 'pending') : variant.values.gtinExemption;
        if (template.exportConfig?.operation === 'existing_catalog') {
          const hasIdentifier = category.columns.some(c => (mappings[c.key]?.source === 'variant.asin' && /^[A-Z0-9]{10}$/.test(values[c.key])) || (mappings[c.key]?.source === 'variant.gtin' && isValidGtin(values[c.key])));
          if (!hasIdentifier) rowIssue('catalog_identifier', 'La oferta requiere un ASIN o GTIN válido asociado a una columna de la plantilla.');
        }
        if (template.exportConfig?.operation === 'new_product' && variant.values.parentage !== 'parent' && !variant.values.gtin && gtinExemption !== 'approved') rowIssue('gtin_authorization', 'Ficha nueva: falta GTIN o confirmación de exención aprobada externamente.');
        if (gtinExemption && !['approved', 'pending'].includes(gtinExemption)) rowIssue('gtin_authorization', 'Estado de exención inválido; usa pending o approved tras verificarlo externamente.');
        if (product.variants.length > 1 && template.exportConfig?.operation === 'new_product' && (!variant.values.parentage || (variant.values.parentage === 'child' && !variant.values.parentSku))) rowIssue('variants', 'Configura las relaciones padre/hijo de las variantes.');
      }
      return { variantId: variant.id, values };
    });
    if (!rows.length) issue('variants', 'Faltan variantes.');
    return { rows, issues, pendingImageOutputIds: [...pendingImageOutputIds] };
  },
});
export const MARKETPLACE_ADAPTERS: Record<MarketplaceId, MarketplaceAdapter> = {
  shein: createAdapter('shein', { image_type: 'assignment.imageType', image_sort: 'assignment.imageSort', supplier_code: 'variant.spu', skc: 'variant.skc',
    sku_code: 'variant.sku', supplier_sku: 'variant.sku', goods_name: 'product.name', default_product_name: 'product.name',
    goods_description: 'product.description', default_product_desc: 'product.description', main_attribute_value: 'variant.color',
    secondary_attribute_1_value: 'variant.size', main_img: 'image.0', detail_img_1: 'image.1', stock: 'variant.inventory',
    original_price: 'variant.price', weight: 'variant.weight', weight_unit: 'variant.weightUnit', length: 'variant.length',
    width: 'variant.width', height: 'variant.height', length_unit: 'variant.dimensionUnit', quantity_number: 'variant.pack',
    attr_1000463: 'attribute.foodContactMaterial', transparencia: 'attribute.transparency' }),
  'mercado-libre': createAdapter('mercado-libre', { sku_del_vendedor: 'variant.sku', codigo_universal: 'variant.gtin', titulo: 'product.name', seller_sku: 'variant.sku', seller_custom_field: 'variant.sku', title: 'product.name', available_quantity: 'variant.inventory', catalog_product_id: 'variant.catalogId', picture: 'image.0' }),
  'tiktok-shop': createAdapter('tiktok-shop', { seller_sku: 'variant.sku', product_name: 'product.name', product_description: 'product.description', retail_price: 'variant.price', quantity: 'variant.inventory', main_image: 'image.0' }),
  amazon: createAdapter('amazon', { item_sku: 'variant.sku', item_name: 'product.name', brand_name: 'product.brand', product_description: 'product.description', standard_price: 'variant.price', quantity: 'variant.inventory', external_product_id: 'variant.gtin', asin: 'variant.asin', parent_sku: 'variant.parentSku', parent_child: 'variant.parentage', relationship_type: 'variant.relationshipType', variation_theme: 'variant.variationTheme', main_image_url: 'image.0' }),
};
