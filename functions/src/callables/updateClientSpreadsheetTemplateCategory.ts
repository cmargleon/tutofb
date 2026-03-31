import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
  UpdateClientSpreadsheetTemplateCategoryRequest,
  UpdateClientSpreadsheetTemplateCategoryResponse,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

export const updateClientSpreadsheetTemplateCategory = onCall<
  UpdateClientSpreadsheetTemplateCategoryRequest,
  Promise<UpdateClientSpreadsheetTemplateCategoryResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
  const templateId = requireNonEmptyString(request.data?.templateId, 'La plantilla');
  const categoryId = typeof request.data?.categoryId === 'string' && request.data.categoryId.trim()
    ? request.data.categoryId.trim()
    : null;

  const db = getAppFirestore();
  const templateRef = db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(templateId);
  const templateSnapshot = await templateRef.get();
  if (!templateSnapshot.exists) {
    throw new HttpsError('not-found', 'Spreadsheet no encontrado.');
  }

  const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate;

  let categoryLabel: string | null = null;
  if (categoryId) {
    const categoryRef = templateRef.collection('categories').doc(categoryId);
    const categorySnapshot = await categoryRef.get();
    if (!categorySnapshot.exists) {
      throw new HttpsError('not-found', 'Categoría no encontrada.');
    }

    const category = { id: categorySnapshot.id, ...categorySnapshot.data() } as SpreadsheetTemplateCategory;
    categoryLabel = category.label;
  }

  await templateRef.update({
    defaultCategoryId: categoryId,
    defaultCategoryLabel: categoryLabel,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    templateId: template.id!,
    categoryId,
  };
});
