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
exports.processJob = exports.requeueExpiredJobs = void 0;
const node_crypto_1 = require("node:crypto");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const providers_1 = require("../providers");
const runtime_1 = require("../config/runtime");
const appFirestore_1 = require("../firebase/appFirestore");
const db = (0, appFirestore_1.getAppFirestore)();
const bucket = admin.storage().bucket();
const toMillis = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof firestore_1.Timestamp) {
        return value.toMillis();
    }
    if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};
const getSignedUrl = async (storagePath) => {
    const file = bucket.file(storagePath);
    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
        version: 'v4',
    });
    return url;
};
const extensionForContentType = (contentType) => {
    if (contentType.includes('jpeg'))
        return 'jpg';
    if (contentType.includes('webp'))
        return 'webp';
    return 'png';
};
const serializeError = (error) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return {
        message: 'Error desconocido',
        raw: error,
    };
};
const createLog = async (jobId, input) => {
    await db.collection('jobs').doc(jobId).collection('logs').add({
        ...input,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
};
const claimJob = async (jobId, workerId) => {
    const jobRef = db.collection('jobs').doc(jobId);
    const claimExpiresAt = firestore_1.Timestamp.fromMillis(Date.now() + (0, runtime_1.getJobTimeoutMs)());
    const claimToken = (0, node_crypto_1.randomUUID)();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        if (!snapshot.exists) {
            return null;
        }
        const job = { id: snapshot.id, ...snapshot.data() };
        if (job.status !== 'pending') {
            return null;
        }
        transaction.update(jobRef, {
            status: 'processing',
            claimToken,
            claimedBy: workerId,
            claimExpiresAt,
            timeoutAt: claimExpiresAt,
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastAttemptStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            'traceability.lastAttemptStartedAt': admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: null,
        });
        return {
            ...job,
            status: 'processing',
            claimToken,
            claimedBy: workerId,
            claimExpiresAt,
            timeoutAt: claimExpiresAt,
            startedAt: claimExpiresAt,
            lastAttemptStartedAt: claimExpiresAt,
            lastError: null,
        };
    });
};
const markCleanupResult = async (jobId, outputId, deleted, storagePath, error) => {
    const outputRef = db.collection('jobs').doc(jobId).collection('outputs').doc(outputId);
    if (deleted) {
        await outputRef.set({
            storageDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await createLog(jobId, {
            type: 'cleanup',
            level: 'info',
            message: 'Se eliminó el archivo previo del resultado regenerado.',
            outputId,
            payload: {
                storagePath,
            },
        });
        return;
    }
    await createLog(jobId, {
        type: 'cleanup',
        level: 'warn',
        message: 'No se pudo eliminar el archivo previo del resultado regenerado.',
        outputId,
        payload: {
            storagePath,
            error: serializeError(error),
        },
    });
};
const completeJob = async (claimedJob, providerResult, durationSeconds) => {
    const jobId = claimedJob.id;
    const jobRef = db.collection('jobs').doc(jobId);
    const outputRef = jobRef.collection('outputs').doc();
    const outputId = outputRef.id;
    const extension = extensionForContentType(providerResult.contentType);
    const destinationPath = `generated/${claimedJob.clientId}/${claimedJob.batchId}/${jobId}/${outputId}.${extension}`;
    await bucket.file(destinationPath).save(providerResult.imageBytes, {
        resumable: false,
        metadata: {
            contentType: providerResult.contentType,
            cacheControl: 'private, max-age=31536000',
        },
    });
    const costUsd = claimedJob.provider === 'fal-seedream'
        ? 0.03
        : claimedJob.provider === 'fal-banana-pro'
            ? 0.15
            : 0.04;
    const currentOutput = {
        id: outputId,
        jobId,
        batchId: claimedJob.batchId,
        clientId: claimedJob.clientId,
        clientNameSnapshot: claimedJob.clientNameSnapshot,
        modelId: claimedJob.modelId,
        modelNameSnapshot: claimedJob.modelNameSnapshot,
        experimentEnabled: claimedJob.experimentEnabled || false,
        experimentId: claimedJob.experimentId || null,
        experimentMode: claimedJob.experimentMode || null,
        experimentArmId: claimedJob.experimentArmId || null,
        experimentArmLabel: claimedJob.experimentArmLabel || null,
        experimentComparisonKey: claimedJob.experimentComparisonKey || null,
        poseImageId: claimedJob.poseImageId,
        garmentId: claimedJob.garmentId,
        garmentName: claimedJob.garmentName,
        provider: providerResult.provider,
        promptBase: claimedJob.promptBase,
        finalPrompt: claimedJob.finalPrompt,
        aspectRatio: claimedJob.aspectRatio,
        resultImagePath: destinationPath,
        contentType: providerResult.contentType,
        remoteUrl: providerResult.remoteUrl,
        requestId: providerResult.requestId,
        costUsd,
        durationSeconds,
        providerResponseSummary: providerResult.responseSummary,
        isCurrent: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const writeBatch = db.batch();
    writeBatch.set(outputRef, currentOutput);
    if (claimedJob.currentOutputId) {
        writeBatch.set(jobRef.collection('outputs').doc(claimedJob.currentOutputId), {
            isCurrent: false,
        }, { merge: true });
    }
    writeBatch.update(jobRef, {
        provider: providerResult.provider,
        status: 'completed',
        queuePriority: 0,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        latestOutputCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        currentOutputId: outputId,
        currentOutput,
        completedOutputCount: admin.firestore.FieldValue.increment(1),
        totalCostUsd: admin.firestore.FieldValue.increment(costUsd),
        totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds || 0),
        [`providerUsage.${providerResult.provider}.completedOutputs`]: admin.firestore.FieldValue.increment(1),
        [`providerUsage.${providerResult.provider}.totalCostUsd`]: admin.firestore.FieldValue.increment(costUsd),
        [`providerUsage.${providerResult.provider}.totalDurationSeconds`]: admin.firestore.FieldValue.increment(durationSeconds || 0),
        'traceability.lastCompletedAt': admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: null,
    });
    writeBatch.set(jobRef.collection('logs').doc(), {
        type: 'provider_response',
        level: 'info',
        message: 'Proveedor completó la generación exitosamente.',
        outputId,
        payload: {
            provider: providerResult.provider,
            requestId: providerResult.requestId,
            remoteUrl: providerResult.remoteUrl,
            summary: providerResult.responseSummary,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writeBatch.set(jobRef.collection('logs').doc(), {
        type: 'completed',
        level: 'info',
        message: 'Trabajo completado y resultado guardado en Storage.',
        outputId,
        payload: {
            destinationPath,
            durationSeconds,
            costUsd,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await writeBatch.commit();
    if (claimedJob.currentOutputId && claimedJob.currentOutput?.resultImagePath) {
        try {
            await bucket.file(claimedJob.currentOutput.resultImagePath).delete({ ignoreNotFound: true });
            await markCleanupResult(jobId, claimedJob.currentOutputId, true, claimedJob.currentOutput.resultImagePath);
        }
        catch (error) {
            await markCleanupResult(jobId, claimedJob.currentOutputId, false, claimedJob.currentOutput.resultImagePath, error);
        }
    }
};
const retryOrFailJob = async (claimedJob, error) => {
    const jobRef = db.collection('jobs').doc(claimedJob.id);
    const nextRetryCount = (claimedJob.retryCount || 0) + 1;
    const shouldRetry = nextRetryCount <= (claimedJob.maxRetries || 0);
    const errorMessage = error instanceof Error ? error.message : 'Ocurrió un error desconocido durante la generación.';
    const writeBatch = db.batch();
    writeBatch.update(jobRef, {
        status: shouldRetry ? 'pending' : 'failed',
        queuePriority: shouldRetry ? 0 : 0,
        retryCount: nextRetryCount,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        'traceability.lastProviderErrorAt': admin.firestore.FieldValue.serverTimestamp(),
        'traceability.lastProviderErrorMessage': errorMessage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: errorMessage,
    });
    writeBatch.set(jobRef.collection('logs').doc(), {
        type: shouldRetry ? 'retry_scheduled' : 'failed',
        level: shouldRetry ? 'warn' : 'error',
        message: shouldRetry
            ? `La generación falló y quedó reencolada para el intento ${nextRetryCount}.`
            : 'La generación agotó sus reintentos y quedó fallida.',
        payload: {
            retryCount: nextRetryCount,
            maxRetries: claimedJob.maxRetries,
            error: serializeError(error),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await writeBatch.commit();
};
const requeueExpiredJobs = async () => {
    const snapshot = await db
        .collection('jobs')
        .where('status', '==', 'processing')
        .where('claimExpiresAt', '<=', firestore_1.Timestamp.now())
        .limit((0, runtime_1.getJobStuckSweepLimit)())
        .get();
    if (snapshot.empty) {
        return 0;
    }
    const writeBatch = db.batch();
    snapshot.docs.forEach((docSnapshot) => {
        const job = { id: docSnapshot.id, ...docSnapshot.data() };
        const nextRetryCount = (job.retryCount || 0) + 1;
        const shouldRetry = nextRetryCount <= (job.maxRetries || 0);
        writeBatch.update(docSnapshot.ref, {
            status: shouldRetry ? 'pending' : 'failed',
            retryCount: nextRetryCount,
            claimToken: null,
            claimedBy: null,
            claimExpiresAt: null,
            timeoutAt: null,
            startedAt: null,
            'traceability.lastProviderErrorAt': admin.firestore.FieldValue.serverTimestamp(),
            'traceability.lastProviderErrorMessage': shouldRetry
                ? 'El trabajo excedió el tiempo máximo de ejecución y fue reencolado.'
                : 'El trabajo excedió el tiempo máximo de ejecución y agotó sus reintentos.',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastError: shouldRetry
                ? 'El trabajo excedió el tiempo máximo de ejecución y fue reencolado.'
                : 'El trabajo excedió el tiempo máximo de ejecución y agotó sus reintentos.',
        });
        writeBatch.set(docSnapshot.ref.collection('logs').doc(), {
            type: shouldRetry ? 'retry_scheduled' : 'failed',
            level: shouldRetry ? 'warn' : 'error',
            message: shouldRetry
                ? 'El trabajo quedó atascado y fue reencolado automáticamente.'
                : 'El trabajo quedó atascado y fue marcado como fallido al agotar reintentos.',
            payload: {
                retryCount: nextRetryCount,
                maxRetries: job.maxRetries,
                previousClaimToken: job.claimToken,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    await writeBatch.commit();
    return snapshot.size;
};
exports.requeueExpiredJobs = requeueExpiredJobs;
const processJob = async (jobId, source) => {
    await (0, exports.requeueExpiredJobs)();
    const workerId = `worker:${source}:${(0, node_crypto_1.randomUUID)()}`;
    const claimedJob = await claimJob(jobId, workerId);
    if (!claimedJob) {
        return;
    }
    await createLog(jobId, {
        type: 'claim',
        level: 'info',
        message: 'Trabajo reclamado por el worker.',
        payload: {
            workerId,
            claimToken: claimedJob.claimToken,
            source,
        },
    });
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), (0, runtime_1.getJobTimeoutMs)());
    try {
        const [poseImageUrl, garmentImageUrl] = await Promise.all([
            getSignedUrl(claimedJob.poseImagePath),
            getSignedUrl(claimedJob.garmentFilePath),
        ]);
        await createLog(jobId, {
            type: 'provider_request',
            level: 'info',
            message: 'Se enviaron los insumos al proveedor.',
            payload: {
                provider: claimedJob.provider,
                aspectRatio: claimedJob.aspectRatio,
                poseImagePath: claimedJob.poseImagePath,
                garmentFilePath: claimedJob.garmentFilePath,
            },
        });
        const providerResult = await (0, providers_1.generateWithProvider)(claimedJob.provider, {
            poseImageUrl,
            garmentImageUrl,
            prompt: claimedJob.finalPrompt,
            aspectRatio: claimedJob.aspectRatio,
            signal: controller.signal,
        }, {
            falKey: runtime_1.FAL_KEY.value(),
            openaiApiKey: runtime_1.OPENAI_API_KEY.value(),
        });
        const startedAtMs = toMillis(claimedJob.lastAttemptStartedAt) || Date.now();
        const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
        await completeJob(claimedJob, providerResult, durationSeconds);
    }
    catch (error) {
        await retryOrFailJob(claimedJob, error);
    }
    finally {
        clearTimeout(timeoutHandle);
    }
};
exports.processJob = processJob;
//# sourceMappingURL=jobWorker.js.map