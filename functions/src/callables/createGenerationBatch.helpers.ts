import { HttpsError } from 'firebase-functions/v2/https';
import {
  Client,
  CreateGenerationBatchRequest,
  Job,
  Model,
  Pose,
  UploadedGarmentInput,
  UploadedGarmentPhotoInput,
} from '../../../shared/src/types';
import {
  buildFinalGenerationPrompt,
  isArchivedCatalogEntity,
  isAspectRatio,
  isProvider,
} from '../../../shared/src/domain';
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
  poseIds: string[];
  garments: UploadedGarmentInput[];
  provider: CreateGenerationBatchRequest['provider'];
  promptBase: string;
  aspectRatio: CreateGenerationBatchRequest['aspectRatio'];
  totalJobs: number;
}

export const validateCreateGenerationBatchInput = (
  data: Partial<CreateGenerationBatchRequest> | null | undefined,
  authUid: string,
  maxJobs: number,
): ValidatedCreateGenerationBatchInput => {
  const clientId = requireNonEmptyString(data?.clientId, 'El cliente');
  const modelId = requireNonEmptyString(data?.modelId, 'El modelo');
  const promptBase = typeof data?.promptBase === 'string' ? data.promptBase.trim() : '';
  const provider = data?.provider;
  const aspectRatio = data?.aspectRatio;

  if (!isProvider(provider)) {
    throw new HttpsError('invalid-argument', 'Se seleccionó un proveedor no compatible.');
  }

  if (!isAspectRatio(aspectRatio)) {
    throw new HttpsError('invalid-argument', 'Se seleccionó una relación de aspecto no compatible.');
  }

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
    poseIds,
    garments,
    provider: provider!,
    promptBase,
    aspectRatio,
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
