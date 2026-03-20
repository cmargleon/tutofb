import { HttpsError } from 'firebase-functions/v2/https';
import {
  Client,
  CreateGenerationBatchRequest,
  Job,
  Model,
  Pose,
  UploadedGarmentInput,
} from '../../../shared/src/types';
import {
  buildFinalGenerationPrompt,
  isAspectRatio,
  isProvider,
  normalizeBackgroundConfig,
} from '../../../shared/src/domain';

export const requireNonEmptyString = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${label} es obligatorio.`);
  }

  return normalized;
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

  return {
    id,
    name,
    storagePath,
    isMultiAngle: garment.isMultiAngle,
    sourceType: garment.sourceType,
    originalFileNames: Array.isArray(garment.originalFileNames)
      ? garment.originalFileNames.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
  };
};

export const ensureDraftOwnership = (uid: string, garment: UploadedGarmentInput): void => {
  if (!garment.storagePath.startsWith(`garments/drafts/${uid}/`)) {
    throw new HttpsError(
      'permission-denied',
      `La prenda ${garment.name} no pertenece al usuario autenticado o no está en la ruta de drafts esperada.`,
    );
  }
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
  backgroundConfig: CreateGenerationBatchRequest['backgroundConfig'];
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
    provider,
    promptBase,
    aspectRatio,
    backgroundConfig: normalizeBackgroundConfig(data?.backgroundConfig),
    totalJobs,
  };
};

export const assertModelOwnershipAndPoses = (
  client: Client,
  model: Model,
  poseIds: string[],
): Map<string, Pose> => {
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

export const buildJobDraft = (
  job: Pick<Job, 'backgroundConfig' | 'garmentIsMultiAngle'>,
  provider: Job['provider'],
  promptBase: string,
) => ({
  provider,
  promptBase,
  finalPrompt: buildFinalGenerationPrompt(promptBase, job.backgroundConfig, job.garmentIsMultiAngle),
  status: 'pending' as const,
  queuePriority: 1,
  retryCount: 0,
  claimToken: null,
  claimedBy: null,
  claimExpiresAt: null,
  timeoutAt: null,
  startedAt: null,
  lastAttemptStartedAt: null,
  lastError: null,
});
