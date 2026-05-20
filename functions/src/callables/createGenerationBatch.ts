import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  Batch,
  Client,
  CreateGenerationBatchRequest,
  CreateGenerationBatchResponse,
  Job,
  Model,
  SpreadsheetTemplate,
  SpreadsheetTemplateCategory,
} from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getJobAutoReviewMaxAttempts } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { assertProviderEnabledInSystemConfig, getSystemConfigCached } from '../admin/systemConfig';
import { buildStoredProductDraft } from '../spreadsheets/productDrafts';
import {
  assertModelOwnershipAndPoses,
  buildJobDraft,
  getCompatibleGarmentPoseCombinations,
  resolveJobPromptCase,
  resolveGarmentPhotoForPose,
  validateCreateGenerationBatchInput,
} from './createGenerationBatch.helpers';

export const createGenerationBatch = onCall<CreateGenerationBatchRequest, Promise<CreateGenerationBatchResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin', 'operador']);
    const systemConfig = await getSystemConfigCached();
    const validated = validateCreateGenerationBatchInput(request.data, request.auth!.uid, systemConfig.batchMaxJobs);
    assertProviderEnabledInSystemConfig(validated.provider, systemConfig, 'usar para crear un lote');

    const db = getAppFirestore();
    const clientRef = db.collection('clients').doc(validated.clientId);
    const modelRef = db.collection('models').doc(validated.modelId);
    const userRef = db.collection('users').doc(request.auth!.uid);
    const templateRef = validated.spreadsheetTemplateId
      ? clientRef.collection('spreadsheetTemplates').doc(validated.spreadsheetTemplateId)
      : null;
    const [clientSnapshot, modelSnapshot, templateSnapshot, categoriesSnapshot, userSnapshot] = await Promise.all([
      clientRef.get(),
      modelRef.get(),
      templateRef?.get() ?? Promise.resolve(null),
      templateRef?.collection('categories').get() ?? Promise.resolve(null),
      userRef.get(),
    ]);

    if (!clientSnapshot.exists) {
      throw new HttpsError('not-found', 'No se encontró el cliente seleccionado.');
    }

    if (!modelSnapshot.exists) {
      throw new HttpsError('not-found', 'No se encontró el modelo seleccionado.');
    }
    if (validated.outputMode === 'spreadsheet' && (!templateSnapshot || !templateSnapshot.exists)) {
      throw new HttpsError('not-found', 'No se encontró la plantilla seleccionada.');
    }
    if (validated.outputMode === 'spreadsheet' && (!categoriesSnapshot || categoriesSnapshot.empty)) {
      throw new HttpsError('not-found', 'La plantilla seleccionada no tiene categorías disponibles.');
    }

    const client = { id: clientSnapshot.id, ...clientSnapshot.data() } as Client;
    const model = { id: modelSnapshot.id, ...modelSnapshot.data() } as Model;
    const template =
      templateSnapshot && templateSnapshot.exists
        ? ({ id: templateSnapshot.id, ...templateSnapshot.data() } as SpreadsheetTemplate)
        : null;
    const categoriesById = new Map<string, SpreadsheetTemplateCategory>(
      categoriesSnapshot?.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as SpreadsheetTemplateCategory]) || [],
    );
    const uniqueDraftCategoryIds = [...new Set(validated.productDrafts.map((draft) => draft.categoryId).filter(Boolean))];
    const batchCategory = uniqueDraftCategoryIds.length === 1
      ? categoriesById.get(uniqueDraftCategoryIds[0]) || null
      : null;
    const createdByDisplayName =
      userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data()!.displayName
        : null;

    if (model.clientId !== client.id) {
      throw new HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }

    const poseMap = assertModelOwnershipAndPoses(client, model, validated.poseIds);
    const selectedPoses = validated.poseIds
      .map((poseId) => poseMap.get(poseId))
      .filter((pose): pose is Model['poses'][number] => Boolean(pose));
    const compatibleCombinations = getCompatibleGarmentPoseCombinations(validated.garments, selectedPoses);
    const actualTotalJobs = compatibleCombinations.length;

    if (actualTotalJobs === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Ninguna prenda del lote tiene vistas compatibles con las poses seleccionadas.',
      );
    }

    if (actualTotalJobs > systemConfig.batchMaxJobs) {
      throw new HttpsError(
        'out-of-range',
        `El lote excede el límite configurado de ${systemConfig.batchMaxJobs} trabajos (${actualTotalJobs} solicitados).`,
      );
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batchRef = db.collection('batches').doc();
    const batchData: Omit<Batch, 'id'> = {
      clientId: client.id!,
      clientNameSnapshot: client.name,
      clientSnapshot: {
        id: client.id!,
        name: client.name,
      },
      modelId: model.id!,
      modelNameSnapshot: model.name,
      modelSnapshot: {
        id: model.id!,
        clientId: model.clientId,
        name: model.name,
        poseCount: model.poseCount,
        coverPoseId: model.coverPoseId || model.poses[0]?.id || null,
        coverPosePath: model.coverPosePath || model.poses[0]?.storagePath || null,
        identityTraits: model.identityTraits || null,
      },
      outputMode: validated.outputMode,
      spreadsheetTemplateId: template?.id || null,
      spreadsheetTemplateNameSnapshot: template?.name || null,
      spreadsheetCategoryId: batchCategory?.id || null,
      spreadsheetCategoryNameSnapshot:
        batchCategory?.label
        || (uniqueDraftCategoryIds.length > 1 ? 'Múltiples categorías' : null),
      provider: validated.provider,
      aspectRatio: validated.aspectRatio,
      imageConfig: validated.imageConfig,
      promptBase: validated.promptBase,
      poseIds: validated.poseIds,
      garmentCount: validated.garments.length,
      totalJobs: actualTotalJobs,
      pendingJobs: actualTotalJobs,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      completedOutputCount: 0,
      status: 'pending',
      latestJobCreatedAt: now,
      lastJobCompletedAt: null,
      createdAt: now,
      updatedAt: now,
      createdByUid: request.auth!.uid,
      createdByDisplayName,
    };

    const writeBatch = db.batch();
    writeBatch.set(batchRef, batchData);
    if (validated.outputMode === 'spreadsheet' && template) {
      const productDraftsByGarmentId = new Map(validated.productDrafts.map((draft) => [draft.garmentId, draft]));

      validated.garments.forEach((garment) => {
        const draftInput = productDraftsByGarmentId.get(garment.id);
        if (!draftInput) {
          throw new HttpsError('invalid-argument', `Falta el product draft para ${garment.name}.`);
        }
        const category = categoriesById.get(draftInput.categoryId);
        if (!category) {
          throw new HttpsError('invalid-argument', `La categoría ${draftInput.categoryId} ya no existe para ${garment.name}.`);
        }

        const productDraftRef = batchRef.collection('productDrafts').doc(garment.id);
        writeBatch.set(productDraftRef, {
          ...buildStoredProductDraft({
            batchId: batchRef.id,
            client,
            model,
            template,
            category,
            garment,
            draftInput,
            createdByUid: request.auth!.uid,
          }),
          createdAt: now,
          updatedAt: now,
        });
      });
    }

    const maxRetries = systemConfig.jobMaxRetries;
    const autoReviewMaxAttempts = getJobAutoReviewMaxAttempts();
    const promptCases = {
      full_outfit: systemConfig.systemPromptFullOutfit,
      top_only: systemConfig.systemPromptTopOnly,
      bottom_only: systemConfig.systemPromptBottomOnly,
    } as const;

    for (const { garment, pose } of compatibleCombinations) {
      const selectedGarmentPhoto = resolveGarmentPhotoForPose(garment, pose);
      const promptCase = resolveJobPromptCase(garment.garmentBodyArea ?? null, promptCases);
      const jobRef = db.collection('jobs').doc();
      const jobDraft = buildJobDraft(
        {
          garmentIsMultiAngle: garment.isMultiAngle,
          garmentReferenceImageType: 'single_view',
          promptCaseKey: promptCase.promptCaseKey,
          promptCaseText: promptCase.promptCaseText,
        } as Pick<Job, 'garmentIsMultiAngle' | 'garmentReferenceImageType' | 'promptCaseKey' | 'promptCaseText'>,
        validated.provider,
        validated.promptBase,
        model.identityTraits || null,
        autoReviewMaxAttempts,
      );
      const jobData: Omit<Job, 'id'> = {
        batchId: batchRef.id,
        clientId: client.id!,
        clientNameSnapshot: client.name,
        modelId: model.id!,
        modelNameSnapshot: model.name,
        poseImageId: pose.id,
        poseImagePath: pose.storagePath,
        poseFileName: pose.fileName,
        poseOrientationGroup: pose.aiClassification?.orientationGroup || null,
        poseOrientationDetail: pose.aiClassification?.orientationDetail || null,
        poseFraming: pose.aiClassification?.framing || null,
        poseBodyFocus: pose.aiClassification?.bodyFocus || null,
        poseAccessoryDisplaySlots: pose.aiClassification?.accessoryDisplaySlots || [],
        garmentId: garment.id,
        garmentName: garment.name,
        garmentFilePath: selectedGarmentPhoto.storagePath,
        garmentPhotoId: selectedGarmentPhoto.id,
        garmentPhotoFileName: selectedGarmentPhoto.fileName,
        garmentView: selectedGarmentPhoto.view,
        garmentBodyArea: garment.garmentBodyArea ?? null,
        garmentAccessoryType: garment.garmentAccessoryType ?? null,
        productDraftId: validated.outputMode === 'spreadsheet' ? garment.id : null,
        garmentSourceType: garment.sourceType,
        garmentOriginalFileNames: garment.originalFileNames || [],
        garmentIsMultiAngle: garment.isMultiAngle,
        garmentReferenceImageType: 'single_view',
        aspectRatio: validated.aspectRatio,
        imageConfig: validated.imageConfig,
        ...jobDraft,
        maxRetries,
        completedAt: null,
        latestOutputCreatedAt: null,
        currentOutputId: null,
        currentOutput: null,
        completedOutputCount: 0,
        totalCostUsd: 0,
        totalDurationSeconds: 0,
        providerUsage: {},
        manualRegenerationCount: 0,
        traceability: {
          batchCreatedAt: now,
          batchCreatedByUid: request.auth!.uid,
          batchCreatedByDisplayName: createdByDisplayName,
          lastAttemptStartedAt: null,
          lastCompletedAt: null,
          lastManualRegenerationAt: null,
          lastManualRegeneratedByUid: null,
          lastManualRegeneratedByDisplayName: null,
          lastProviderErrorAt: null,
          lastProviderErrorMessage: null,
        },
        createdAt: now,
        updatedAt: now,
        createdByUid: request.auth!.uid,
        lastError: null,
        failureInfo: null,
      };

      writeBatch.set(jobRef, jobData);
    }

    writeBatch.set(
      clientRef,
      {
        batchCount: admin.firestore.FieldValue.increment(1),
        lastBatchCreatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    await writeBatch.commit();

    return {
      batchId: batchRef.id,
      createdJobs: actualTotalJobs,
    };
  },
);
