import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as Xlsx from '../../functions/node_modules/xlsx';

export const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
const XLSX: typeof Xlsx = requireFunctions('xlsx');
export const PILOT = {
  id: 'jishop-drive-organizer-v1',
  client: 'JISHOP',
  clientId: '5RPUrQKfkERh4josuuvX',
  sourceId: '1g0Z4tXAdhPanKWSGwTUFdv8SdfAGng-K',
  name: 'JISHOP - PRUEBA ORGANIZADOR',
  sheet: 'CONTROL DE PRODUCTOS - JISHOP - PRUEBA',
} as const;
export const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const folded = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
const code = (text: string) => folded(text).replace(/\s*-\s*/g, '-').replace(/PACK\s+(?=\d)/g, 'PACK');
const safe = (name: string) => name.replace(/[\/\\]/g, ' - ').trim() || 'SIN CATEGORIA';
export interface Entry {
  id: string; name: string; path: string[]; parentId: string; mimeType: string;
  size?: string; version?: string; headRevisionId?: string; modifiedTime?: string;
  md5Checksum?: string; sha256Checksum?: string; url?: string; folder?: boolean;
  canCopy?: boolean; canDownload?: boolean;
}
export const isImage = (file: Entry) => file.mimeType.startsWith('image/');
export const isWorkbook = (file: Entry) => /spreadsheet|ms-excel/.test(file.mimeType) || /\.xlsx?$/i.test(file.name);
export const compareSource = (a: Entry, b: Entry) =>
  JSON.stringify([a.name, a.parentId, a.mimeType, a.size, a.version, a.headRevisionId, a.modifiedTime, a.md5Checksum]) ===
  JSON.stringify([b.name, b.parentId, b.mimeType, b.size, b.version, b.headRevisionId, b.modifiedTime, b.md5Checksum]);

const aliases = {
  skc: ['SKC', 'CODIGO SKC'],
  sku: ['SKU', 'CODIGO SKU', 'CODIGO DE PRODUCTO', 'REFERENCIA'],
  base: ['SPU', 'PRODUCTO BASE', 'MODELO BASE'],
  name: ['NOMBRE', 'NOMBR', 'NOMBRE DEL PRODUCTO', 'NOMBRE COMERCIAL', 'PRODUCTO'],
  description: ['DESCRIPCION', 'DESCRIPCION DEL PRODUCTO'],
  category: ['CATEGORIA', 'TIPO DE PRODUCTO'],
  color: ['COLOR', 'COLOUR'],
  size: ['TALLA', 'TAMANO', 'SIZE'],
  pack: ['PACK', 'PRESENTACION', 'UNIDADES POR PACK'],
  attributes: ['VALORES DE LAS VARIANTES', 'ATRIBUTOS', 'VARIANTES'],
  photo: ['FOTO IA', 'FOTOGRAFIA IA', 'IMAGEN IA'],
  upload: ['UPLOAD', 'SUBIDA', 'SUBIDO', 'CARGADO'],
  publish: ['PUBLICAR', 'PUBLICADO', 'PUBLICACION'],
  comments: ['COMENTARIO', 'COMENTARIOS', 'OBSERVACIONES', 'NOTAS'],
} as const;
type Field = keyof typeof aliases;
const header = new Map<string, Field>(
  Object.entries(aliases).flatMap(([key, names]) => names.map(name => [name, key as Field] as const)),
);
export type Values = Partial<Record<Field, string>>;
export interface Row {
  fileId: string; fileName: string; sheet: string; line: number; fields: Values;
  firstColumn?: string;
  raw: string[]; skc: string; sku: string; base: string; visual: string; pack: string;
}
export interface SheetAudit {
  fileId: string; fileName: string; sheet: string; headerLine?: number;
  columns: string[]; rowsRead: number; rowsImported: number; errors: string[];
}
const sizes: Record<string, string[]> = {
  CH: ['CH', 'CHICO', 'CHICA', 'S'], M: ['M', 'MEDIANO', 'MEDIANA'],
  G: ['G', 'GRANDE', 'L'], EX: ['EX', 'EXTRA GRANDE', 'XL'],
};
function parseProduct(fields: Values) {
  const sku = code(fields.sku || '');
  const skc = code(fields.skc || fields.sku || '');
  if (!skc || !/\d/.test(skc) || !/^[A-Z0-9][A-Z0-9 ._+/-]{0,100}$/.test(skc)) return null;
  const attributes = fields.attributes || '';
  fields.size ||= attributes.match(/(?:^|[;,])\s*TALLA\s*:\s*([^;,]+)/i)?.[1]?.trim();
  fields.color = (fields.color || attributes.match(/(?:^|[;,])\s*COLOR\s*:\s*([^;,]+)/i)?.[1] || '')
    .replace(/^COLOR\s*:\s*/i, '').trim() || undefined;
  const packNumber = (fields.pack || skc).match(/\bPACK\s*[-X]?\s*(\d+)/i)?.[1] ||
    (fields.pack || '').match(/^\d+$/)?.[0];
  const pack = packNumber ? `PACK ${packNumber}` : fields.pack || '';
  const segments = skc.split('-');
  const last = segments.at(-1)!;
  const size = folded(fields.size || '');
  const verifiedSize = size && (last === size || sizes[last]?.includes(size));
  const base = code(fields.base || segments[0]);
  const variant = verifiedSize && segments.length > 1 ? segments.slice(0, -1).join('-') : skc;
  const visual = packNumber && !/PACK\d/.test(variant) ? `${variant}-PACK${packNumber}` : variant;
  return { sku: sku || visual, skc, base, visual, pack };
}

export function readWorkbook(file: Entry, bytes: Buffer) {
  const rows: Row[] = [];
  const sources: SheetAudit[] = [];
  const book = XLSX.read(bytes, { type: 'buffer' });
  for (const sheet of book.SheetNames) {
    const worksheet = book.Sheets[sheet];
    const start = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']).s : { r: 0, c: 0 };
    const grid = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false, defval: '', blankrows: true });
    const columnName = (index: number) => XLSX.utils.encode_col(start.c + index);
    const source: SheetAudit = { fileId: file.id, fileName: file.name, sheet, columns: [], rowsRead: 0, rowsImported: 0, errors: [] };
    sources.push(source);
    const mapping = (row: string[]) => row.map(value => header.get(folded(value).replace(/[:.]+$/, '')));
    let headerIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < grid.length; index++) {
      const mapped = new Set(mapping(grid[index]));
      mapped.delete(undefined);
      if ((mapped.has('sku') || mapped.has('skc')) && mapped.size > bestScore) {
        headerIndex = index;
        bestScore = mapped.size;
      }
    }
    if (headerIndex === -1) { source.errors.push('Encabezado SKU/SKC no encontrado'); continue; }
    const mapped = mapping(grid[headerIndex]);
    source.headerLine = start.r + headerIndex + 1;
    source.columns = mapped.flatMap((value, i) => value ? [`${columnName(i)}: ${grid[headerIndex][i].trim()} → ${value}`] : []);
    for (let index = headerIndex + 1; index < grid.length; index++) {
      const line = start.r + index + 1;
      const raw = grid[index];
      if (!raw.some(value => value.trim())) continue;
      source.rowsRead++;
      const fields: Values = {};
      for (const [column, field] of mapped.entries()) {
        const value = raw[column]?.trim();
        if (field && value) fields[field] = [fields[field], value].filter(Boolean).join(' | ');
      }
      const identity = parseProduct(fields);
      if (!identity) {
        source.errors.push(`Fila ${line}: sin identificador válido`);
        continue;
      }
      rows.push({ fileId: file.id, fileName: file.name, sheet, line, firstColumn: columnName(0), fields, raw, ...identity });
      source.rowsImported++;
    }
  }
  return { rows, sources };
}

export type Status = 'SUBIDOS' | 'PENDIENTES' | 'REVISAR';
type Stage = 'OK' | 'PENDIENTE' | 'NO REGISTRADO' | 'REVISAR';
type StageField = 'photo' | 'upload' | 'publish';
const stages = (rows: Row[], field: StageField): Stage => {
  const known = new Set(rows.flatMap(row => {
    const value = folded(row.fields[field] || '');
    if (!value) return [];
    if (/^(OK|SI|LIST[OA]|COMPLETAD[OA]|SUBID[OA]|PUBLICAD[OA])$/.test(value)) return ['OK'];
    if (/^(NO|PENDIENTE|FALTA|NO SUBIDO|NO PUBLICADO)$/.test(value)) return ['PENDIENTE'];
    return ['REVISAR'];
  }));
  return known.size === 0 ? 'NO REGISTRADO' : known.size > 1 ? 'REVISAR' : [...known][0] as Stage;
};
export const unique = <T>(values: T[]) => [...new Set(values)];
export interface Reference {
  state: string; kind?: string; front?: string[]; back?: string[]; object?: string[];
  views?: Record<string, string>;
}
export interface Variant {
  id: string; base: string; visual: string; pack: string; skcs: string[];
  rows: Row[]; images: string[]; name: string; category: string; color: string;
  photo: Stage; upload: Stage; publish: Stage; status: Status; issues: string[];
  quality: string; reference?: Reference;
}
export interface Association {
  fileId: string; variantId?: string; selectedCode?: string; candidates: string[];
  method: string; confidence: number; evidence: string[]; review?: string;
  duplicateOf?: string; hash?: string;
}
export const reviewReason = {
  missing: 'SIN SKC', identity: 'CONFLICTO DE SKC', status: 'CONFLICTO DE ESTADO', insufficient: 'INFORMACION INSUFICIENTE',
} as const;
const qualityIssue = /\b(CAMBIAR|H[AC]{1,2}A?ER|REPETIR|CORREGIR|REHACER|FALTA|BORROSA|ERRONEA|INCORRECTA)\b/;

function groups(rows: Row[]) {
  const indexed = new Map<string, Variant>();
  for (const row of rows) {
    const id = hash(JSON.stringify([PILOT.clientId, row.base, row.visual, folded(row.pack)]));
    let variant = indexed.get(id);
    if (!variant) {
      variant = { id, base: row.base, visual: row.visual, pack: row.pack, skcs: [], rows: [], images: [],
        name: '', category: '', color: '', photo: 'NO REGISTRADO', upload: 'NO REGISTRADO', publish: 'NO REGISTRADO',
        status: 'PENDIENTES', issues: [], quality: '' };
      indexed.set(id, variant);
    }
    variant.rows.push(row);
  }
  const bySkc = new Map<string, Set<string>>();
  for (const variant of indexed.values()) {
    variant.skcs = unique(variant.rows.map(row => row.skc)).sort();
    for (const skc of variant.skcs) {
      if (!bySkc.has(skc)) bySkc.set(skc, new Set());
      bySkc.get(skc)!.add(variant.id);
    }
    const field = (key: Field) => unique(variant.rows.flatMap(row => row.fields[key] ? [row.fields[key]!] : []));
    variant.name = field('name')[0] || field('description')[0] || variant.visual;
    variant.category = field('category')[0] || '';
    variant.color = field('color').join(' / ');
    if (unique(field('color').map(folded)).length > 1 || unique(field('category').map(folded)).length > 1) {
      variant.issues.push('Atributos incompatibles entre filas');
    }
    const aggregate = (key: StageField): Stage => {
      const values = unique(variant.skcs.map(skc => stages(variant.rows.filter(row => row.skc === skc), key)));
      if (values.length === 1) return values[0];
      return values.includes('OK') || values.includes('REVISAR') ? 'REVISAR' : 'PENDIENTE';
    };
    variant.photo = aggregate('photo');
    variant.upload = aggregate('upload');
    variant.publish = aggregate('publish');
    if ([variant.photo, variant.upload, variant.publish].includes('REVISAR')) variant.issues.push('Estados inconsistentes o sin interpretar entre filas/SKC');
    variant.quality = field('comments').filter(text => qualityIssue.test(folded(text))).join(' | ');
    if (variant.quality) variant.issues.push('Observación pendiente de calidad o información');
  }
  for (const variant of indexed.values()) {
    if (variant.skcs.some(skc => bySkc.get(skc)!.size > 1)) variant.issues.push('El mismo SKC pertenece a más de una variante');
  }
  return indexed;
}

const stem = (name: string) => code(name.replace(/\.(?:jpg|jpeg|png|webp|avif|heic|tiff?|gif|bmp)$/i, ''));
type Match = { variant: Variant; code: string; rank: number; method: string };
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function catalog(files: Entry[], rows: Row[]) {
  const variants = groups(rows);
  const index = new Map<string, Match[]>();
  const add = (key: string, variant: Variant, rank: number, method: string) => {
    const existing = index.get(key) || [];
    if (!existing.some(match => match.variant.id === variant.id && match.rank === rank)) {
      index.set(key, [...existing, { variant, code: key, rank, method }]);
    }
  };
  for (const variant of variants.values()) {
    for (const key of variant.skcs) add(key, variant, 0, 'SKC exacto');
    for (const key of unique([variant.visual, ...variant.rows.map(row => row.sku)])) add(key, variant, 1, 'SKU/variante exacto');
  }
  const tokens = [...index.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  // The right boundary allows separators used for view labels, but never an unknown code suffix.
  const tokenPattern = tokens.length
    ? new RegExp(`(?<![A-Z0-9-])(?:${tokens.join('|')})(?![A-Z0-9-])`, 'g')
    : null;
  const lookup = (name: string) => {
    const normalized = stem(name);
    const exact = index.get(normalized);
    if (exact) return { matches: exact, exact: true, mention: true };
    const keys = unique((normalized.match(tokenPattern || /(?!)x/g) || []).filter(key =>
      normalized === key || !normalized.includes(`${key}PACK`)));
    const unknown = /(?:^|[^A-Z0-9])(?:[A-Z]{1,6}\d{2,}|\d{2,}-[A-Z])[A-Z0-9-]*(?=$|[^A-Z0-9])/.test(normalized);
    return { matches: keys.flatMap(key => index.get(key)!), exact: false, mention: keys.length > 0 || unknown };
  };
  const associations: Association[] = [];
  const firstByHash = new Map<string, string>();
  const byId = new Map(files.map(file => [file.id, file]));
  for (const file of files.filter(isImage).sort((a, b) => a.id.localeCompare(b.id))) {
    const named = lookup(file.name);
    const parents = file.path.slice(1, -1).reverse().map(name => ({ name, ...lookup(name) }));
    const knownParents = parents.filter(parent => parent.matches.length);
    const parent = knownParents[0];
    const fileIds = unique(named.matches.map(match => match.variant.id));
    const parentIds = unique(knownParents.flatMap(p => p.matches.map(match => match.variant.id)));
    const evidence = [
      ...(named.mention ? [`Nombre ${file.name}`] : []),
      ...knownParents.map(p => `Carpeta ${p.name}`),
    ];
    const match = [...named.matches, ...(parent?.matches || [])].sort((a, b) => a.rank - b.rank)[0];
    const candidates = unique([...named.matches, ...knownParents.flatMap(p => p.matches)].map(m => m.code));
    const association: Association = { fileId: file.id, candidates, method: 'Sin asociación', confidence: 0, evidence };
    const unknownParent = parent && parents.slice(0, parents.indexOf(parent)).some(item => item.mention && !item.matches.length);
    if (fileIds.length > 1 || parentIds.length > 1 || (fileIds.length && parentIds.length && fileIds[0] !== parentIds[0])
        || (fileIds.length && /(?:^|[^A-Z0-9])[A-Z]{1,6}\d{2,}[A-Z0-9-]*/.test(stem(file.name).replace(tokenPattern || /(?!)x/g, ' ')))
        || (!fileIds.length && unknownParent)) {
      association.review = reviewReason.identity;
      for (const id of unique([...fileIds, ...parentIds])) {
        const issue = 'Fotografías con identificadores ambiguos o contradictorios';
        if (!variants.get(id)!.issues.includes(issue)) variants.get(id)!.issues.push(issue);
      }
    } else if (!match || (named.mention && !fileIds.length)) {
      association.review = reviewReason.missing;
    } else {
      const chosen = (named.matches.length ? named.matches : parent!.matches).sort((a, b) => a.rank - b.rank)[0];
      association.variantId = chosen.variant.id;
      association.selectedCode = chosen.code;
      association.method = named.exact ? chosen.method : named.matches.length ? 'Código delimitado en nombre' : 'Código inequívoco en carpeta';
      association.confidence = named.exact ? 1 : named.matches.length ? 0.94 : parent!.exact ? 0.93 : 0.89;
      chosen.variant.images.push(file.id);
      if (!chosen.variant.category) {
        chosen.variant.category = file.path.slice(2, -1).find((part, index) =>
          index < 2 && !/^(OK|FALTANTES NUEVOS)$/i.test(part.trim()) && !lookup(part).mention)?.trim() || '';
      }
    }
    association.hash = file.sha256Checksum ? `sha256:${file.sha256Checksum}` : file.md5Checksum ? `md5:${file.md5Checksum}` : undefined;
    if (association.hash) {
      association.duplicateOf = firstByHash.get(association.hash);
      if (!association.duplicateOf) firstByHash.set(association.hash, file.id);
    }
    associations.push(association);
  }
  const byHash = new Map<string, Association[]>();
  for (const association of associations) {
    if (!association.hash) continue;
    const matching = byHash.get(association.hash) || [];
    matching.push(association);
    byHash.set(association.hash, matching);
  }
  // Identical bytes assigned to different groups need human confirmation. Retain every copy.
  for (const matching of byHash.values()) {
    const assigned = unique(matching.flatMap(photo => photo.variantId ? [photo.variantId] : []));
    if (assigned.length < 2) continue;
    for (const id of assigned) variants.get(id)!.issues.push('Contenido idéntico también asociado a otra variante');
  }
  for (const variant of variants.values()) {
    if (!variant.images.length && variant.upload !== 'OK') variant.issues.push('Sin fotografías asociadas');
    variant.status = variant.issues.length ? 'REVISAR' : variant.upload === 'OK' ? 'SUBIDOS' : 'PENDIENTES';
    variant.images.sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name) || a.localeCompare(b));
  }
  return { variants: [...variants.values()].sort((a, b) => a.visual.localeCompare(b.visual)), associations };
}
export type Catalog = ReturnType<typeof catalog>;

export interface CopyPlan {
  fileId: string; directories: string[]; name: string;
}
export function copyPlan(files: Entry[], result: Catalog): CopyPlan[] {
  const variants = new Map(result.variants.map(variant => [variant.id, variant]));
  const associations = new Map(result.associations.map(association => [association.fileId, association]));
  const used = new Set<string>();
  return files.filter(file => isImage(file) || isWorkbook(file)).sort((a, b) => a.id.localeCompare(b.id)).map(file => {
    const association = associations.get(file.id);
    const variant = association?.variantId ? variants.get(association.variantId) : undefined;
    let directories: string[];
    if (isWorkbook(file)) directories = ['00 - FUENTES EXCEL'];
    else if (!variant) directories = ['02 - REVISAR', association?.review || reviewReason.missing];
    else {
      const leaf = [safe(variant.base), ...(variant.visual === variant.base ? [] : [safe(variant.visual)]), 'originales'];
      const category = safe(variant.category);
      if (variant.status === 'REVISAR') {
        const group = variant.issues.some(issue => /estado|calidad/i.test(issue)) ? reviewReason.status :
          variant.issues.some(issue => /SKC|identificador|otra variante/i.test(issue)) ? reviewReason.identity : reviewReason.insufficient;
        directories = ['02 - REVISAR', group, category, ...leaf];
      } else directories = [variant.status === 'SUBIDOS' ? '03 - SUBIDOS' : '01 - PENDIENTES', category, ...leaf];
    }
    const originalName = isWorkbook(file) ? file.name.trim().replace(/\s+/g, ' ') : file.name;
    let name = originalName;
    if (file.mimeType.includes('officedocument') && !/\.xlsx$/i.test(name)) name += '.xlsx';
    let key = JSON.stringify([...directories, folded(name)]);
    if (used.has(key)) {
      const extension = name.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] || '';
      const base = extension ? name.slice(0, -extension.length) : name;
      let counter = 0;
      do {
        name = `${base} [${file.id.slice(-8)}${counter ? `-${counter}` : ''}]${extension}`;
        key = JSON.stringify([...directories, folded(name)]);
        counter++;
      } while (used.has(key));
    }
    used.add(key);
    return { fileId: file.id, directories, name };
  });
}
