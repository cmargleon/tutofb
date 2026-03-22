"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGenerationBatch = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const runtime_1 = require("../config/runtime");
const appFirestore_1 = require("../firebase/appFirestore");
const createGenerationBatch_helpers_1 = require("./createGenerationBatch.helpers");
exports.createGenerationBatch = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador']);
    const validated = (0, createGenerationBatch_helpers_1.validateCreateGenerationBatchInput)(request.data, request.auth.uid, (0, runtime_1.getBatchMaxJobs)());
    const db = (0, appFirestore_1.getAppFirestore)();
    const clientRef = db.collection('clients').doc(validated.clientId);
    const modelRef = db.collection('models').doc(validated.modelId);
    const userRef = db.collection('users').doc(request.auth.uid);
    const [clientSnapshot, modelSnapshot, userSnapshot] = await Promise.all([clientRef.get(), modelRef.get(), userRef.get()]);
    if (!clientSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'No se encontró el cliente seleccionado.');
    }
    if (!modelSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'No se encontró el modelo seleccionado.');
    }
    const client = { id: clientSnapshot.id, ...clientSnapshot.data() };
    const model = { id: modelSnapshot.id, ...modelSnapshot.data() };
    const createdByDisplayName = userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data().displayName
        : null;
    if (model.clientId !== client.id) {
        throw new https_1.HttpsError('invalid-argument', 'El modelo seleccionado no pertenece al cliente elegido.');
    }
    const poseMap = (0, createGenerationBatch_helpers_1.assertModelOwnershipAndPoses)(client, model, validated.poseIds);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batchRef = db.collection('batches').doc();
    const experimentId = validated.experiment ? batchRef.id : null;
    const batchData = {
        clientId: client.id,
        clientNameSnapshot: client.name,
        clientSnapshot: {
            id: client.id,
            name: client.name,
        },
        modelId: model.id,
        modelNameSnapshot: model.name,
        modelSnapshot: {
            id: model.id,
            clientId: model.clientId,
            name: model.name,
            poseCount: model.poseCount,
            coverPoseId: model.coverPoseId || model.poses[0]?.id || null,
            coverPosePath: model.coverPosePath || model.poses[0]?.storagePath || null,
        },
        provider: validated.provider,
        experimentEnabled: Boolean(validated.experiment),
        experimentId,
        experimentMode: validated.experiment?.mode || null,
        experimentArms: validated.experiment?.arms || null,
        aspectRatio: validated.aspectRatio,
        promptBase: validated.promptBase,
        poseIds: validated.poseIds,
        garmentCount: validated.garments.length,
        totalJobs: validated.totalJobs,
        pendingJobs: validated.totalJobs,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        completedOutputCount: 0,
        status: 'pending',
        latestJobCreatedAt: now,
        lastJobCompletedAt: null,
        createdAt: now,
        updatedAt: now,
        createdByUid: request.auth.uid,
        createdByDisplayName,
    };
    const writeBatch = db.batch();
    writeBatch.set(batchRef, batchData);
    const maxRetries = (0, runtime_1.getJobMaxRetries)();
    const autoReviewMaxAttempts = (0, runtime_1.getJobAutoReviewMaxAttempts)();
    let combinationIndex = 0;
    for (const garment of validated.garments) {
        for (const poseId of validated.poseIds) {
            const pose = poseMap.get(poseId);
            if (!pose) {
                continue;
            }
            const comparisonKey = `${pose.id}::${garment.id}`;
            const assignedArms = validated.experiment
                ? (validated.experiment.mode === 'ab_paired'
                    ? validated.experiment.arms
                    : [validated.experiment.arms[combinationIndex % validated.experiment.arms.length]])
                : [null];
            assignedArms.forEach((assignedArm) => {
                const selectedProvider = assignedArm?.provider || validated.provider;
                const jobRef = db.collection('jobs').doc();
                const jobDraft = (0, createGenerationBatch_helpers_1.buildJobDraft)({
                    garmentIsMultiAngle: garment.isMultiAngle,
                }, selectedProvider, validated.promptBase, autoReviewMaxAttempts);
                const jobData = {
                    batchId: batchRef.id,
                    clientId: client.id,
                    clientNameSnapshot: client.name,
                    modelId: model.id,
                    modelNameSnapshot: model.name,
                    experimentEnabled: Boolean(assignedArm),
                    experimentId,
                    experimentMode: validated.experiment?.mode || null,
                    experimentArmId: assignedArm?.id || null,
                    experimentArmLabel: assignedArm?.label || null,
                    experimentComparisonKey: assignedArm ? comparisonKey : null,
                    poseImageId: pose.id,
                    poseImagePath: pose.storagePath,
                    poseFileName: pose.fileName,
                    garmentId: garment.id,
                    garmentName: garment.name,
                    garmentFilePath: garment.storagePath,
                    garmentSourceType: garment.sourceType,
                    garmentOriginalFileNames: garment.originalFileNames || [],
                    garmentIsMultiAngle: garment.isMultiAngle,
                    aspectRatio: validated.aspectRatio,
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
                        batchCreatedByUid: request.auth.uid,
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
                    createdByUid: request.auth.uid,
                    lastError: null,
                };
                writeBatch.set(jobRef, jobData);
            });
            combinationIndex += 1;
        }
    }
    writeBatch.set(clientRef, {
        batchCount: admin.firestore.FieldValue.increment(1),
        lastBatchCreatedAt: now,
        updatedAt: now,
    }, { merge: true });
    await writeBatch.commit();
    return {
        batchId: batchRef.id,
        createdJobs: validated.totalJobs,
    };
});
//# sourceMappingURL=createGenerationBatch.js.map