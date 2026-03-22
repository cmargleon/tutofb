import { HttpsError } from 'firebase-functions/v2/https';
import {
  Client,
  CreateGenerationBatchRequest,
  ExperimentArm,
  ExperimentMode,
  GenerationExperimentConfig,
  Job,
  Model,
  Pose,
  UploadedGarmentInput,
} from '../../../shared/src/types';
import {
  buildFinalGenerationPrompt,
  isArchivedCatalogEntity,
  isAspectRatio,
  isProvider,
} from '../../../shared/src/domain';
import { buildExperimentArms, isExperimentEligibleProvider, isExperimentMode } from '../../../shared/src/experiments';

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
  experiment: {
    enabled: boolean;
    mode: ExperimentMode;
    arms: ExperimentArm[];
  } | null;
  promptBase: string;
  aspectRatio: CreateGenerationBatchRequest['aspectRatio'];
  totalJobs: number;
}

const validateExperimentConfig = (
  value: GenerationExperimentConfig | null | undefined,
): ValidatedCreateGenerationBatchInput['experiment'] => {
  if (!value?.enabled) {
    return null;
  }

  if (!isExperimentMode(value.mode)) {
    throw new HttpsError('invalid-argument', 'El modo del experimento A/B no es válido.');
  }

  const providers = Array.isArray(value.providers)
    ? [...new Set(value.providers.filter((provider): provider is CreateGenerationBatchRequest['provider'] => isProvider(provider)))]
    : [];

  if (providers.length !== 2) {
    throw new HttpsError('invalid-argument', 'El experimento A/B requiere exactamente 2 modelos por ahora.');
  }

  providers.forEach((provider) => {
    if (!isExperimentEligibleProvider(provider)) {
      throw new HttpsError(
        'invalid-argument',
        `El proveedor ${provider} no está habilitado para experimentos A/B.`,
      );
    }
  });

  return {
    enabled: true,
    mode: value.mode,
    arms: buildExperimentArms(providers),
  };
};

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
  const experiment = validateExperimentConfig(data?.experiment);

  if (!experiment && !isProvider(provider)) {
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

  const experimentMultiplier = experiment?.mode === 'ab_paired' ? experiment.arms.length : 1;
  const totalJobs = poseIds.length * garments.length * experimentMultiplier;
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
    provider: experiment ? experiment.arms[0].provider : provider!,
    experiment,
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

export const buildJobDraft = (
  job: Pick<Job, 'garmentIsMultiAngle'>,
  provider: Job['provider'],
  promptBase: string,
  autoReviewMaxAttempts: number = 3,
) => ({
  requestedPromptBase: promptBase.trim(),
  provider,
  promptBase,
  finalPrompt: buildFinalGenerationPrompt(promptBase, job.garmentIsMultiAngle),
  status: 'pending' as const,
  queuePriority: 1,
  retryCount: 0,
  generationAttemptCount: 0,
  autoReviewMaxAttempts,
  latestAutoReview: null,
  claimToken: null,
  claimedBy: null,
  claimExpiresAt: null,
  timeoutAt: null,
  startedAt: null,
  lastAttemptStartedAt: null,
  lastError: null,
});
