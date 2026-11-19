import type { DocumentReference } from 'firebase-admin/firestore';
import type {
  MasterVariant, OrganizerCategoryDecision, OrganizerCommercialSource, OrganizerPhoto, OrganizerProductRow,
  OrganizerSourceColumns, OrganizerSourceField, OrganizerVariant,
} from '../../../shared/src/types';
import { ORGANIZER_SOURCE_FIELDS } from '../../../shared/src/types';
import { CATALOG_HEADERS, code, distinct, normalize } from './catalog';
import { DECLARED_SHEET_ATTRIBUTE } from '../../../shared/src/marketplaceExport/adapters';
import { digest } from './drive';
import { getAppFirestore } from '../firebase/appFirestore';

export interface OrganizerCommercialLink {
  itemId: string;
  photos: { id: string; version: string }[];
  organizerVariantId: string | null;
  source: OrganizerCommercialSource;
  category?: OrganizerCategoryDecision | null;
  /** Canonical master product chosen by the base-code binding; aliases route this generation to it. */
  catalogBinding?: { productId: string; baseCode: string } | null;
}

export async function organizerReferenceViews(job: Pick<import('../../../shared/src/types').AutomationJob, 'id' | 'clientId' | 'organizerCommerce'>, itemId: string) {
  if (!job.organizerCommerce) return {};
  const db = getAppFirestore();
  const root = db.doc(`organizers/${job.clientId}`);
  const [config, link] = await Promise.all([root.get(), db.doc(`automationJobs/${job.id}/organizerCommerce/${itemId}`).get()]);
  const photos = (link.data() as OrganizerCommercialLink | undefined)?.photos || [];
  const minimum = config.get('minimumConfidence');
  if (typeof minimum !== 'number') return {};
  const accepted = await Promise.all(photos.map(async source => {
    const photo = await root.collection('photos').doc(source.id).get();
    const view = photo.get('view');
    const name = photo.get('name');
    if (photo.get('version') !== source.version || typeof name !== 'string' || !['front', 'back', 'side', 'detail'].includes(view) ||
        (photo.get('visualConfidence') ?? 0) < minimum || (photo.get('quality') ?? 0) < minimum) return null;
    return [name.slice(0, 200), view as 'front' | 'back' | 'side' | 'detail'] as const;
  }));
  return Object.fromEntries(accepted.filter(entry => entry && accepted.filter(other => other?.[0] === entry[0]).length === 1)
    .filter(entry => entry !== null));
}

const defaultHeaders: Record<OrganizerSourceField, string[]> = {
  price: ['PRECIO DE VENTA', 'PRECIO VENTA', 'PRECIO', 'SALE PRICE'],
  inventory: ['STOCK', 'INVENTARIO', 'EXISTENCIAS', 'INVENTORY'],
  weight: ['PESO', 'WEIGHT'], weightUnit: ['UNIDAD DE PESO', 'WEIGHT UNIT'],
  length: ['LARGO', 'LONGITUD', 'LENGTH'], width: ['ANCHO', 'WIDTH'], height: ['ALTO', 'ALTURA', 'HEIGHT'],
  dimensionUnit: ['UNIDAD DE DIMENSIONES', 'UNIDAD DE MEDIDA', 'DIMENSION UNIT'],
};
const unitPatterns = {
  weightUnit: /^(?:PESO|WEIGHT)\s*\((KG|G|LB|OZ)\)$/,
  dimensionUnit: /^(?:LARGO|LONGITUD|ANCHO|ALTO|ALTURA|LENGTH|WIDTH|HEIGHT)\s*\((MM|CM|M|IN)\)$/,
};
const unitFor = { weight: 'weightUnit', length: 'dimensionUnit', width: 'dimensionUnit', height: 'dimensionUnit' } as const;
const keyText = (value: string) => normalize(value).replace(/\s+/g, ' ');
const packFromName = (name: string) => normalize(name).match(/\bPACK\s*(?:DE\s*)?(\d+)\b/)?.[1] || '';
const pending = (issue: string): OrganizerCommercialSource => ({ variants: [], origins: {}, values: {}, issue });
const origin = (row: OrganizerProductRow) => ({
  fileId: row.fileId, fileName: row.fileName, version: row.sourceVersion || '', tab: row.tab, row: row.line,
});
const declaredProductColumns = {
  brand: /^(?:MARCA|BRAND)$/,
  material: /^(?:MATERIAL|MATERIAL PRINCIPAL)$/,
  composition: /^(?:COMPOSICION|COMPOSITION)$/,
} as const;
const foodContactColumn = /^MATERIALES? EN CONTACTO CON ALIMENTOS\s*(?:\(1000463\))?$/;
/** Headers already consumed as identity, commercial or declared product fields; every other column travels as a sheet attribute. */
const consumedHeader = (header: string) => {
  const key = keyText(header);
  return !key || CATALOG_HEADERS.has(key) || Object.values(defaultHeaders).some(list => list.includes(key)) ||
    Object.values(unitPatterns).some(pattern => pattern.test(key)) || Object.values(declaredProductColumns).some(pattern => pattern.test(key)) ||
    foodContactColumn.test(key);
};
/** Extra columns of one row (e.g. "Elasticidad de la tela", "Tipo de embalaje") keyed by their original header. */
export function declaredSheetAttributes(row: OrganizerProductRow) {
  const values: Record<string, string> = {};
  for (const cell of row.cells) {
    const header = (cell.header || '').trim().slice(0, 120);
    const value = cell.value.trim().slice(0, 500);
    if (!header || !value || cell.field || consumedHeader(header)) continue;
    values[`${DECLARED_SHEET_ATTRIBUTE}${header}`] = value;
  }
  return values;
}
const declaredCell = (row: OrganizerProductRow, header: RegExp) => {
  const cells = row.cells.filter(cell => header.test(keyText(cell.header || '')));
  const value = cells.length === 1 ? cells[0].originalValue : null;
  return typeof value === 'string' ? value.trim() : '';
};

function readCommercialValues(row: OrganizerProductRow, mapping: OrganizerSourceColumns) {
  const values: Partial<Record<OrganizerSourceField, string>> = {};
  const issues: string[] = [];
  const units = { weightUnit: new Set<string>(), dimensionUnit: new Set<string>() };
  for (const field of ORGANIZER_SOURCE_FIELDS) {
    const explicit = mapping[field]?.trim();
    const unitField = unitFor[field as keyof typeof unitFor];
    const found = row.cells.filter(cell => {
      const header = keyText(cell.header || '');
      if (explicit) return header === keyText(explicit);
      if (defaultHeaders[field].includes(header)) return true;
      return unitField && unitPatterns[unitField].test(header) && defaultHeaders[field].includes(header.split('(')[0].trim());
    });
    if (found.length > 1) { issues.push(`Más de una columna para ${field}`); continue; }
    const cell = found[0];
    if (!cell || cell.originalValue === '' || typeof cell.originalValue === 'boolean') continue;
    if (field === 'weightUnit' || field === 'dimensionUnit') {
      if (cell.value.trim()) units[field].add(cell.value.trim().toLowerCase());
      continue;
    }
    const number = String(cell.calculatedValue ?? cell.originalValue).trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(number) || !Number.isFinite(Number(number)) || (field === 'inventory' && !Number.isSafeInteger(Number(number)))) {
      issues.push(`Valor inválido para ${field} en ${cell.column}`);
      continue;
    }
    values[field] = number;
    if (unitField) {
      const unit = keyText(cell.header || '').match(unitPatterns[unitField])?.[1];
      if (unit) units[unitField].add(unit.toLowerCase());
    }
  }
  for (const field of ['weightUnit', 'dimensionUnit'] as const) {
    if (units[field].size === 1) values[field] = [...units[field]][0];
    if (units[field].size > 1) issues.push(`Unidades incompatibles para ${field}`);
  }
  return { values, issues };
}

export function resolveCommercialRows(variant: OrganizerVariant, rows: OrganizerProductRow[], mapping: OrganizerSourceColumns = {}, includeDeclaredAttributes = false): OrganizerCommercialSource {
  const eligible = rows.filter(row => row.line > 0 && (row.skc || row.sku));
  if (!eligible.length) return pending('La asociación no tiene una fila fuente con SKC o SKU.');
  if (eligible.some(row => !row.sourceVersion)) return pending('Falta la versión de la fila fuente. Vuelve a leer el Excel del Organizador.');
  const variants = new Map<string, MasterVariant>();
  const origins: OrganizerCommercialSource['origins'] = {};
  const names = new Map<string, Set<string>>();
  const foodContactByVariant = new Map<string, Set<string>>();
  const issues: string[] = [];
  for (const row of eligible) {
    const rawPack = row.pack || packFromName(row.name) || variant.pack;
    const pack = packFromName(rawPack) || rawPack;
    const color = row.color || variant.color;
    const id = digest([variant.id, row.skc, row.sku, normalize(color), normalize(row.size), normalize(pack)]);
    const commercial = readCommercialValues(row, mapping);
    issues.push(...commercial.issues.map(issue => `${row.tab} fila ${row.line}. ${issue}.`));
    const sourceId = (field: 'skc' | 'sku') => row.cells.find(cell => cell.field === field && code(cell.value) === row[field])?.value.trim() || row[field];
    // SHEIN "Número del artículo" is the SPU shared by every size/color: the declared base code, else the SKC.
    const declaredBase = row.cells.some(cell => cell.field === 'base' && cell.value.trim()) ? row.base : '';
    const values = { skc: sourceId('skc'), sku: sourceId('sku'), color, size: row.size, pack, spu: declaredBase || sourceId('skc') || '', ...commercial.values };
    const previous = variants.get(id);
    if (includeDeclaredAttributes) {
      const declaredFoodContact = declaredCell(row, foodContactColumn);
      const materials = foodContactByVariant.get(id) || new Set<string>();
      if (declaredFoodContact) materials.add(declaredFoodContact);
      foodContactByVariant.set(id, materials);
    }
    const conflicts = Object.entries(values).filter(([key, value]) => value && previous?.values[key as keyof typeof values] &&
      previous.values[key as keyof typeof values] !== value);
    if (conflicts.length) issues.push(`Valores distintos para ${row.skc || row.sku} en ${row.tab} fila ${row.line} (${conflicts.map(([key]) => key).join(', ')}).`);
    const variantNames = names.get(id) || new Set<string>();
    if (row.name) variantNames.add(keyText(row.name));
    names.set(id, variantNames);
    const attributes = { ...previous?.attributes, ...(includeDeclaredAttributes ? declaredSheetAttributes(row) : {}), ...(row.capacity ? { capacity: row.capacity } : {}) };
    variants.set(id, { id, values: { ...previous?.values, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')) },
      ...(Object.keys(attributes).length ? { attributes } : {}) });
    (origins[id] ??= []).push(origin(row));
  }
  for (const [id, labels] of names) if (labels.size > 1) {
    const value = variants.get(id)!.values;
    issues.push(`El identificador ${value.skc || value.sku} figura con productos distintos (${origins[id].map(row => `${row.tab} fila ${row.row}`).join(', ')}).`);
  }
  const rowsByIdentifier = [...variants.values()];
  for (const row of rowsByIdentifier) {
    const materials = foodContactByVariant.get(row.id);
    if (materials?.size === 1) row.attributes = { ...row.attributes, foodContactMaterial: [...materials][0] };
  }
  const declaredProduct = includeDeclaredAttributes ? Object.fromEntries(Object.entries(declaredProductColumns).flatMap(([field, header]) => {
    const values = new Set(eligible.map(row => declaredCell(row, header)));
    return values.size === 1 && !values.has('') ? [[field, [...values][0]]] : [];
  })) : {};
  const skus = rowsByIdentifier.map(row => code(row.values.sku || '')).filter(Boolean);
  if (new Set(skus).size !== skus.length) issues.push('Un SKU figura en variantes distintas.');
  return {
    variants: issues.length ? [] : rowsByIdentifier,
    origins,
    values: { ...declaredProduct, ...(variant.name ? { name: variant.name } : {}), ...(variant.description ? { description: variant.description } : {}),
      ...(variant.category ? { category: variant.category } : {}) },
    issue: issues.length ? distinct(issues).slice(0, 5).join(' ') : null,
  };
}

export async function readOrganizerCommerce(root: DocumentReference, photos: OrganizerCommercialLink['photos'],
  mapping: OrganizerSourceColumns = {}, includeDeclaredAttributes = false) {
  const snapshots = await Promise.all(photos.map(photo => root.collection('photos').doc(photo.id).get()));
  const current = snapshots.map(snapshot => snapshot.data() as (OrganizerPhoto & { version: string }) | undefined);
  const id = current[0]?.variantId || null;
  if (!id || current.some((photo, index) => !photo || photo.version !== photos[index].version || photo.variantId !== id ||
    photo.identityState === 'needs_review' || photo.issue || photo.method === 'fotos_hermanas')) {
    return { organizerVariantId: null, source: pending('Confirma la asociación de la foto a una variante en el Organizador. ' +
      (current.find(photo => photo?.issue)?.issue || 'Falta una coincidencia comercial inequívoca.')) };
  }
  const ref = root.collection('products').doc(id);
  const [snapshot, provenance] = await Promise.all([ref.get(), ref.collection('provenance').limit(201).get()]);
  const variant = snapshot.data() as OrganizerVariant | undefined;
  if (!variant || provenance.size > 200) return { organizerVariantId: id, source: pending('La variante fuente no está disponible o supera 200 filas.') };
  if (variant.issues.some(issue => /SKC aparece en varias variantes/.test(issue)) && current.some(photo => !photo?.reviewedBy)) {
    return { organizerVariantId: id, source: pending('El SKC aparece en varias variantes. Confirma la variante de la foto en el Organizador.') };
  }
  const rows = provenance.docs.map(doc => doc.data() as OrganizerProductRow)
    .sort((a, b) => a.fileId.localeCompare(b.fileId) || a.tab.localeCompare(b.tab) || a.line - b.line);
  return { organizerVariantId: id, source: resolveCommercialRows(variant, rows, mapping, includeDeclaredAttributes) };
}
