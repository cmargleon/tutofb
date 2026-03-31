import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Client,
  Model,
  PreviewProductDraftsRequest,
  PreviewProductDraftsResponse,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import {
  assertModelOwnershipAndPoses,
  ensureDraftOwnership,
  normalizeGarment,
  requireNonEmptyString,
} from './createGenerationBatch.helpers';
import { buildPreviewProductDrafts } from '../spreadsheets/productDrafts';

export const previewProductDrafts = onCall<PreviewProductDraftsRequest, Promise<PreviewProductDraftsResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);

    const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
    const modelId = requireNonEmptyString(request.data?.modelId, 'El modelo');
    const spreadsheetTemplateId = requireNonEmptyString(request.data?.spreadsheetTemplateId, 'La plantilla');
    const spreadsheetCategoryId = requireNonEmptyString(request.data?.spreadsheetCategoryId, 'La categoría');

    const garments = Array.isArray(request.data?.garments) ? request.data.garments.map(normalizeGarment) : [];
    if (garments.length === 0) {
      throw new HttpsError('invalid-argument', 'Debes subir al menos una prenda para preparar los drafts.');
    }

    garments.forEach((garment) => ensureDraftOwnership(request.auth!.uid, garment));

    const db = getAppFirestore();
    const clientRef = db.collection('clients').doc(clientId);
    const modelRef = db.collection('models').doc(modelId);
    const templateRef = clientRef.collection('spreadsheetTemplates').doc(spreadsheetTemplateId);
    const categoryRef = templateRef.collection('categories').doc(spreadsheetCategoryId);
    const [clientSnapshot, modelSnapshot, templateSnapshot, categorySnapshot] = await Promise.all([
      clientRef.get(),
      modelRef.get(),
      templateRef.get(),
      categoryRef.get(),
    ]);

    if (!clientSnapshot.exists) {
      throw new HttpsError('not-found', 'Cliente no encontrado.');
    }
    if (!modelSnapshot.exists) {
      throw new HttpsError('not-found', 'Modelo no encontrado.');
    }
    if (!templateSnapshot.exists) {
      throw new HttpsError('not-found', 'Plantilla no encontrada.');
    }
    if (!categorySnapshot.exists) {
      throw new HttpsError('not-found', 'Categoría de spreadsheet no encontrada.');
    }

    const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
    const model = { id: modelSnapshot.id, ...modelSnapshot.data() } as Model;
    const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate;
    const category = { id: categorySnapshot.id, ...categorySnapshot.data() } as SpreadsheetTemplateCategory;

    assertModelOwnershipAndPoses(client, model, []);
    if (model.clientId !== client.id) {
      throw new HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }

    const productDrafts = await buildPreviewProductDrafts({
      client,
      model,
      template,
      category,
      garments,
      userUid: request.auth!.uid,
    });

    return {
      success: true,
      productDrafts,
    };
  },
);
