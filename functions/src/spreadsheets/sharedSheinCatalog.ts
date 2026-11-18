import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { SpreadsheetTemplate, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { repairSheinWorkbook } from './sheinWorkbook';
import { inspectWorkbookPackage, loadWorkbookPackage, patchWorkbookCells, xmlAttrs } from './ooxmlWorkbook';

const collection = 'sheinCatalogTemplates';
const prefix = 'shein-shared-';
const storagePrefix = 'marketplace_catalog/shein/';
const brandSheet = 'Lista de marcas válidas';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export const sheinCategoryCode = (name: string) => name.match(/\(\d+-(\d+)\)$/)?.[1];
export const isSharedSheinTemplate = (id: string) => id.startsWith(prefix);
export const sharedSheinTemplateRef = (id: string) => getAppFirestore().collection(collection).doc(id);
export const isSharedSheinPath = (template: SpreadsheetTemplate) =>
  isSharedSheinTemplate(template.id || '') && template.storagePath === `${storagePrefix}${template.templateFingerprint}.xlsx`;

const knownAuxiliarySheet = (name: string) =>
  ['Manual de operaciones', 'valor de atributo válido', brandSheet, 'MainAttributeDataSource_Main',
    'MainAttributeDataSource', 'MainAttributeValueDataSource'].includes(name) ||
  (name.startsWith('Lista de lugares de origen') && 'Lista de lugares de origen válidos'.startsWith(name));

/** Only the official template structure and its general catalogues may cross client boundaries. */
export async function sanitizeSharedSheinWorkbook(buffer: Buffer, categories: SpreadsheetTemplateCategory[]) {
  const zip = await loadWorkbookPackage(buffer);
  const inspection = await inspectWorkbookPackage(buffer);
  const captureSheets = new Set(categories.map(category => category.sheetName));
  const allowedParts = new Set(['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
    'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/theme/theme1.xml',
    ...inspection.sheets.map(sheet => sheet.path)]);
  if (inspection.warnings.length || inspection.sheets.some(sheet => !captureSheets.has(sheet.name) && !knownAuxiliarySheet(sheet.name)) ||
      Object.values(zip.files).some(file => !file.dir && !allowedParts.has(file.name))) {
    throw new HttpsError('failed-precondition', 'Usa una plantilla oficial de SHEIN sin hojas adicionales, adjuntos ni comentarios para publicar el catálogo.');
  }
  const workbookRelationships = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  if (/TargetMode\s*=\s*["']External/i.test(workbookRelationships)) throw new Error('Enlace externo en la plantilla SHEIN.');
  const originalStrings = await zip.file('xl/sharedStrings.xml')?.async('string');
  const strings = [...(originalStrings || '').matchAll(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g)].map(match => match[0]);
  const retainedStrings = new Map<number, number>();
  for (const sheet of inspection.sheets) {
    const firstPrivateRow = captureSheets.has(sheet.name) ? 7 : sheet.name === brandSheet ? 2 : null;
    let xml = sheet.xml;
    if (firstPrivateRow) {
      xml = xml.replace(/<row\b([^>]*?)(?:\/>|>[\s\S]*?<\/row>)/g, (row, attributes) =>
        Number(xmlAttrs(attributes).r) >= firstPrivateRow ? '' : row);
    }
    xml = xml.replace(/(<c\b[^>]*\bt=["']s["'][^>]*>\s*<v>)(\d+)(<\/v>)/g, (_, before, raw, after) => {
      const id = Number(raw);
      if (!strings[id]) throw new Error('Índice de texto inválido en la plantilla SHEIN.');
      if (!retainedStrings.has(id)) retainedStrings.set(id, retainedStrings.size);
      return before + retainedStrings.get(id) + after;
    });
    if (captureSheets.has(sheet.name)) {
      xml = xml.replace(/('Lista de marcas válidas'!\$A\$2:)\$A\$\d+/g, '$1$$A$$2001');
    }
    zip.file(sheet.path, xml);
  }
  if (originalStrings) {
    zip.file('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      [...retainedStrings.keys()].map(id => strings[id]).join('') + '</sst>');
  }
  for (const part of ['docProps/app.xml', 'docProps/core.xml']) zip.remove(part);
  for (const part of ['[Content_Types].xml', '_rels/.rels']) {
    const xml = await zip.file(part)!.async('string');
    if (/TargetMode\s*=\s*["']External/i.test(xml)) throw new Error('Enlace externo en la plantilla SHEIN.');
    zip.file(part, xml.replace(/<(?:Override|Relationship)\b[^>]*docProps\/[^>]*\/>/g, ''));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Build the brand list for the current export from that client's product values. */
export async function applySharedSheinBrands(buffer: Buffer, brands: string[]) {
  const values = [...new Set(brands.filter(Boolean))];
  if (!values.length || !(await inspectWorkbookPackage(buffer)).sheets.some(sheet => sheet.name === brandSheet)) return buffer;
  if (values.length > 2000) throw new Error('Demasiadas marcas para una sola exportación SHEIN.');
  return patchWorkbookCells(buffer, [{
    sheetName: brandSheet,
    cells: values.flatMap((value, index) => [
      { address: `A${index + 2}`, value },
      { address: `B${index + 2}`, value: value.replace(/\s*\([^)]+\)$/, '') },
    ]),
  }]);
}

export async function prepareSharedSheinRelease(buffer: Buffer, base: SpreadsheetTemplate, categories: SpreadsheetTemplateCategory[]) {
  const codes = categories.map(category => sheinCategoryCode(category.sheetName));
  // Older hand-built sheets can still be configured locally.
  if (codes.some(code => !code) || new Set(codes).size !== codes.length) return null;
  const workbook = await sanitizeSharedSheinWorkbook(await repairSheinWorkbook(buffer), categories);
  const workbookFingerprint = hash(workbook);
  const storagePath = `${storagePrefix}${workbookFingerprint}.xlsx`;
  const inspection = await inspectWorkbookPackage(workbook);
  const db = getAppFirestore();
  const entries = categories.map((source, index) => {
    const code = codes[index]!;
    const category = { ...source, id: code, clientId: '', columns: source.columns.map(column => {
      if (column.key !== 'brand_code') return column;
      const { dropdownOptions: _options, dropdownFormula: _formula, dropdownDependency: _dependency, ...brand } = column;
      return brand;
    }) };
    const rules = { ...base.exportConfig!.mappings[source.id!] };
    if (rules.brand_code) rules.brand_code = { ...rules.brand_code, source: 'product.brand' };
    const validations = inspection.sheets.find(sheet => sheet.name === source.sheetName)!.validations
      .map(({ options: _options, ...validation }) => validation);
    const fingerprint = hash(JSON.stringify([category.columns, category.attributes, source.rowStart, rules, validations]));
    const ref = sharedSheinTemplateRef(prefix + db.collection(collection).doc().id);
    const head = db.collection('sheinCatalogCategories').doc(code);
    return { ref, head, code, category, rules, fingerprint };
  });
  const file = admin.storage().bucket().file(storagePath);
  try {
    await file.save(workbook, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      preconditionOpts: { ifGenerationMatch: 0 } });
  } catch (error) {
    if ((error as { code?: number }).code !== 412) throw error;
  }
  return { base, entries, storagePath, workbookFingerprint };
}

export async function readSharedSheinRelease(tx: FirebaseFirestore.Transaction, release: Awaited<ReturnType<typeof prepareSharedSheinRelease>>) {
  if (!release) return () => {};
  const heads = await tx.getAll(...release.entries.map(entry => entry.head));
  return () => {
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const [index, entry] of release.entries.entries()) {
      const previous = heads[index];
      if (previous.get('fingerprint') === entry.fingerprint) continue;
      const previousId = previous.get('templateId') as string | undefined;
      const version = (Number(previous.get('version')) || 0) + 1;
      const { category, code, ref } = entry;
      const template: SpreadsheetTemplate = {
        clientId: '', clientNameSnapshot: '', name: `SHEIN · ${category.label}`, originalFileName: 'SHEIN.xlsx',
        storagePath: release.storagePath, mimeType: release.base.mimeType, status: 'active',
        parserVersion: release.base.parserVersion, templateFingerprint: release.workbookFingerprint,
        categoryIds: [code], categories: [{ id: code, sheetName: category.sheetName, label: category.label,
          rowStart: category.rowStart, columnCount: category.columns.length, attributeCount: category.attributes.length }],
        defaultCategoryId: code, defaultCategoryLabel: category.label, brandOptions: [], originOptions: release.base.originOptions,
        createdAt: now, updatedAt: now, createdByUid: '',
        exportConfig: {
          marketplaceId: 'shein', operation: 'listing', version, validationStatus: 'compatible', validationMessages: [],
          mappings: { [code]: entry.rules }, confirmedAt: now, ...(previousId ? { replacesTemplateId: previousId } : {}),
        },
      };
      tx.create(ref, template);
      tx.create(ref.collection('categories').doc(code), { ...category, templateId: ref.id, createdAt: now, updatedAt: now });
      tx.set(entry.head, { templateId: ref.id, version, fingerprint: entry.fingerprint, updatedAt: now });
      if (previousId) tx.update(sharedSheinTemplateRef(previousId), {
        status: 'archived', archivedAt: now, updatedAt: now, 'exportConfig.supersededByTemplateId': ref.id,
      });
    }
  };
}

export async function loadSharedSheinTemplates(referenced: string[]) {
  const db = getAppFirestore();
  const refs = [...new Set(referenced.filter(isSharedSheinTemplate))].map(sharedSheinTemplateRef);
  const [active, historical] = await Promise.all([
    db.collection(collection).where('status', '==', 'active').get(),
    refs.length ? db.getAll(...refs) : [],
  ]);
  return [...new Map([...active.docs, ...historical.filter(doc => doc.exists)].map(doc => [doc.id, doc])).values()];
}
