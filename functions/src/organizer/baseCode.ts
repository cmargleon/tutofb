import type { OrganizerBaseCodeIdentity, OrganizerProductRow, OrganizerVariant } from '../../../shared/src/types';
import { code, distinct, normalize } from './catalog';
import { digest, type DriveFile } from './drive';

/**
 * Base-code identity: every photo of a product starts with the product's stable base code
 * (declared in the Excel), optionally followed by a variant code (SKC/SKU) and a sequence.
 * The resolver is deterministic and never calls a model. It never splits a code on its first
 * hyphen: it looks for the longest *known* code followed by a separator or the end of the name.
 */

const SEPARATOR = /[-_\s(.,]/;
const EXTENSION = /\.[^.]{2,5}$/;
const SHARED = /\s+Y\s+|\s+AND\s+|\s*[&+]\s*/;

/** Identity is content-based where possible so moving or renaming a file does not change it. */
export const contentVersionOf = (file: Pick<DriveFile, 'sha256Checksum' | 'md5Checksum' | 'size' | 'version' | 'modifiedTime'>) =>
  file.sha256Checksum ? `sha256:${file.sha256Checksum}` : file.md5Checksum ? `md5:${file.md5Checksum}:${file.size || ''}`
    : `version:${file.version || file.modifiedTime || ''}`;

export const stemOf = (name: string) => code(name.replace(EXTENSION, '')).replace(/(?:PNG|JPE?G|WEBP)$/i, '').trim();

/** Longest code `c` with `stem === c` or `stem` starting with `c` followed by a separator. */
export function longestCode(stem: string, codes: Iterable<string>): string | null {
  let best: string | null = null;
  for (const candidate of codes) {
    if (!candidate || (best && candidate.length <= best.length)) continue;
    if (stem === candidate || (stem.startsWith(candidate) && SEPARATOR.test(stem[candidate.length]))) best = candidate;
  }
  return best;
}

const STOP = new Set(['PARA', 'CON', 'DEL', 'POR', 'LOS', 'LAS', 'UNA', 'UNO', 'PACK', 'PIEZA', 'PIEZAS', 'TALLA', 'COLOR', 'SET', 'DE', 'LA', 'EL', 'Y']);
const COLOR_GROUPS: Record<string, string[]> = {
  negro: ['NEGRO', 'NEGRA', 'BLACK', 'NEG', 'NGO', 'NG', 'NEGROS', 'NEGRAS'],
  blanco: ['BLANCO', 'BLANCA', 'WHITE', 'BCO', 'BLA', 'BL', 'BLANCOS', 'BLANCAS', 'HUESO', 'MARFIL', 'IVORY', 'OFF WHITE'],
  gris: ['GRIS', 'GREY', 'GRAY', 'GRS', 'JASPE', 'OXFORD', 'PLOMO'],
  rojo: ['ROJO', 'ROJA', 'RED', 'RJ', 'ROJOS', 'GUINDA', 'VINO', 'BURDEOS', 'TINTO'],
  marino: ['MARINO', 'AZUL MARINO', 'NAVY', 'MAR'],
  azul: ['AZUL', 'BLUE', 'AZ', 'CELESTE', 'AZUL CIELO', 'TURQUESA', 'REY', 'AZUL REY', 'INDIGO', 'MEZCLILLA', 'DENIM'],
  verde: ['VERDE', 'GREEN', 'VD', 'OLIVO', 'MILITAR', 'MENTA', 'JADE', 'ESMERALDA'],
  amarillo: ['AMARILLO', 'AMARILLA', 'YELLOW', 'AMA', 'MOSTAZA'],
  naranja: ['NARANJA', 'ORANGE', 'NAR', 'CORAL'],
  rosa: ['ROSA', 'ROSADO', 'ROSADA', 'PINK', 'FUCSIA', 'FIUSHA', 'MAGENTA', 'PALO DE ROSA'],
  morado: ['MORADO', 'MORADA', 'PURPLE', 'LILA', 'LAVANDA', 'VIOLETA', 'UVA'],
  cafe: ['CAFE', 'MARRON', 'BROWN', 'CHOCOLATE', 'CAMEL', 'TABACO', 'MOKA', 'COBRE'],
  beige: ['BEIGE', 'CREMA', 'ARENA', 'NUDE', 'KHAKI', 'CAQUI', 'TAN', 'HUESO CLARO'],
  dorado: ['DORADO', 'DORADA', 'GOLD', 'ORO'],
  plateado: ['PLATEADO', 'PLATEADA', 'SILVER', 'PLATA'],
  transparente: ['TRANSPARENTE', 'CLEAR', 'CRISTAL'],
  multicolor: ['MULTICOLOR', 'ESTAMPADO', 'ESTAMPADA', 'PRINT', 'FLORAL', 'RAYAS', 'CUADROS', 'MIXTO'],
};
const COLOR_WORDS = Object.values(COLOR_GROUPS).flat();

/** Canonical colors mentioned in a free-text color label (Spanish/English, common abbreviations). */
export function canonicalColors(text: string): string[] {
  const value = ` ${normalize(text).replace(/[^A-Z0-9]+/g, ' ').trim()} `;
  if (!value.trim()) return [];
  const found = new Set<string>();
  // Longer synonyms first so "AZUL MARINO" wins over "AZUL".
  const entries = Object.entries(COLOR_GROUPS).flatMap(([canonical, words]) => words.map(word => [canonical, word] as const))
    .sort((a, b) => b[1].length - a[1].length);
  let rest = value;
  for (const [canonical, word] of entries) {
    if (rest.includes(` ${word} `)) { found.add(canonical); rest = rest.split(` ${word} `).join(' '); }
  }
  return [...found].sort();
}
/** true/false when both colors are recognized, null when either is unknown. */
export function colorsCompatible(observed: string, declared: string): boolean | null {
  const a = canonicalColors(observed); const b = canonicalColors(declared);
  if (!a.length || !b.length) return null;
  if (a.includes('multicolor') || b.includes('multicolor')) return a.includes('multicolor') && b.includes('multicolor') ? true : null;
  return a.some(color => b.includes(color));
}
const significant = (text: string) => distinct(normalize(text).match(/[A-Z]+/g) || [])
  .filter(word => word.length > 2 && !STOP.has(word) && !COLOR_WORDS.includes(word));

export interface BaseCodeIndex {
  /** Declared base code → visual variant IDs. */
  bases: Map<string, string[]>;
  /** Variant-level code (SKC/SKU/visual) → visual variant IDs. */
  variantCodes: Map<string, Set<string>>;
  /** Declared base codes that the Excel uses for different products. */
  conflicts: Map<string, string>;
  /** Variant IDs whose base code was read from a declared column. */
  declared: Set<string>;
  /** Visual variants of the same base that cannot be told apart by color alone. */
  indistinct: Set<string>;
}

export const declaredBaseCodes = (rows: Pick<OrganizerProductRow, 'cells'>[]) =>
  new Set(rows.flatMap(row => row.cells.filter(cell => cell.field === 'base' && cell.value.trim()).map(cell => code(cell.value))));

export function buildBaseCodeIndex(variants: OrganizerVariant[], rows: Pick<OrganizerProductRow, 'cells' | 'base' | 'name' | 'category'>[]): BaseCodeIndex {
  const declaredCodes = declaredBaseCodes(rows);
  const bases = new Map<string, string[]>();
  const variantCodes = new Map<string, Set<string>>();
  const declared = new Set<string>();
  for (const variant of variants) {
    if (declaredCodes.has(variant.base)) {
      declared.add(variant.id);
      bases.set(variant.base, [...(bases.get(variant.base) || []), variant.id]);
    }
    for (const token of distinct([variant.visual, ...variant.skcs, ...variant.skus].map(code).filter(Boolean))) {
      const ids = variantCodes.get(token) || new Set<string>();
      ids.add(variant.id);
      variantCodes.set(token, ids);
    }
  }
  // Case D: a declared base whose rows describe different products (different categories or names
  // sharing no significant word once colors and sizes are removed).
  const conflicts = new Map<string, string>();
  const byBase = new Map<string, { names: Set<string>; categories: Set<string> }>();
  for (const row of rows) {
    if (!declaredCodes.has(row.base)) continue;
    const entry = byBase.get(row.base) || { names: new Set<string>(), categories: new Set<string>() };
    if (row.name.trim()) entry.names.add(row.name);
    if (row.category.trim()) entry.categories.add(normalize(row.category));
    byBase.set(row.base, entry);
  }
  for (const [base, { names, categories }] of byBase) {
    if (categories.size > 1) { conflicts.set(base, `El código base ${base} figura con categorías distintas (${[...categories].slice(0, 3).join(', ')}).`); continue; }
    const words = [...names].map(significant).filter(list => list.length);
    const disjoint = words.some((a, i) => words.slice(i + 1).some(b => !a.some(word => b.includes(word))));
    if (disjoint) conflicts.set(base, `El código base ${base} figura con productos distintos (${[...names].slice(0, 3).join(' / ')}).`);
  }
  const byId = new Map(variants.map(variant => [variant.id, variant]));
  const indistinct = new Set([...bases.values()].flatMap(ids => [...indistinctVariants(ids.map(id => byId.get(id)!))]));
  return { bases, variantCodes, conflicts, declared, indistinct };
}

/** Variants of one base that share a color: a model must never choose between them (case G). */
export function indistinctVariants(variants: Pick<OrganizerVariant, 'id' | 'color'>[]) {
  const keyed = new Map<string, string[]>();
  for (const variant of variants) {
    const key = canonicalColors(variant.color).join('+') || normalize(variant.color) || '?';
    keyed.set(key, [...(keyed.get(key) || []), variant.id]);
  }
  return new Set([...keyed.values()].filter(group => group.length > 1).flat());
}

/** Views a variant needs before its references are complete. Not every article needs front and back. */
export function requiredViews(kind: 'garment' | 'product', category: string): ('front' | 'back' | 'main')[] {
  if (kind === 'product') return ['main'];
  return /ACCESORIO|BUFANDA|GORRA|SOMBRERO|CINTURON|BOLSA|BOLSO|CARTERA|CALCETA|CALCETIN|GUANTE|LENTE|ARETE|COLLAR|PULSERA/.test(normalize(category))
    ? ['front'] : ['front', 'back'];
}

/** Deterministic resolution of one filename. */
export function resolveBaseCode(name: string, index: BaseCodeIndex): OrganizerBaseCodeIdentity {
  const stem = stemOf(name);
  const known = [...index.bases.keys(), ...index.variantCodes.keys()];
  const match = longestCode(stem, known);
  const none: OrganizerBaseCodeIdentity = { baseCode: null, baseId: null, variantId: null, candidates: [], method: 'sin_codigo',
    issue: 'El nombre no empieza con un código base del catálogo.' };
  if (!match) return none;
  const baseVariants = index.bases.get(match);
  // A declared multi-variant base wins over an identical variant-level code: never guess the variant.
  if (baseVariants && (baseVariants.length > 1 || !index.variantCodes.has(match))) {
    const baseId = digest([match]);
    const conflict = index.conflicts.get(match);
    if (conflict) return { baseCode: match, baseId, variantId: null, candidates: baseVariants, method: 'codigo_base_conflicto', issue: conflict };
    if (baseVariants.length === 1) return { baseCode: match, baseId, variantId: baseVariants[0], candidates: baseVariants, method: 'codigo_base_unico', issue: null };
    return { baseCode: match, baseId, variantId: null, candidates: baseVariants, method: 'codigo_base', issue: 'Variante pendiente de identificación visual.' };
  }
  const ids = [...index.variantCodes.get(match) || []];
  const baseCode = ids.length ? [...index.bases].find(([, list]) => list.includes(ids[0]))?.[0] || null : null;
  const baseId = baseCode ? digest([baseCode]) : null;
  if (baseCode && index.conflicts.has(baseCode))
    return { baseCode, baseId, variantId: null, candidates: ids, method: 'codigo_base_conflicto', issue: index.conflicts.get(baseCode)! };
  if (ids.length === 1) return { baseCode, baseId, variantId: ids[0], candidates: ids, method: 'codigo_variante', issue: null };
  return { baseCode, baseId, variantId: null, candidates: ids, method: 'varios_codigos', issue: 'El código del archivo figura en varias variantes del Excel.' };
}

type PhotoFile = { id: string; name: string; path: string[]; parents?: string[]; sha256Checksum?: string; md5Checksum?: string; size?: string };
export type BaseCodeAssociation = {
  variantId: string | null; variantIds: string[]; candidates: string[]; method: string; evidence: string[]; confidence: number;
  issue: string | null; duplicateOf: string | null; identityState: 'variant' | 'shared' | 'base' | 'unresolved'; baseId: string | null;
  baseCodeIdentity: OrganizerBaseCodeIdentity;
};

/**
 * Same output contract as `associatePhotos`, driven only by filenames. Folder names and sibling
 * photos are never used: in base-code mode clients may mix products freely across folders.
 */
export function associateByBaseCode(files: PhotoFile[], index: BaseCodeIndex, manual: Map<string, string | null>) {
  const byHash = new Map<string, string[]>();
  const results = new Map<string, BaseCodeAssociation>();
  for (const file of files) {
    const stem = file.name.replace(EXTENSION, '');
    const parts = SHARED.test(stem) ? stem.split(SHARED).filter(part => part.trim()) : [];
    let identity = resolveBaseCode(file.name, index);
    let association: BaseCodeAssociation;
    if (parts.length > 1) {
      const resolved = parts.map(part => resolveBaseCode(part, index));
      const ids = distinct(resolved.map(item => item.variantId).filter((id): id is string => Boolean(id)));
      const complete = resolved.every(item => item.variantId) && ids.length > 1;
      identity = { ...identity, candidates: distinct(resolved.flatMap(item => item.candidates)),
        variantId: null, issue: complete ? null : 'Foto con varios productos: confirma las variantes.' };
      association = { variantId: null, variantIds: complete ? ids : [], candidates: identity.candidates, method: complete ? 'codigo_compartido' : 'pendiente',
        evidence: [file.name], confidence: complete ? 1 : 0, issue: identity.issue, duplicateOf: null,
        identityState: complete ? 'shared' : 'unresolved', baseId: null, baseCodeIdentity: identity };
    } else {
      association = { variantId: identity.variantId, variantIds: identity.variantId ? [identity.variantId] : [], candidates: identity.candidates,
        method: identity.variantId ? identity.method : 'pendiente', evidence: [file.name, ...(identity.baseCode ? [`Código base: ${identity.baseCode}`] : [])],
        confidence: identity.variantId ? 1 : 0, issue: identity.issue, duplicateOf: null,
        identityState: identity.variantId ? 'variant' : identity.baseId && identity.method === 'codigo_base' ? 'base' : 'unresolved',
        baseId: identity.baseId, baseCodeIdentity: identity };
    }
    if (manual.has(file.id)) {
      const target = manual.get(file.id) || null;
      Object.assign(association, { variantId: target, variantIds: target ? [target] : [], method: 'manual', confidence: target ? 1 : 0,
        identityState: target ? 'variant' : 'unresolved', issue: target ? null : 'Sin asociación por decisión humana' });
    }
    const hash = file.sha256Checksum ? `sha256:${file.sha256Checksum}` : file.md5Checksum ? `md5:${file.md5Checksum}:${file.size}` : '';
    if (hash) byHash.set(hash, [...(byHash.get(hash) || []), file.id]);
    results.set(file.id, association);
  }
  for (const [hash, ids] of byHash) {
    for (const [position, id] of ids.entries()) {
      results.get(id)!.duplicateOf = position ? ids[0] : null;
      if (position) results.get(id)!.evidence.push(`Contenido repetido: ${hash}; identidad independiente`);
    }
  }
  return results;
}

/** Issues to attach to variants in base-code mode. */
export function baseCodeVariantIssues(variant: OrganizerVariant, index: BaseCodeIndex) {
  const issues: string[] = [];
  if (!index.declared.has(variant.id)) issues.push('Código base no declarado en el Excel: agrega la columna «Código base» (o SPU).');
  const conflict = index.conflicts.get(variant.base);
  if (conflict && index.declared.has(variant.id)) issues.push(conflict);
  if (index.indistinct.has(variant.id)) issues.push('Otra variante del mismo producto tiene el mismo color: nombra sus fotos con el código de variante (SKC).');
  return issues;
}
