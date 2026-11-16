import type { DocumentReference } from 'firebase-admin/firestore';
import type {
  MasterVariant, OrganizerCategoryDecision, OrganizerCommercialSource, OrganizerPhoto, OrganizerProductRow,
  OrganizerSourceColumns, OrganizerSourceField, OrganizerVariant,
} from '../../../shared/src/types';
import { ORGANIZER_SOURCE_FIELDS } from '../../../shared/src/types';
import { code, distinct, normalize } from './catalog';
import { digest } from './drive';
import { getAppFirestore } from '../firebase/appFirestore';

export interface OrganizerCommercialLink {
  itemId: string;
  photos: { id: string; version: string }[];
  organizerVariantId: string | null;
  source: OrganizerCommercialSource;
  category?: OrganizerCategoryDecision | null;
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

export function resolveCommercialRows(variant: OrganizerVariant, rows: OrganizerProductRow[], mapping: OrganizerSourceColumns = {}): OrganizerCommercialSource {
  const eligible = rows.filter(row => row.line > 0 && (row.skc || row.sku));
  if (!eligible.length) return pending('La asociación no tiene una fila fuente con SKC o SKU.');
  if (eligible.some(row => !row.sourceVersion)) return pending('Falta la versión de la fila fuente. Vuelve a leer el Excel del Organizador.');
  const variants = new Map<string, MasterVariant>();
  const origins: OrganizerCommercialSource['origins'] = {};
  const names = new Map<string, Set<string>>();
  const issues: string[] = [];
  for (const row of eligible) {
    const rawPack = row.pack || packFromName(row.name) || variant.pack;
    const pack = packFromName(rawPack) || rawPack;
    const color = row.color || variant.color;
    const id = digest([variant.id, row.skc, row.sku, normalize(color), normalize(row.size), normalize(pack)]);
    const commercial = readCommercialValues(row, mapping);
    issues.push(...commercial.issues.map(issue => `${row.tab} fila ${row.line}. ${issue}.`));
    const sourceId = (field: 'skc' | 'sku') => row.cells.find(cell => cell.field === field && code(cell.value) === row[field])?.value.trim() || row[field];
    const values = { skc: sourceId('skc'), sku: sourceId('sku'), color, size: row.size, pack, ...commercial.values };
    const previous = variants.get(id);
    const conflicts = Object.entries(values).filter(([key, value]) => value && previous?.values[key as keyof typeof values] &&
      previous.values[key as keyof typeof values] !== value);
    if (conflicts.length) issues.push(`Valores distintos para ${row.skc || row.sku} en ${row.tab} fila ${row.line} (${conflicts.map(([key]) => key).join(', ')}).`);
    const variantNames = names.get(id) || new Set<string>();
    if (row.name) variantNames.add(keyText(row.name));
    names.set(id, variantNames);
    variants.set(id, { id, values: { ...previous?.values, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')) },
      ...(row.capacity ? { attributes: { capacity: row.capacity } } : previous?.attributes ? { attributes: previous.attributes } : {}) });
    (origins[id] ??= []).push(origin(row));
  }
  for (const [id, labels] of names) if (labels.size > 1) {
    const value = variants.get(id)!.values;
    issues.push(`El identificador ${value.skc || value.sku} figura con productos distintos (${origins[id].map(row => `${row.tab} fila ${row.row}`).join(', ')}).`);
  }
  const rowsByIdentifier = [...variants.values()];
  const skus = rowsByIdentifier.map(row => code(row.values.sku || '')).filter(Boolean);
  if (new Set(skus).size !== skus.length) issues.push('Un SKU figura en variantes distintas.');
  return {
    variants: issues.length ? [] : rowsByIdentifier,
    origins,
    values: { ...(variant.name ? { name: variant.name } : {}), ...(variant.description ? { description: variant.description } : {}),
      ...(variant.category ? { category: variant.category } : {}) },
    issue: issues.length ? distinct(issues).slice(0, 5).join(' ') : null,
  };
}

export async function readOrganizerCommerce(root: DocumentReference, photos: OrganizerCommercialLink['photos'],
  mapping: OrganizerSourceColumns = {}) {
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
  return { organizerVariantId: id, source: resolveCommercialRows(variant, rows, mapping) };
}
