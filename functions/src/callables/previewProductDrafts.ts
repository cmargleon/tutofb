import * as admin from 'firebase-admin';
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
import { GEMINI_API_KEY } from '../config/runtime';
import { buildPreviewProductDrafts } from '../spreadsheets/productDrafts';
import {
  getSpreadsheetTemplateParserVersion,
  parseStoredSpreadsheetTemplateWorkbook,
} from '../spreadsheets/templateWorkbook';

const shouldHydrateTemplateCategories = (
  template: SpreadsheetTemplate,
  categories: SpreadsheetTemplateCategory[],
): boolean => {
  if (template.parserVersion < getSpreadsheetTemplateParserVersion()) {
    return true;
  }

  if (categories.some((category) => category.attributes.length === 0 || category.attributes.every((attribute) => attribute.values.length === 0))) {
    return true;
  }

  return false;
};

export const previewProductDrafts = onCall<PreviewProductDraftsRequest, Promise<PreviewProductDraftsResponse>>(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);

    const clientId = requireNonEmptyString(request.data?.clientId, 'El cliente');
    const modelId = requireNonEmptyString(request.data?.modelId, 'El modelo');
    const spreadsheetTemplateId = requireNonEmptyString(request.data?.spreadsheetTemplateId, 'La plantilla');
    const fallbackCategoryId = typeof request.data?.fallbackCategoryId === 'string' && request.data.fallbackCategoryId.trim()
      ? request.data.fallbackCategoryId.trim()
      : null;

    const garments = Array.isArray(request.data?.garments) ? request.data.garments.map(normalizeGarment) : [];
    if (garments.length === 0) {
      throw new HttpsError('invalid-argument', 'Debes subir al menos una prenda para preparar los drafts.');
    }

    garments.forEach((garment) => ensureDraftOwnership(request.auth!.uid, garment));

    const db = getAppFirestore();
    const clientRef = db.collection('clients').doc(clientId);
    const modelRef = db.collection('models').doc(modelId);
    const templateRef = clientRef.collection('spreadsheetTemplates').doc(spreadsheetTemplateId);
    const [clientSnapshot, modelSnapshot, templateSnapshot, categoriesSnapshot] = await Promise.all([
      clientRef.get(),
      modelRef.get(),
      templateRef.get(),
      templateRef.collection('categories').get(),
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
    if (categoriesSnapshot.empty) {
      throw new HttpsError('not-found', 'La plantilla no tiene categorías disponibles.');
    }

    const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
    const model = { id: modelSnapshot.id, ...modelSnapshot.data() } as Model;
    const template = { id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate;
    let categories = categoriesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SpreadsheetTemplateCategory));

    if (shouldHydrateTemplateCategories(template, categories)) {
      const reparsed = await parseStoredSpreadsheetTemplateWorkbook({
        clientId,
        clientNameSnapshot: client.name,
        template,
        createdByUid: request.auth!.uid,
      });
      const reparsedBySheetName = new Map(reparsed.categories.map((category) => [category.sheetName, category]));
      const writeBatch = db.batch();

      categories = categories.map((category) => {
        const reparsedCategory = reparsedBySheetName.get(category.sheetName);
        if (!reparsedCategory) {
          return category;
        }

        writeBatch.set(
          templateRef.collection('categories').doc(category.id!),
          {
            sheetName: reparsedCategory.sheetName,
            label: reparsedCategory.label,
            rowStart: reparsedCategory.rowStart,
            columns: reparsedCategory.columns,
            attributes: reparsedCategory.attributes,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return {
          ...category,
          sheetName: reparsedCategory.sheetName,
          label: reparsedCategory.label,
          rowStart: reparsedCategory.rowStart,
          columns: reparsedCategory.columns,
          attributes: reparsedCategory.attributes,
        };
      });

      writeBatch.set(
        templateRef,
        {
          parserVersion: reparsed.template.parserVersion,
          categories: reparsed.template.categories,
          categoryIds: reparsed.template.categoryIds,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      await writeBatch.commit();
      template.parserVersion = reparsed.template.parserVersion;
      template.categories = reparsed.template.categories;
      template.categoryIds = reparsed.template.categoryIds;
    }

    const categoriesById = new Map(categories.map((category) => [category.id!, category]));

    assertModelOwnershipAndPoses(client, model, []);
    if (model.clientId !== client.id) {
      throw new HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }

    const productDrafts = await buildPreviewProductDrafts({
      client,
      model,
      template,
      categoriesById,
      garments,
      userUid: request.auth!.uid,
      fallbackCategoryId,
    });

    return {
      success: true,
      productDrafts,
    };
  },
);
