import * as xlsx from 'xlsx';
import { type OrganizerDocumentStatus, type OrganizerProductRow, type OrganizerTab, type OrganizerVariant } from '../../../shared/src/types';
import { digest, SHEET, type DriveFile, type OrganizerDrive } from './drive';

export const ALGORITHM_VERSION = '3';
export const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();
export const code = (value: string) => normalize(value).replace(/\s*-\s*/g, '-').replace(/PACK[ -]*(\d+)/g, 'PACK$1');
const aliases: Record<string, string> = {
  SKC: 'skc', 'CODIGO SKC': 'skc', SKU: 'sku', 'CODIGO SKU': 'sku', 'CODIGO DE PRODUCTO': 'sku', REFERENCIA: 'sku',
  SPU: 'base', 'PRODUCTO BASE': 'base', 'MODELO BASE': 'base', NOMBRE: 'name', NOMBR: 'name',
  'NOMBRE DEL PRODUCTO': 'name', 'NOMBRE COMERCIAL': 'name', PRODUCTO: 'name', DESCRIPCION: 'description',
  CATEGORIA: 'category', 'TIPO DE PRODUCTO': 'category', COLOR: 'color', COLOUR: 'color', CAPACIDAD: 'capacity', VOLUMEN: 'capacity',
  CODIGO: 'sku', CODE: 'sku', ARTICULO: 'name', PRECIO: 'price',
  TALLA: 'size', SIZE: 'size', TAMANO: 'size', PACK: 'pack', PRESENTACION: 'pack', 'UNIDADES POR PACK': 'pack',
  'VALORES DE LAS VARIANTES': 'attributes', ATRIBUTOS: 'attributes', VARIANTES: 'attributes',
  'FOTO IA': 'photo', 'FOTOGRAFIA IA': 'photo', 'IMAGEN IA': 'photo', UPLOAD: 'upload', SUBIDA: 'upload',
  SUBIDO: 'upload', CARGADO: 'upload', PUBLICAR: 'publish', PUBLICADO: 'publish', PUBLICACION: 'publish',
  COMENTARIO: 'comments', COMENTARIOS: 'comments', OBSERVACIONES: 'comments', NOTAS: 'comments', CALIDAD: 'comments',
};
export const distinct = <T>(items: T[]) => [...new Set(items)];
const displayCode = (value: string) => /^[A-Z0-9][A-Z0-9._+/-]{0,100}$/.test(value) ? value : '';
export const CATALOG_FIELDS = distinct([...Object.values(aliases), '']);
export type TabMapping = { headerRow: number; fields: string[] };

export const parseTab = (file: Pick<DriveFile, 'id' | 'name'>, name: string, tabId: number | null, grid: string[][], startRow = 0, startColumn = 0,
  original = (row: number, col: number): string | number | boolean => grid[row]?.[col] || '',
  merged: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [], mapping?: TabMapping,
  hyperlinks: { url: string; cell: string }[] = []) => {
  const tab: OrganizerTab = { id: digest([file.id, tabId ?? name]), fileId: file.id, fileName: file.name, name, tabId,
    headerRow: null, imported: 0, skipped: 0, issue: null, samples: grid.slice(0, 16).map((row, r) => ({ values: row.slice(0, 24), originalValues: row.slice(0, 24).map((_, c) => original(r, c)) })), sampleStartRow: startRow + 1,
    links: [...hyperlinks, ...grid.flatMap((row, r) => row.flatMap((value, c) =>
      [...value.matchAll(/https:\/\/[^\s"<>]+/g)].map(match => ({ url: match[0], cell: xlsx.utils.encode_cell({ r: r + startRow, c: c + startColumn }) }))))]
      .filter(link => /^https:\/\//i.test(link.url)).map(link => ({ ...link, sourceId: link.url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/)?.[1] || null })) };
  const rows: OrganizerProductRow[] = [];
  const fieldsFor = (row: string[]) => row.map(value => aliases[normalize(value).replace(/[:.]+$/, '')] || '');
  let header = -1;
  let score = 0;
  for (let index = 0; index < grid.length; index++) {
    const fields = new Set(fieldsFor(grid[index]).filter(Boolean));
    if ((fields.has('skc') || fields.has('sku')) && fields.size > score) {
      header = index;
      score = fields.size;
    }
  }
  if (mapping && mapping.headerRow >= startRow + 1 && mapping.headerRow <= startRow + grid.length &&
    mapping.fields.every(field => CATALOG_FIELDS.includes(field)) && mapping.fields.some(field => ['skc', 'sku'].includes(field))) {
    header = mapping.headerRow - startRow - 1;
  }
  if (header < 0) {
    tab.issue = grid.some(row => row.some(Boolean)) ? 'Sin encabezados SKU/SKC reconocidos.' : 'Pestaña vacía.';
    return { tab, rows };
  }
  tab.headerRow = startRow + header + 1;
  let fields = mapping?.fields || fieldsFor(grid[header]);
  tab.columnMap = fields;
  let anchor: OrganizerProductRow | undefined;
  for (let index = header + 1; index < grid.length; index++) {
    const row = grid[index];
    if (!row.some(value => value.trim())) { anchor = undefined; continue; }
    const repeated = fieldsFor(row);
    if (repeated.some(field => field === 'skc' || field === 'sku') && repeated.filter(Boolean).length >= 2) {
      fields = repeated; anchor = undefined; continue;
    }
    const cells = row.flatMap((value, col) => {
      const originalValue = original(index, col);
      return value === '' && originalValue === '' ? [] : [{ column: xlsx.utils.encode_col(startColumn + col), value, originalValue, field: fields[col] || '' }];
    });
    const inferred: NonNullable<OrganizerProductRow['inferred']> = mapping ? distinct(fields.filter(Boolean)).map(field => ({
      field, fromLine: tab.headerRow!, reason: 'Mapeo de columnas propuesto por IA',
    })) : [];
    const get = (field: string) => {
      const direct = distinct(cells.filter(cell => cell.field === field).map(cell => cell.value.trim()).filter(Boolean)).join(' | ');
      if (direct) return direct;
      const col = fields.indexOf(field);
      const merge = merged.find(range => col + startColumn >= range.s.c && col + startColumn <= range.e.c &&
        index + startRow > range.s.r && index + startRow <= range.e.r);
      if (!merge) return '';
      inferred.push({ field, fromLine: merge.s.r + 1, reason: 'Celda combinada' });
      return grid[merge.s.r - startRow]?.[merge.s.c - startColumn] || '';
    };
    let skc = displayCode(code(get('skc')));
    let sku = displayCode(code(get('sku')));
    const continuation = !skc && !sku && anchor && ['color', 'size', 'pack', 'capacity', 'attributes'].some(field => get(field)) &&
      !get('name') && !get('description') && !get('category');
    if (continuation) {
      skc = anchor!.skc; sku = anchor!.sku;
      for (const field of ['skc', 'sku', 'base', 'name', 'category'])
        inferred.push({ field, fromLine: anchor!.line, reason: 'Continuación de variante contigua' });
    }
    if (!skc && !sku) { tab.skipped++; anchor = undefined; continue; }
    const attributes = get('attributes');
    const size = get('size') || attributes.match(/(?:^|[;,])\s*TALLA\s*:\s*([^;,]+)/i)?.[1]?.trim() || '';
    const color = get('color') || attributes.match(/(?:^|[;,])\s*COLOR\s*:\s*([^;,]+)/i)?.[1]?.trim() || '';
    const identifier = skc || sku;
    const base = code(get('base')) || (continuation ? anchor!.base : '') || identifier.split('-')[0].replace(/PACK\d+$/, '') || identifier;
    const packText = get('pack');
    const quantity = packText.match(/^\d+$/)?.[0] || code(packText || identifier).match(/PACK(\d+)/)?.[1];
    const pack = quantity ? `PACK ${quantity}` : packText;
    rows.push({ fileId: file.id, fileName: file.name, tab: name, tabId, line: startRow + index + 1, cells, skc, sku, base,
      name: get('name') || get('description') || (continuation ? anchor!.name : ''), category: get('category') || (continuation ? anchor!.category : ''), color, size, pack,
      description: get('description'), capacity: get('capacity'), inferred,
      photo: get('photo'), upload: get('upload'), publish: get('publish'), comments: get('comments') });
    anchor = rows.at(-1);
  }
  tab.imported = rows.length;
  return { tab, rows };
};

export async function* readWorkbook(drive: Pick<OrganizerDrive, 'tabs' | 'tabValues' | 'tabOriginalValues' | 'sourceWorkbook'>, file: DriveFile,
  mappings = new Map<string, TabMapping>()) {
  if (file.mimeType === SHEET) {
    for (const tab of await drive.tabs(file.id)) {
      if (tab.sheetType === 'OBJECT') {
        yield { tab: { id: digest([file.id, tab.sheetId]), fileId: file.id, fileName: file.name, name: tab.title,
          tabId: tab.sheetId, headerRow: null, imported: 0, skipped: 0, issue: 'Pestaña sin cuadrícula.' }, rows: [] };
        continue;
      }
      const [values, original] = await Promise.all([
        drive.tabValues(file.id, tab.title), drive.tabOriginalValues(file.id, tab.title),
      ]);
      const parsed = parseTab(file, tab.title, tab.sheetId, values, 0, 0, (row, col) => original[row]?.[col] ?? values[row]?.[col] ?? '', tab.merges || [], mappings.get(digest([file.id, tab.sheetId])),
        original.flatMap((row, r) => row.flatMap((value, c) => typeof value === 'string' ? [...value.matchAll(/https:\/\/[^\s"<>),]+/g)].map(match => ({ url: match[0], cell: xlsx.utils.encode_cell({ r, c }) })) : [])));
      parsed.rows.forEach(row => row.sourceVersion = file.version || file.modifiedTime || '');
      yield parsed;
    }
    return;
  }
  const workbook = xlsx.read(await drive.sourceWorkbook(file), { type: 'buffer' });
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    const start = worksheet['!ref'] ? xlsx.utils.decode_range(worksheet['!ref']).s : { r: 0, c: 0 };
    const parsed = parseTab(file, name, null, xlsx.utils.sheet_to_json<string[]>(worksheet, {
      header: 1, raw: false, defval: '', blankrows: true,
    }), start.r, start.c, (row, col) => {
      const cell = worksheet[xlsx.utils.encode_cell({ r: start.r + row, c: start.c + col })];
      return cell?.f ? '=' + cell.f : cell?.v ?? '';
    }, worksheet['!merges'] || [], mappings.get(digest([file.id, name])), Object.entries(worksheet).flatMap(([cell, value]) =>
      !cell.startsWith('!') && value?.l?.Target ? [{ cell, url: value.l.Target }] : []));
    parsed.rows.forEach(row => row.sourceVersion = file.version || file.modifiedTime || '');
    yield parsed;
  }
}

const sizeAliases: Record<string, string[]> = { CH: ['CHICO', 'CHICA', 'S'], M: ['MEDIANA', 'MEDIANO'], G: ['GRANDE', 'L'], EX: ['EXTRA GRANDE', 'XL'] };
export const visualCode = (row: OrganizerProductRow) => {
  const pieces = (row.skc || row.sku).split('-');
  const suffix = pieces.at(-1)!;
  const size = normalize(row.size);
  if (pieces.length > 1 && size && (suffix === size || sizeAliases[suffix]?.includes(size))) pieces.pop();
  return pieces.join('-');
};
export const variantKey = (row: OrganizerProductRow) => digest([row.base, visualCode(row), normalize(row.color), normalize(row.pack), ...(row.capacity ? [normalize(row.capacity)] : [])]);
export function groupProductRows(rows: OrganizerProductRow[]) {
  const byCode = new Map<string, OrganizerProductRow[]>();
  for (const row of rows) for (const key of distinct([row.skc, row.sku].filter(Boolean))) {
    const candidates = byCode.get(key) || [];
    candidates.push(row);
    byCode.set(key, candidates);
  }
  const groups = new Map<string, OrganizerProductRow[]>();
  const anchors = new Map<string, OrganizerProductRow>();
  for (const row of rows) {
    const candidates = distinct([...(byCode.get(row.skc) || []), ...(byCode.get(row.sku) || [])])
      .filter(other => (!row.color || !other.color || normalize(row.color) === normalize(other.color)) &&
        (!row.pack || !other.pack || normalize(row.pack) === normalize(other.pack)) &&
        (!row.capacity || !other.capacity || normalize(row.capacity) === normalize(other.capacity)) &&
        (!row.skc || !other.skc || row.skc === other.skc));
    const complete = candidates.filter(other => (!row.skc && other.skc || !row.color && other.color || !row.pack && other.pack || !row.size && other.size));
    const possible = distinct(complete.map(variantKey));
    const anchor = possible.length === 1 ? complete[0] : row;
    const key = variantKey(anchor);
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
    anchors.set(key, anchor);
  }
  return { groups, anchors };
}

export function identityFromFilename(file: { id: string; name: string; path: string[] }): OrganizerProductRow | null {
  const stem = code(file.name.replace(/\.[^.]{2,5}$/, ''));
  if (!/^[A-Z]{1,8}\d{2,}(?:[A-Z]+|-[A-Z0-9]+|PACK\d*)*$/.test(stem)) return null;
  const pack = stem.match(/PACK(\d+)/)?.[1];
  return { fileId: file.id, fileName: file.name, tab: '', tabId: null, line: 0, cells: [],
    skc: stem, sku: '', base: stem.split('-')[0].replace(/PACK\d*$/, ''), name: stem,
    category: '', color: '', size: '', pack: pack ? `PACK ${pack}` : '', photo: '', upload: '', publish: '', comments: '' };
}

const positive = /^(OK|SI|LIST[OA]|COMPLETAD[OA]|SUBID[OA]|PUBLICAD[OA])$/;
const negative = /^(NO|PENDIENTE|FALTA|NO SUBIDO|NO PUBLICADO)$/;
const stage = (values: string[]): OrganizerDocumentStatus => {
  const states = distinct(values.map(normalize).filter(Boolean).map(value => positive.test(value) ? 'ok' : negative.test(value) ? 'pending' : 'review'));
  return states.length > 1 ? 'review' : states[0] || 'unrecorded';
};
export function productVariant(id: string, rows: OrganizerProductRow[], previous?: OrganizerVariant, anchor?: OrganizerProductRow): OrganizerVariant {
  const row = anchor || rows[0];
  const documented = { photo: stage(rows.map(item => item.photo)), upload: stage(rows.map(item => item.upload)), publish: stage(rows.map(item => item.publish)) };
  const issues = [
    ...(rows.some(item => item.inferred?.some(inference => inference.reason === 'Mapeo de columnas propuesto por IA')) ? ['Columnas interpretadas por IA; revisa las celdas originales.'] : []),
    ...(['photo', 'upload', 'publish'] as const).filter(field => documented[field] === 'review').map(field => `Estado documental contradictorio o ambiguo (${field}).`),
    ...rows.filter(item => /\b(CAMBIAR|REPETIR|CORREGIR|REHACER|FALTA|BORROSA|INCORRECTA)\b/.test(normalize(item.comments)))
      .map(item => `${item.fileName} · ${item.tab} · ${item.line}: ${item.comments}`),
  ];
  const catalogFingerprint = digest(rows.map(item => [item.skc, item.sku, item.name, item.description, item.category, item.color, item.size, item.pack, item.capacity || '']).sort());
  const keepReferences = !previous?.catalogFingerprint || previous.catalogFingerprint === catalogFingerprint;
  return { id, base: row.base, visual: visualCode(row), name: rows.find(item => item.name)?.name || visualCode(row), capacity: row.capacity || '', catalogFingerprint,
    description: distinct(rows.map(item => item.description || '').filter(Boolean)).join(' | ').slice(0, 2000),
    sourceTabs: distinct(rows.filter(item => item.line > 0).map(item => digest([item.fileId, item.tabId ?? item.tab]))),
    color: row.color, pack: row.pack, category: rows.find(item => item.category)?.category || '',
    skcs: distinct(rows.map(item => item.skc).filter(Boolean)), skus: distinct(rows.map(item => item.sku).filter(Boolean)),
    sizes: distinct(rows.map(item => item.size).filter(Boolean)), status: issues.length ? 'review' : documented.upload === 'ok' ? 'uploaded' : 'pending', documented,
    issues: distinct(issues).slice(0, 25), referenceState: keepReferences ? previous?.referenceState || 'pending' : 'pending',
    references: keepReferences ? previous?.references || { front: [], back: [], main: [] } : { front: [], back: [], main: [] }, driveFolderUrl: previous?.driveFolderUrl || null };
}

const container = /^(ROPA|COCINA|FOTOS|FOTOGRAFIAS|SUBIR A SHEIN|IMAGENES|ORIGINALES|PRODUCTOS|CATALOGO|CATEGORIAS|OK|VARIOS)$/;
export const candidatesIn = (label: string, index: Map<string, Set<string>>) => {
  let name = code(label.replace(/\.[^.]{2,5}$/i, ''));
  if (index.has(name)) return [...index.get(name)!];
  // A trailing photographic sequence or a pasted extension is not a new catalog identity.
  name = name.replace(/(?:PNG|JPE?G|WEBP)$/i, '');
  const tokens = name.match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) || [];
  return distinct(tokens.flatMap(token => {
    const exact = index.get(token);
    if (exact) return [...exact];
    const sequence = token.match(/^(.*)-\d+$/)?.[1];
    if (sequence && index.has(sequence)) return [...index.get(sequence)!];
    const base = token.split('-')[0];
    return index.has(base) ? [...index.get(base)!] : [];
  }));
};
export function associationIndex(variants: OrganizerVariant[]) {
  const index = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const token of distinct([variant.visual, variant.base, ...variant.skcs, ...variant.skus])) {
      const key = code(token);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(variant.id);
    }
  }
  return index;
}
type PhotoCandidate = { id: string; name: string; path: string[]; parents?: string[]; sha256Checksum?: string; md5Checksum?: string; size?: string };
export function associatePhotos(files: PhotoCandidate[], index: Map<string, Set<string>>, manual: Map<string, string | null>) {
  const own = new Map(files.map(file => [file.id, candidatesIn(file.name, index)]));
  const siblings = new Map<string, string[]>();
  for (const file of files) {
    const parent = file.parents?.[0] || '';
    const known = manual.has(file.id) ? [manual.get(file.id)].filter((item): item is string => Boolean(item)) : own.get(file.id)!;
    siblings.set(parent, distinct([...(siblings.get(parent) || []), ...known]));
  }
  const byHash = new Map<string, string[]>();
  const results = new Map(files.map(file => {
    const parent = file.parents?.[0] || '';
    const folder = file.path.slice(1, -1).reverse().find(name => !container.test(normalize(name)) && candidatesIn(name, index).length);
    const folderCandidates = folder ? candidatesIn(folder, index) : [];
    const explicit = own.get(file.id)!;
    const neighboring = siblings.get(parent) || [];
    const generalFolder = container.test(normalize(file.path.at(-2) || ''));
    const candidates = distinct([...explicit, ...folderCandidates, ...neighboring]);
    const shared = explicit.length > 1 && /(?:\sY\s|\sAND\s|[&+])/i.test(file.name);
    const variantId = manual.has(file.id) ? manual.get(file.id)! : shared ? null
      : explicit.length === 1 && (!folderCandidates.length || folderCandidates.includes(explicit[0])) ? explicit[0]
        : !explicit.length && candidates.length === 1 && (!generalFolder || folderCandidates.length === 1)
          ? candidates[0] : null;
    const method = manual.has(file.id) ? 'manual' : !variantId ? 'pendiente' : explicit.length ? 'codigo_archivo' : folderCandidates.length ? 'codigo_ruta' : 'fotos_hermanas';
    const hash = file.sha256Checksum ? `sha256:${file.sha256Checksum}` : file.md5Checksum ? `md5:${file.md5Checksum}:${file.size}` : '';
    if (hash) byHash.set(hash, [...(byHash.get(hash) || []), file.id]);
    return [file.id, { variantId, candidates, method, evidence: [file.name, ...(folder ? [folder] : [])],
      confidence: variantId ? method === 'codigo_archivo' || method === 'manual' ? 1 : 0.95 : 0,
      variantIds: variantId ? [variantId] : shared ? explicit : [], identityState: variantId ? 'variant' as const : shared ? 'shared' as const : 'unresolved' as const,
      issue: variantId || shared ? null : candidates.length > 1 ? 'Conflicto de identidad' :
        generalFolder && neighboring.length ? 'Carpeta general con fotos sin identificador' : 'Sin identificación',
      duplicateOf: null as string | null }] as [string, { variantId: string | null; candidates: string[]; method: string; evidence: string[]; confidence: number; issue: string | null; duplicateOf: string | null; variantIds: string[]; identityState: 'variant' | 'shared' | 'unresolved' }];
  }));
  for (const [hash, ids] of byHash) {
    for (const [position, id] of ids.entries()) {
      results.get(id)!.duplicateOf = position ? ids[0] : null;
      if (position) results.get(id)!.evidence.push(`Contenido repetido: ${hash}; identidad independiente`);
    }
  }
  return results;
}
