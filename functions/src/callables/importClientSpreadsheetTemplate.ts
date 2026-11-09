import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Client,
  ImportClientSpreadsheetTemplateRequest,
  ImportClientSpreadsheetTemplateResponse,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { validId } from '../manglar/access';
import { getAppFirestore } from '../firebase/appFirestore';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { analyzeMarketplaceTemplate, assertTemplateDocumentLimits } from '../spreadsheets/marketplaceTemplates';
import { loadWorkbookPackage } from '../spreadsheets/ooxmlWorkbook';
import { parseSpreadsheetTemplateWorkbook } from '../spreadsheets/templateWorkbook';

const bucket = admin.storage().bucket();

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const categoryDocIdForSheetName = (sheetName: string): string =>
  sheetName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  || 'category';

export const importClientSpreadsheetTemplate = onCall<
  ImportClientSpreadsheetTemplateRequest,
  Promise<ImportClientSpreadsheetTemplateResponse>
>({ timeoutSeconds: 300, memory: '1GiB', concurrency: 1 }, async (request) => {
  await assertCallableRoles(request, ['admin']);

  const clientId = validId(request.data?.clientId);
  const storagePath = requireNonEmptyString(request.data?.storagePath, 'La ruta del spreadsheet');
  const originalFileName = requireNonEmptyString(request.data?.originalFileName, 'El nombre del archivo');

  if (originalFileName.length > 180 || /[\\?#%]/.test(storagePath) || storagePath.split('/').some(p => !p || p === '.' || p === '..')) throw new HttpsError('invalid-argument', 'Ruta o nombre de plantilla inválidos.');
  if (!storagePath.startsWith(`client_spreadsheets/${clientId}/`)) {
    throw new HttpsError('permission-denied', 'La plantilla no está guardada en la ruta de cliente esperada.');
  }

  const db = getAppFirestore();
  const clientRef = db.collection('clients').doc(clientId);
  const clientSnapshot = await clientRef.get();
  if (!clientSnapshot.exists) {
    throw new HttpsError('not-found', 'Cliente no encontrado.');
  }

  const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
  if (client.status === 'archived') throw new HttpsError('failed-precondition', 'El cliente está archivado.');
  if (request.data.marketplaceId != null && !isMarketplaceId(request.data.marketplaceId)) throw new HttpsError('invalid-argument', 'Marketplace inválido.');
  const [metadata] = await bucket.file(storagePath).getMetadata();
  if (Number(metadata.size) > 20 * 1024 * 1024 || !(request.data.marketplaceId ? /\.xlsx$/i : /\.xlsx?$/i).test(originalFileName)) throw new HttpsError('invalid-argument', 'Sube un XLSX de hasta 20 MB.');
  const [buffer] = await bucket.file(storagePath).download();
  try { if (/\.xlsx$/i.test(originalFileName)) await loadWorkbookPackage(buffer); } catch (e) { throw new HttpsError('invalid-argument', (e as Error).message); }
  let parsed = parseSpreadsheetTemplateWorkbook({
    clientId,
    clientNameSnapshot: client.name,
    storagePath,
    originalFileName,
    createdByUid: request.auth!.uid,
    buffer,
  });

  if (request.data.marketplaceId) {
    const analyzed = await analyzeMarketplaceTemplate(buffer, request.data.marketplaceId, parsed.template, parsed.categories as SpreadsheetTemplateCategory[]);
    parsed = analyzed;
    if (request.data.replacesTemplateId) {
      const previous = await clientRef.collection('spreadsheetTemplates').doc(request.data.replacesTemplateId).get();
      if (!previous.exists || previous.get('exportConfig.marketplaceId') !== request.data.marketplaceId) throw new HttpsError('invalid-argument', 'Versión anterior inválida.');
      parsed.template.exportConfig!.version = (previous.get('exportConfig.version') || 1) + 1;
      parsed.template.exportConfig!.replacesTemplateId = previous.id;
      parsed.template.exportConfig!.legacyTemplateIds = [...new Set([previous.id, ...(previous.get('exportConfig.legacyTemplateIds') || [])])];
    }
  }

  if (!request.data.marketplaceId && parsed.template.categories.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      'No encontramos hojas de categorías operativas en el spreadsheet subido.',
    );
  }

  assertTemplateDocumentLimits(parsed.template, parsed.categories);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const templateRef = clientRef.collection('spreadsheetTemplates').doc();
  const immutablePath = `client_spreadsheets/${clientId}/${templateRef.id}/${originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await bucket.file(storagePath).copy(bucket.file(immutablePath));
  parsed.template.storagePath = immutablePath;
  const defaultCategory = parsed.template.categories[0] ?? null;
  const templateData: Omit<SpreadsheetTemplate, 'id'> = {
    ...parsed.template,
    defaultCategoryId: defaultCategory?.id ?? null,
    defaultCategoryLabel: defaultCategory?.label ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const writeBatch = db.batch();
  writeBatch.set(templateRef, templateData);

  parsed.categories.forEach((category) => {
    const categoryRef = templateRef.collection('categories').doc(categoryDocIdForSheetName(category.sheetName));
    const categoryData: Omit<SpreadsheetTemplateCategory, 'id'> = {
      ...category,
      templateId: templateRef.id,
      createdAt: now,
      updatedAt: now,
    };
    writeBatch.set(categoryRef, categoryData);
  });

  await writeBatch.commit();

  return {
    success: true,
    templateId: templateRef.id,
    categoryCount: parsed.categories.length,
    defaultCategoryId: defaultCategory?.id ?? null,
  };
});
