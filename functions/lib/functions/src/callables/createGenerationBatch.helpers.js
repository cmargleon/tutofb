"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobDraft = exports.assertModelOwnershipAndPoses = exports.validateCreateGenerationBatchInput = exports.getPoseMap = exports.ensureDraftOwnership = exports.normalizeGarment = exports.requireNonEmptyString = void 0;
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const experiments_1 = require("../../../shared/src/experiments");
const requireNonEmptyString = (value, label) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        throw new https_1.HttpsError('invalid-argument', `${label} es obligatorio.`);
    }
    return normalized;
};
exports.requireNonEmptyString = requireNonEmptyString;
const normalizeGarment = (value) => {
    if (!value || typeof value !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'Cada prenda debe ser un objeto válido.');
    }
    const garment = value;
    const id = (0, exports.requireNonEmptyString)(garment.id, 'El id de la prenda');
    const name = (0, exports.requireNonEmptyString)(garment.name, 'El nombre de la prenda');
    const storagePath = (0, exports.requireNonEmptyString)(garment.storagePath, 'La ruta del archivo de la prenda');
    if (typeof garment.isMultiAngle !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', `La prenda ${name} debe indicar si es multiángulo.`);
    }
    return {
        id,
        name,
        storagePath,
        isMultiAngle: garment.isMultiAngle,
        sourceType: garment.sourceType,
        originalFileNames: Array.isArray(garment.originalFileNames)
            ? garment.originalFileNames.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            : [],
    };
};
exports.normalizeGarment = normalizeGarment;
const ensureDraftOwnership = (uid, garment) => {
    if (!garment.storagePath.startsWith(`garments/drafts/${uid}/`)) {
        throw new https_1.HttpsError('permission-denied', `La prenda ${garment.name} no pertenece al usuario autenticado o no está en la ruta de drafts esperada.`);
    }
};
exports.ensureDraftOwnership = ensureDraftOwnership;
const getPoseMap = (model) => new Map(model.poses.map((pose) => [pose.id, pose]));
exports.getPoseMap = getPoseMap;
const validateExperimentConfig = (value) => {
    if (!value?.enabled) {
        return null;
    }
    if (!(0, experiments_1.isExperimentMode)(value.mode)) {
        throw new https_1.HttpsError('invalid-argument', 'El modo del experimento A/B no es válido.');
    }
    const providers = Array.isArray(value.providers)
        ? [...new Set(value.providers.filter((provider) => (0, domain_1.isProvider)(provider)))]
        : [];
    if (providers.length !== 2) {
        throw new https_1.HttpsError('invalid-argument', 'El experimento A/B requiere exactamente 2 modelos por ahora.');
    }
    providers.forEach((provider) => {
        if (!(0, experiments_1.isExperimentEligibleProvider)(provider)) {
            throw new https_1.HttpsError('invalid-argument', `El proveedor ${provider} no está habilitado para experimentos A/B.`);
        }
    });
    return {
        enabled: true,
        mode: value.mode,
        arms: (0, experiments_1.buildExperimentArms)(providers),
    };
};
const validateCreateGenerationBatchInput = (data, authUid, maxJobs) => {
    const clientId = (0, exports.requireNonEmptyString)(data?.clientId, 'El cliente');
    const modelId = (0, exports.requireNonEmptyString)(data?.modelId, 'El modelo');
    const promptBase = typeof data?.promptBase === 'string' ? data.promptBase.trim() : '';
    const provider = data?.provider;
    const aspectRatio = data?.aspectRatio;
    const experiment = validateExperimentConfig(data?.experiment);
    if (!experiment && !(0, domain_1.isProvider)(provider)) {
        throw new https_1.HttpsError('invalid-argument', 'Se seleccionó un proveedor no compatible.');
    }
    if (!(0, domain_1.isAspectRatio)(aspectRatio)) {
        throw new https_1.HttpsError('invalid-argument', 'Se seleccionó una relación de aspecto no compatible.');
    }
    const poseIds = Array.isArray(data?.poseIds)
        ? [...new Set(data.poseIds.filter((value) => typeof value === 'string' && value.trim().length > 0))]
        : [];
    if (poseIds.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Selecciona al menos una pose.');
    }
    const garments = Array.isArray(data?.garments) ? data.garments.map(exports.normalizeGarment) : [];
    if (garments.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Debes subir al menos una prenda.');
    }
    garments.forEach((garment) => (0, exports.ensureDraftOwnership)(authUid, garment));
    const experimentMultiplier = experiment?.mode === 'ab_paired' ? experiment.arms.length : 1;
    const totalJobs = poseIds.length * garments.length * experimentMultiplier;
    if (totalJobs > maxJobs) {
        throw new https_1.HttpsError('out-of-range', `El lote excede el límite configurado de ${maxJobs} trabajos (${totalJobs} solicitados).`);
    }
    return {
        clientId,
        modelId,
        poseIds,
        garments,
        provider: experiment ? experiment.arms[0].provider : provider,
        experiment,
        promptBase,
        aspectRatio,
        totalJobs,
    };
};
exports.validateCreateGenerationBatchInput = validateCreateGenerationBatchInput;
const assertModelOwnershipAndPoses = (client, model, poseIds) => {
    if ((0, domain_1.isArchivedCatalogEntity)(client)) {
        throw new https_1.HttpsError('failed-precondition', 'El cliente seleccionado está archivado y ya no admite nuevos lotes.');
    }
    if ((0, domain_1.isArchivedCatalogEntity)(model)) {
        throw new https_1.HttpsError('failed-precondition', 'El modelo seleccionado está archivado y ya no admite nuevos lotes.');
    }
    if (model.clientId !== client.id) {
        throw new https_1.HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }
    const poseMap = (0, exports.getPoseMap)(model);
    poseIds.forEach((poseId) => {
        if (!poseMap.has(poseId)) {
            throw new https_1.HttpsError('invalid-argument', `La pose ${poseId} no pertenece al modelo seleccionado.`);
        }
    });
    return poseMap;
};
exports.assertModelOwnershipAndPoses = assertModelOwnershipAndPoses;
const buildJobDraft = (job, provider, promptBase, autoReviewMaxAttempts = 3) => ({
    requestedPromptBase: promptBase.trim(),
    provider,
    promptBase,
    finalPrompt: (0, domain_1.buildFinalGenerationPrompt)(promptBase, job.garmentIsMultiAngle),
    status: 'pending',
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
exports.buildJobDraft = buildJobDraft;
//# sourceMappingURL=createGenerationBatch.helpers.js.map