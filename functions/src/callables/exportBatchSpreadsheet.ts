import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Batch,
  ExportBatchSpreadsheetRequest,
  ExportBatchSpreadsheetResponse,
  ProductDraft,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';
import {
  exportBatchSpreadsheetWorkbook,
  getProductDraftMissingRequiredKeys,
} from '../spreadsheets/templateWorkbook';

const bucket = admin.storage().bucket();

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const sanitizeFileName = (value: string): string =>
  value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  || 'batch-export';

export const exportBatchSpreadsheet = onCall<
  ExportBatchSpreadsheetRequest,
  Promise<ExportBatchSpreadsheetResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin', 'operador', 'revisor']);

  const batchId = requireNonEmptyString(request.data?.batchId, 'El lote');
  const db = getAppFirestore();
  const batchRef = db.collection('batches').doc(batchId);
  const batchSnapshot = await batchRef.get();

  if (!batchSnapshot.exists) {
    throw new HttpsError('not-found', 'Lote no encontrado.');
  }

  const batch = { id: batchSnapshot.id, ...batchSnapshot.data() } as Batch;
  const templateId = requireNonEmptyString(batch.spreadsheetTemplateId, 'La plantilla del lote');
  const clientId = requireNonEmptyString(batch.clientId, 'El cliente del lote');

  const templateRef = db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(templateId);
  const [templateSnapshot, categoriesSnapshot, productDraftsSnapshot] = await Promise.all([
    templateRef.get(),
    templateRef.collection('categories').get(),
    batchRef.collection('productDrafts').get(),
  ]);

  if (!templateSnapshot.exists) {
    throw new HttpsError('not-found', 'La plantilla asociada al lote ya no existe.');
  }
  if (categoriesSnapshot.empty) {
    throw new HttpsError('not-found', 'La plantilla asociada al lote ya no tiene categorías disponibles.');
  }
  if (productDraftsSnapshot.empty) {
    throw new HttpsError('failed-precondition', 'El lote todavía no tiene product drafts para exportar.');
  }

  const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate;
  const categoriesById = new Map<string, SpreadsheetTemplateCategory>(
    categoriesSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as SpreadsheetTemplateCategory]),
  );
  const productDrafts = productDraftsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ProductDraft));
  productDrafts.forEach((draft) => {
    if (!categoriesById.has(draft.categoryId)) {
      throw new HttpsError('not-found', `La categoría ${draft.categoryId} del draft ${draft.garmentName} ya no existe.`);
    }
  });

  const missingRows = productDrafts.flatMap((draft) =>
    draft.rows.map((row, rowIndex) => ({
      garmentName: draft.garmentName,
      rowIndex: rowIndex + 1,
      missingKeys: getProductDraftMissingRequiredKeys(draft, row, categoriesById.get(draft.categoryId)!),
    })),
  ).filter((entry) => entry.missingKeys.length > 0);

  if (missingRows.length > 0) {
    const firstMissing = missingRows[0];
    throw new HttpsError(
      'failed-precondition',
      `Faltan campos requeridos en ${missingRows.length} fila(s). Primer faltante: ${firstMissing.garmentName}, fila ${firstMissing.rowIndex}, columnas ${firstMissing.missingKeys.join(', ')}.`,
    );
  }

  const workbookBuffer = await exportBatchSpreadsheetWorkbook({
    templateStoragePath: template.storagePath,
    categoriesById,
    productDrafts,
  });

  const fileName = `${sanitizeFileName(template.originalFileName || template.name)}-${sanitizeFileName(batch.id || batchId)}.xlsx`;
  const storagePath = `client_spreadsheet_exports/${clientId}/${batchId}/${randomUUID()}-${fileName}`;
  await bucket.file(storagePath).save(workbookBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const downloadUrl = await ensureStorageDownloadUrl(storagePath);

  return {
    success: true,
    batchId,
    storagePath,
    downloadUrl,
    fileName,
  };
});
