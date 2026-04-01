import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  DeleteClientSpreadsheetTemplateRequest,
  DeleteClientSpreadsheetTemplateResponse,
  SpreadsheetTemplate,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

const bucket = admin.storage().bucket();

const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

export const deleteClientSpreadsheetTemplate = onCall<
  DeleteClientSpreadsheetTemplateRequest,
  Promise<DeleteClientSpreadsheetTemplateResponse>
>(async (request) => {
  await assertCallableRoles(request, ['admin']);

  const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
  const templateId = requireNonEmptyString(request.data?.templateId, 'La plantilla');
  const db = getAppFirestore();
  const templateRef = db.collection('clients').doc(clientId).collection('spreadsheetTemplates').doc(templateId);
  const templateSnapshot = await templateRef.get();

  if (!templateSnapshot.exists) {
    throw new HttpsError('not-found', 'La plantilla no existe o ya fue eliminada.');
  }

  const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate;
  const batchesUsingTemplateSnapshot = await db
    .collection('batches')
    .where('spreadsheetTemplateId', '==', templateId)
    .limit(1)
    .get();

  const batchUsingTemplate = batchesUsingTemplateSnapshot.docs.find((doc) => doc.get('clientId') === clientId);
  if (batchUsingTemplate) {
    throw new HttpsError(
      'failed-precondition',
      'No puedes eliminar esta plantilla porque ya está asociada a un lote existente.',
    );
  }

  await db.recursiveDelete(templateRef);

  if (template.storagePath) {
    await bucket.file(template.storagePath).delete({ ignoreNotFound: true });
  }

  return {
    success: true,
    templateId,
  };
});
