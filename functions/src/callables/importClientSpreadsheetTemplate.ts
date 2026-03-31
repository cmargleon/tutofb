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
import { getAppFirestore } from '../firebase/appFirestore';
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
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
  const storagePath = requireNonEmptyString(request.data?.storagePath, 'La ruta del spreadsheet');
  const originalFileName = requireNonEmptyString(request.data?.originalFileName, 'El nombre del archivo');

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
  const [buffer] = await bucket.file(storagePath).download();
  const parsed = parseSpreadsheetTemplateWorkbook({
    clientId,
    clientNameSnapshot: client.name,
    storagePath,
    originalFileName,
    createdByUid: request.auth!.uid,
    buffer,
  });

  if (parsed.template.categories.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      'No encontramos hojas de categorías operativas en el spreadsheet subido.',
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const templateRef = clientRef.collection('spreadsheetTemplates').doc();
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
