import type { Catalog, CopyPlan, Entry, SheetAudit } from './catalog.ts';
import { isImage, isWorkbook, PILOT, unique } from './catalog.ts';
import type { Spend } from './references.ts';

export interface Receipt {
  sourceFileId: string; id: string; parentId: string; name: string; url: string; verified: boolean;
}
export type Table = (string | number)[][];
export const driveFileUrl = (id: string) => `https://drive.google.com/open?id=${id}`;
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const lists = (values: string[]) => unique(values).filter(Boolean).join(' | ');
export interface Prepared {
  files: Entry[]; catalog: Catalog; sources: SheetAudit[]; copies: CopyPlan[]; spend: Spend;
  errors: string[];
}
export function report(prepared: Prepared, receipts: Receipt[], verification?: { changed: string[]; added: string[] }) {
  const { files, catalog, sources, spend, copies } = prepared;
  const { variants, associations } = catalog;
  const plans = new Map(copies.map(copy => [copy.fileId, copy]));
  const copied = new Map(receipts.filter(copy => copy.verified).map(copy => [copy.sourceFileId, copy]));
  const byVariant = new Map(variants.map(variant => [variant.id, variant]));
  const byPhoto = new Map(associations.map(photo => [photo.fileId, photo]));
  const byFile = new Map(files.map(file => [file.id, file]));
  const photoLink = (id?: string) => id ? (copied.get(id)?.url || driveFileUrl(id)) : '';
  const references = (ids?: string[]) => (ids || []).map(photoLink).join('\n');
  const review: Table = [['Tipo', 'Identificador', 'Qué revisar', 'Evidencia', 'Enlace']];
  const products: Table = [[
    'Cliente', 'Producto base', 'SKU / variante visual', 'SKC comerciales', 'Nombre comercial', 'Categoría', 'Color', 'Pack',
    'Fotos originales', 'Fotos únicas', 'FOTO IA', 'UPLOAD según Excel', 'PUBLICAR según Excel', 'Estado de organización',
    'Estado de calidad', 'Referencia frontal y alternativa', 'Referencia trasera y alternativa', 'Referencia de objeto y alternativa',
    'Carpeta organizada', 'Excel, hoja y fila', 'Observaciones', 'Confianza mínima', 'Selección visual', 'Estado SHEIN',
  ]];
  for (const v of variants) {
    const provenance = lists(v.rows.map(row => `${row.fileName} / ${row.sheet} / ${row.line} (${row.skc})`));
    const folder = v.images.map(id => copied.get(id)?.parentId).find(Boolean);
    const confidence = v.images.length ? Math.min(...v.images.map(id => byPhoto.get(id)!.confidence)) : '';
    const uniqueCount = unique(v.images.map(id => byPhoto.get(id)?.hash || id)).length;
    products.push([
      PILOT.client, v.base, v.visual, v.skcs.join(', '), v.name, v.category, v.color, v.pack, v.images.length, uniqueCount,
      v.photo, v.upload, v.publish, v.status, v.quality || 'Sin observación de calidad registrada',
      references(v.reference?.front), references(v.reference?.back), references(v.reference?.object),
      folder ? driveFolderUrl(folder) : '', provenance, lists([...v.issues, ...v.rows.map(row => row.fields.comments || '')]),
      confidence, v.reference?.state || (v.images.length ? 'Pendiente de análisis' : 'Sin imágenes asociadas'), 'Sin verificación externa',
    ]);
    if (v.status === 'REVISAR') review.push(['Variante', v.visual, lists(v.issues), provenance, folder ? driveFolderUrl(folder) : '']);
  }
  const photos: Table = [[
    'ID Drive', 'Nombre original', 'Ruta original', 'Tipo MIME', 'Hash', 'SKU / SKC asociado', 'Variante', 'Duplicado de',
    'Vista', 'Selección', 'Ruta organizada', 'Copia verificada', 'Método', 'Confianza', 'Evidencia', 'Versión', 'Modificado',
  ]];
  for (const file of files.filter(file => !file.folder)) {
    const a = byPhoto.get(file.id);
    const v = a?.variantId ? byVariant.get(a.variantId) : undefined;
    const r = v?.reference;
    const rank = [r?.front, r?.back, r?.object].find(ids => ids?.includes(file.id))?.indexOf(file.id);
    const plan = plans.get(file.id);
    photos.push([
      file.id, file.name, file.path.join(' / '), file.mimeType, a?.hash || file.sha256Checksum || file.md5Checksum || '',
      a?.selectedCode || '', v?.visual || '', a?.duplicateOf || '', r?.views?.[file.id] || '',
      rank === 0 ? 'Principal' : rank === 1 ? 'Alternativa' : '', plan ? [...plan.directories, plan.name].join(' / ') : '',
      copied.get(file.id)?.url || '', a?.method || '', a?.confidence ?? '', lists(a?.evidence || []),
      file.version || file.headRevisionId || '', file.modifiedTime || '',
    ]);
    if (a?.review) review.push(['Fotografía', file.name, a.review, lists([file.path.join(' / '), ...a.evidence, ...a.candidates]), driveFileUrl(file.id)]);
  }
  const spreadsheetSources: Table = [['Excel', 'ID Drive', 'Hoja', 'Fila de encabezados', 'Columnas reconocidas', 'Filas analizadas', 'Filas importadas', 'Errores']];
  for (const source of sources) spreadsheetSources.push([source.fileName, source.fileId, source.sheet, source.headerLine || '',
    lists(source.columns), source.rowsRead, source.rowsImported, lists(source.errors)]);
  const selected = variants.filter(v => v.reference?.state === 'Seleccionadas').length;
  const stats = {
    files: files.filter(file => !file.folder).length, folders: files.filter(file => file.folder).length,
    photos: files.filter(isImage).length, workbooks: files.filter(isWorkbook).length, copies: copied.size,
    baseProducts: unique(variants.map(v => v.base)).length, variants: variants.length, skcs: unique(variants.flatMap(v => v.skcs)).length,
    uploaded: variants.filter(v => v.status === 'SUBIDOS').length, pending: variants.filter(v => v.status === 'PENDIENTES').length,
    review: variants.filter(v => v.status === 'REVISAR').length, duplicates: associations.filter(a => a.duplicateOf).length,
    unassociated: associations.filter(a => !a.variantId).length, automatic: associations.filter(a => a.variantId).length,
    identityConflicts: associations.filter(a => a.review === 'CONFLICTO DE SKC').length,
    selectedGroups: selected, visualPending: variants.filter(v => v.images.length && v.reference?.state.startsWith('Pendiente')).length,
    selectedPrimary: variants.reduce((sum, v) => sum + [v.reference?.front, v.reference?.back, v.reference?.object].filter(ids => ids?.length).length, 0),
  };
  const summary: Table = [
    ['Indicador', 'Resultado'],
    ['Archivos encontrados', stats.files], ['Carpetas del origen', stats.folders], ['Imágenes', stats.photos], ['Excel / Sheets', stats.workbooks],
    ['Copias verificadas', stats.copies], ['Productos base', stats.baseProducts], ['Variantes visuales', stats.variants], ['Identificadores comerciales (SKC o SKU fuente)', stats.skcs],
    ['Variantes subidas según Excel', stats.uploaded], ['Variantes pendientes', stats.pending], ['Variantes en revisión', stats.review],
    ['Imágenes duplicadas exactas (adicionales)', stats.duplicates], ['Imágenes sin asociación', stats.unassociated],
    ['Asociaciones por nombre o ruta', stats.automatic], ['Conflictos de identidad en fotografías', stats.identityConflicts],
    ['Variantes con referencias completas', stats.selectedGroups], ['Referencias principales seleccionadas', stats.selectedPrimary],
    ['Variantes pendientes de análisis visual', stats.visualPending],
    ['Llamadas Gemini', spend.calls], ['Costo estimado Gemini (USD)', Number(spend.estimatedUsd.toFixed(6))],
    ['Reservado Gemini (USD)', spend.reservedUsd], ['Presupuesto Gemini (USD)', spend.budgetUsd],
    ['Incidencias técnicas registradas', prepared.errors.length + spend.errors.length],
    ['Fuente original', verification ? (verification.added.length || verification.changed.length ? 'Diferencias observadas al verificar' : 'Sin cambios detectados en archivos y subcarpetas') : 'Verificación posterior pendiente'],
    ['SHEIN', 'Estados observados en Excel. Publicación real sin verificar.'],
  ];
  const tables: Record<string, Table> = { Resumen: summary, Productos: products, Fotografías: photos, Revisar: review, 'Fuentes Excel': spreadsheetSources };
  return { tables, stats, text: [
    '# Informe del piloto · JISHOP', '', ...summary.slice(1).map(([label, value]) => `- ${label} · ${value}`),
    '', '## Criterios y hallazgos', '',
    'UPLOAD, FOTO IA y PUBLICAR se conservaron como estados independientes. Los valores vacíos indican información sin registrar.',
    'La carpeta OK se trató como una ubicación. Las observaciones de calidad prevalecieron sobre los indicadores de carga.',
    'Las tallas con evidencia explícita se agruparon por apariencia. Las presentaciones PACK se conservaron por separado.',
    'Los hashes exactos se compararon entre imágenes y se conservaron todas las copias. La similitud perceptual no se usó como prueba de duplicación.',
    'El organizador no vinculó ejecuciones previas de Manglar sin identificador inequívoco. Las sugerencias de imagen se limitan a variantes ya asociadas por evidencia.',
    '', '## Antes de activar automatización', '',
    'Normalizar SKU, variante visual y SKC en los archivos y las hojas. Separar las carpetas que combinan productos o packs.',
    'Consolidar los tres estados de Excel en columnas independientes, con fecha y responsable. Aclarar las fotos genéricas y las observaciones de calidad de la pestaña Revisar.',
    'Revisar manualmente las referencias sugeridas y definir cómo confirmar fotos repetidas de un mismo producto antes de aprobar automatización.',
    '', '## Incidencias', '', ...[...prepared.errors, ...spend.errors].map(error => `- ${error}`),
  ].join('\n') + '\n' };
}

export function sheetRequests(tables: Record<string, Table>, sheets: { id: number; title: string; exists: boolean }[], includeData: boolean) {
  const requests: object[] = [];
  for (const { id, title, exists } of sheets) {
    const rows = tables[title];
    const endColumnIndex = rows[0].length;
    const endRowIndex = rows.length;
    const range = { sheetId: id, startRowIndex: 0, endRowIndex, startColumnIndex: 0, endColumnIndex };
    const gridProperties = { frozenRowCount: 1, rowCount: Math.max(100, endRowIndex + 15), columnCount: Math.max(10, endColumnIndex) };
    if (!exists) requests.push({ addSheet: { properties: { sheetId: id, title, gridProperties } } });
    else requests.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties }, fields: 'gridProperties' } });
    if (includeData) requests.push({ updateCells: {
      start: { sheetId: id, rowIndex: 0, columnIndex: 0 },
      rows: rows.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) })),
      fields: 'userEnteredValue',
    } });
    requests.push({ repeatCell: {
      range: { ...range, endRowIndex: 1 }, cell: { userEnteredFormat: {
        backgroundColor: { red: 0.9, green: 0.92, blue: 0.94 },
        textFormat: { bold: true }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE',
      } }, fields: 'userEnteredFormat',
    } });
    requests.push({ updateDimensionProperties: {
      range: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: endColumnIndex },
      properties: { pixelSize: 170 }, fields: 'pixelSize',
    } });
    if (title === 'Resumen') requests.push({ updateDimensionProperties: {
      range: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 },
      properties: { pixelSize: 345 }, fields: 'pixelSize',
    } });
    if (endRowIndex > 1 && title !== 'Resumen') requests.push({ setBasicFilter: { filter: { range } } });
    if (title === 'Productos' && endRowIndex > 1) {
      const state = { ...range, startRowIndex: 1, startColumnIndex: 13, endColumnIndex: 14 };
      for (const [label, backgroundColor] of [
        ['SUBIDOS', { red: 0.88, green: 0.95, blue: 0.89 }],
        ['PENDIENTES', { red: 1, green: 0.96, blue: 0.83 }],
        ['REVISAR', { red: 0.99, green: 0.9, blue: 0.88 }],
      ] as const) requests.push({ addConditionalFormatRule: { index: 0, rule: {
        ranges: [state], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] }, format: { backgroundColor } },
      } } });
    }
  }
  return requests;
}
