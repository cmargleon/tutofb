import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  Batch,
  ProductDraft,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';
import { exportBatchSpreadsheetWorkbook } from './templateWorkbook';

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

export const sanitizeSpreadsheetFileName = (value: string): string =>
  value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  || 'batch-export';

export interface PreparedBatchSpreadsheetExport {
  batchId: string;
  batchRef: FirebaseFirestore.DocumentReference;
  batch: Batch;
  clientId: string;
  workbookBuffer: Buffer;
  workbookHash: string;
  fileName: string;
  sheetName: string;
}

export const prepareBatchSpreadsheetExport = async (
  batchId: string,
): Promise<PreparedBatchSpreadsheetExport> => {
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

  const workbookBuffer = await exportBatchSpreadsheetWorkbook({
    templateStoragePath: template.storagePath,
    categoriesById,
    productDrafts,
  });
  const baseName = `${sanitizeSpreadsheetFileName(template.originalFileName || template.name)}-${sanitizeSpreadsheetFileName(batch.id || batchId)}`;

  return {
    batchId,
    batchRef,
    batch,
    clientId,
    workbookBuffer,
    workbookHash: createHash('sha256').update(workbookBuffer).digest('hex'),
    fileName: `${baseName}.xlsx`,
    sheetName: baseName,
  };
};
