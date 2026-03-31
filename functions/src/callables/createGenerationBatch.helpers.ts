import { HttpsError } from 'firebase-functions/v2/https';
import {
  AspectRatio,
  BatchOutputMode,
  Client,
  CreateGenerationBatchRequest,
  Job,
  ProductDraftInput,
  ProductDraftRow,
  Model,
  Pose,
  ProviderImageConfig,
  UploadedGarmentInput,
  UploadedGarmentPhotoInput,
} from '../../../shared/src/types';
import {
  buildFinalGenerationPrompt,
  isArchivedCatalogEntity,
  isProvider,
} from '../../../shared/src/domain';
import { isProviderImageConfig, normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { EMPTY_JOB_REVIEW_SIGNALS } from '../../../shared/src/reviewMetrics';
import {
  getSortedUniqueGarmentViews,
  isPoseCompatibleWithGarmentViews,
  selectBestGarmentPhotoForPose,
} from '../../../shared/src/utils/garmentViewMatching';

export const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
};

const buildFallbackGarmentPhoto = (
  garment: Pick<UploadedGarmentInput, 'id' | 'name' | 'storagePath' | 'originalFileNames'>,
): UploadedGarmentPhotoInput => ({
  id: `${garment.id}-primary`,
  fileName:
    garment.originalFileNames?.[0]
    || garment.storagePath.split('/').pop()
    || `${garment.name}.jpg`,
  storagePath: garment.storagePath,
  sourceIndex: 0,
  view: 'front',
  confidence: null,
  reasoning: null,
  classifiedBy: 'assumed_single_front',
});

const normalizeGarmentPhoto = (
  value: unknown,
  garment: Pick<UploadedGarmentInput, 'id' | 'name'>,
  sourceIndex: number,
): UploadedGarmentPhotoInput => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', `La prenda ${garment.name} tiene una foto inválida.`);
  }

  const photo = value as Partial<UploadedGarmentPhotoInput>;
  const storagePath = requireNonEmptyString(photo.storagePath, `La ruta de una foto de ${garment.name}`);
  const fileName = requireNonEmptyString(photo.fileName, `El nombre de una foto de ${garment.name}`);
  const view = photo.view;

  if (view !== 'front' && view !== 'back' && view !== 'side') {
    throw new HttpsError(
      'invalid-argument',
      `La foto ${fileName} de ${garment.name} debe indicar una vista válida (front/back/side).`,
    );
  }

  return {
    id: requireNonEmptyString(photo.id, `El id de una foto de ${garment.name}`),
    fileName,
    storagePath,
    sourceIndex:
      typeof photo.sourceIndex === 'number' && Number.isFinite(photo.sourceIndex)
        ? Math.max(0, Math.trunc(photo.sourceIndex))
        : sourceIndex,
    view,
    confidence: typeof photo.confidence === 'number' && Number.isFinite(photo.confidence) ? photo.confidence : null,
    reasoning: typeof photo.reasoning === 'string' ? photo.reasoning.trim() || null : null,
    classifiedBy: photo.classifiedBy === 'gemini' ? 'gemini' : 'assumed_single_front',
  };
};

export const normalizeGarment = (value: unknown): UploadedGarmentInput => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', 'Cada prenda debe ser un objeto válido.');
  }

  const garment = value as Partial<UploadedGarmentInput>;
  const id = requireNonEmptyString(garment.id, 'El id de la prenda');
  const name = requireNonEmptyString(garment.name, 'El nombre de la prenda');
  const storagePath = requireNonEmptyString(garment.storagePath, 'La ruta del archivo de la prenda');

  if (typeof garment.isMultiAngle !== 'boolean') {
    throw new HttpsError('invalid-argument', `La prenda ${name} debe indicar si es multiángulo.`);
  }

  const photos =
    Array.isArray(garment.photos) && garment.photos.length > 0
      ? garment.photos.map((photo, index) => normalizeGarmentPhoto(photo, { id, name }, index))
      : [buildFallbackGarmentPhoto({ id, name, storagePath, originalFileNames: garment.originalFileNames })];

  return {
    id,
    name,
    storagePath,
    isMultiAngle: garment.isMultiAngle,
    sourceType: garment.sourceType,
    originalFileNames: Array.isArray(garment.originalFileNames)
      ? garment.originalFileNames.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    originalPhotoCount:
      typeof garment.originalPhotoCount === 'number' && Number.isFinite(garment.originalPhotoCount)
        ? Math.max(1, Math.trunc(garment.originalPhotoCount))
        : photos.length,
    photos,
  };
};

const ensureStoragePathOwnership = (uid: string, storagePath: string, garmentName: string): void => {
  if (!storagePath.startsWith(`garments/drafts/${uid}/`)) {
    throw new HttpsError(
      'permission-denied',
      `La prenda ${garmentName} no pertenece al usuario autenticado o no está en la ruta de drafts esperada.`,
    );
  }
};

export const ensureDraftOwnership = (uid: string, garment: UploadedGarmentInput): void => {
  ensureStoragePathOwnership(uid, garment.storagePath, garment.name);
  (garment.photos || []).forEach((photo) => ensureStoragePathOwnership(uid, photo.storagePath, garment.name));
};

export const getPoseMap = (model: Model): Map<string, Pose> =>
  new Map(model.poses.map((pose) => [pose.id, pose]));

export interface ValidatedCreateGenerationBatchInput {
  clientId: string;
  modelId: string;
  outputMode: BatchOutputMode;
  spreadsheetTemplateId: string | null;
  spreadsheetCategoryId: string | null;
  poseIds: string[];
  garments: UploadedGarmentInput[];
  productDrafts: ProductDraftInput[];
  provider: CreateGenerationBatchRequest['provider'];
  imageConfig: ProviderImageConfig;
  promptBase: string;
  aspectRatio: AspectRatio;
  totalJobs: number;
}

const normalizeProductDraftRow = (value: unknown, rowIndex: number, garmentName: string): ProductDraftRow => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', `La fila ${rowIndex + 1} del draft de ${garmentName} es inválida.`);
  }

  const row = value as Partial<ProductDraftRow>;
  const id = requireNonEmptyString(row.id, `El id de la fila ${rowIndex + 1} de ${garmentName}`);
  const values = row.values;

  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new HttpsError('invalid-argument', `Los valores de la fila ${rowIndex + 1} de ${garmentName} son inválidos.`);
  }

  return {
    id,
    values: Object.fromEntries(
      Object.entries(values).map(([key, entryValue]) => [key, typeof entryValue === 'string' ? entryValue : String(entryValue ?? '')]),
    ),
  };
};

const normalizeProductDraft = (value: unknown): ProductDraftInput => {
  if (!value || typeof value !== 'object') {
    throw new HttpsError('invalid-argument', 'Cada product draft debe ser un objeto válido.');
  }

  const draft = value as Partial<ProductDraftInput>;
  const garmentName = requireNonEmptyString(draft.garmentName, 'El nombre del garment draft');
  const rows = Array.isArray(draft.rows) ? draft.rows.map((row, index) => normalizeProductDraftRow(row, index, garmentName)) : [];

  if (rows.length === 0) {
    throw new HttpsError('invalid-argument', `El product draft de ${garmentName} debe tener al menos una fila.`);
  }

  return {
    garmentId: requireNonEmptyString(draft.garmentId, `El garmentId del draft de ${garmentName}`),
    garmentName,
    rows,
    inferredValues:
      draft.inferredValues && typeof draft.inferredValues === 'object' && !Array.isArray(draft.inferredValues)
        ? Object.fromEntries(
            Object.entries(draft.inferredValues).map(([key, rawValue]) => {
              const record =
                rawValue && typeof rawValue === 'object'
                  ? rawValue as unknown as Record<string, unknown>
                  : {};
              return [
                key,
                {
                  value: typeof record.value === 'string' ? record.value : '',
                  confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? record.confidence : null,
                  reasoning: typeof record.reasoning === 'string' ? record.reasoning : null,
                  source:
                    record.source === 'user' || record.source === 'wizard' || record.source === 'system' || record.source === 'gemini'
                      ? record.source
                      : 'system',
                },
              ];
            }),
          )
        : {},
  };
};

export const validateCreateGenerationBatchInput = (
  data: Partial<CreateGenerationBatchRequest> | null | undefined,
  authUid: string,
  maxJobs: number,
): ValidatedCreateGenerationBatchInput => {
  const clientId = requireNonEmptyString(data?.clientId, 'El cliente');
  const modelId = requireNonEmptyString(data?.modelId, 'El modelo');
  const outputMode = data?.outputMode === 'photos_only' ? 'photos_only' : 'spreadsheet';
  const spreadsheetTemplateId =
    outputMode === 'spreadsheet'
      ? requireNonEmptyString(data?.spreadsheetTemplateId, 'La plantilla')
      : null;
  const spreadsheetCategoryId =
    outputMode === 'spreadsheet'
      ? requireNonEmptyString(data?.spreadsheetCategoryId, 'La categoría del spreadsheet')
      : null;
  const promptBase = typeof data?.promptBase === 'string' ? data.promptBase.trim() : '';
  const provider = data?.provider;
  const imageConfig = data?.imageConfig;
  const legacyAspectRatio = data?.aspectRatio;

  if (!isProvider(provider)) {
    throw new HttpsError('invalid-argument', 'Se seleccionó un proveedor no compatible.');
  }

  if (imageConfig && (!isProviderImageConfig(imageConfig) || imageConfig.provider !== provider)) {
    throw new HttpsError('invalid-argument', 'La configuracion de imagen no coincide con el proveedor seleccionado.');
  }

  const normalizedImageConfig = normalizeProviderImageConfig(provider, imageConfig, legacyAspectRatio);

  const poseIds = Array.isArray(data?.poseIds)
    ? [...new Set(data.poseIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
    : [];

  if (poseIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Selecciona al menos una pose.');
  }

  const garments = Array.isArray(data?.garments) ? data.garments.map(normalizeGarment) : [];
  if (garments.length === 0) {
    throw new HttpsError('invalid-argument', 'Debes subir al menos una prenda.');
  }

  garments.forEach((garment) => ensureDraftOwnership(authUid, garment));
  const productDrafts = Array.isArray(data?.productDrafts) ? data.productDrafts.map(normalizeProductDraft) : [];
  if (outputMode === 'spreadsheet') {
    if (productDrafts.length !== garments.length) {
      throw new HttpsError(
        'invalid-argument',
        'Debes enviar exactamente un product draft por cada prenda del lote.',
      );
    }

    const draftByGarmentId = new Map(productDrafts.map((draft) => [draft.garmentId, draft]));
    garments.forEach((garment) => {
      if (!draftByGarmentId.has(garment.id)) {
        throw new HttpsError('invalid-argument', `Falta el product draft para la prenda ${garment.name}.`);
      }
    });
  }

  const totalJobs = poseIds.length * garments.length;
  if (totalJobs > maxJobs) {
    throw new HttpsError(
      'out-of-range',
      `El lote excede el límite configurado de ${maxJobs} trabajos (${totalJobs} solicitados).`,
    );
  }

  return {
    clientId,
    modelId,
    outputMode,
    spreadsheetTemplateId,
    spreadsheetCategoryId,
    poseIds,
    garments,
    productDrafts,
    provider: provider!,
    imageConfig: normalizedImageConfig.imageConfig,
    promptBase,
    aspectRatio: normalizedImageConfig.aspectRatio,
    totalJobs,
  };
};

export const assertModelOwnershipAndPoses = (
  client: Client,
  model: Model,
  poseIds: string[],
): Map<string, Pose> => {
  if (isArchivedCatalogEntity(client)) {
    throw new HttpsError('failed-precondition', 'El cliente seleccionado está archivado y ya no admite nuevos lotes.');
  }

  if (isArchivedCatalogEntity(model)) {
    throw new HttpsError('failed-precondition', 'El modelo seleccionado está archivado y ya no admite nuevos lotes.');
  }

  if (model.clientId !== client.id) {
    throw new HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
  }

  const poseMap = getPoseMap(model);
  poseIds.forEach((poseId) => {
    if (!poseMap.has(poseId)) {
      throw new HttpsError('invalid-argument', `La pose ${poseId} no pertenece al modelo seleccionado.`);
    }
  });

  return poseMap;
};

export const resolveGarmentPhotoForPose = (
  garment: UploadedGarmentInput,
  pose: Pick<Pose, 'id' | 'fileName' | 'aiClassification'>,
): UploadedGarmentPhotoInput => {
  const selectedPhoto = selectBestGarmentPhotoForPose(pose.aiClassification, garment.photos || []);
  if (!selectedPhoto) {
    throw new HttpsError(
      'invalid-argument',
      `La prenda ${garment.name} no tiene fotos disponibles para la pose ${pose.fileName || pose.id}.`,
    );
  }

  return selectedPhoto;
};

export const getGarmentAvailableViews = (garment: UploadedGarmentInput) =>
  getSortedUniqueGarmentViews(
    (garment.photos || [])
      .map((photo) => photo.view)
      .filter((view): view is UploadedGarmentPhotoInput['view'] => Boolean(view)),
  );

export const canGeneratePoseForGarment = (
  garment: UploadedGarmentInput,
  pose: Pick<Pose, 'aiClassification'>,
): boolean => isPoseCompatibleWithGarmentViews(pose.aiClassification, getGarmentAvailableViews(garment));

export const getCompatibleGarmentPoseCombinations = (
  garments: UploadedGarmentInput[],
  poses: Array<Pick<Pose, 'id' | 'fileName' | 'aiClassification' | 'storagePath'>>,
): Array<{
  garment: UploadedGarmentInput;
  pose: Pick<Pose, 'id' | 'fileName' | 'aiClassification' | 'storagePath'>;
}> =>
  garments.flatMap((garment) =>
    poses
      .filter((pose) => canGeneratePoseForGarment(garment, pose))
      .map((pose) => ({ garment, pose })),
  );

export const buildJobDraft = (
  job: Pick<Job, 'garmentIsMultiAngle' | 'garmentReferenceImageType'>,
  provider: Job['provider'],
  promptBase: string,
  autoReviewMaxAttempts: number = 3,
) => ({
  requestedPromptBase: promptBase.trim(),
  provider,
  promptBase,
  finalPrompt: buildFinalGenerationPrompt(
    promptBase,
    job.garmentReferenceImageType || (job.garmentIsMultiAngle ? 'multi_angle_composite' : 'single_view'),
  ),
  status: 'pending' as const,
  queuePriority: 1,
  retryCount: 0,
  generationAttemptCount: 0,
  autoReviewMaxAttempts,
  latestAutoReview: null,
  reviewSignals: {
    ...EMPTY_JOB_REVIEW_SIGNALS,
  },
  claimToken: null,
  claimedBy: null,
  claimExpiresAt: null,
  timeoutAt: null,
  startedAt: null,
  lastAttemptStartedAt: null,
  lastError: null,
});
