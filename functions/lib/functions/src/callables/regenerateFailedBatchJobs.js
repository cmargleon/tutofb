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
exports.regenerateFailedBatchJobs = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const regenerateJob_helpers_1 = require("./regenerateJob.helpers");
exports.regenerateFailedBatchJobs = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador', 'revisor']);
    const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
    if (!batchId) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un lote válido.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const batchSnapshot = await db.collection('batches').doc(batchId).get();
    if (!batchSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'Lote no encontrado.');
    }
    const userSnapshot = await db.collection('users').doc(request.auth.uid).get();
    const requestedByDisplayName = userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data().displayName
        : null;
    const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();
    const failedJobs = jobsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((job) => job.status === 'failed');
    if (failedJobs.length === 0) {
        return {
            success: true,
            batchId,
            queuedJobs: 0,
            skippedJobs: 0,
            skippedJobIds: [],
        };
    }
    const writeBatch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const skippedJobIds = [];
    let queuedJobs = 0;
    failedJobs.forEach((job) => {
        const prompt = (job.promptBase || job.finalPrompt || '').trim();
        try {
            const patch = (0, regenerateJob_helpers_1.buildRegenerateJobPatch)(job, job.provider, prompt);
            const jobRef = db.collection('jobs').doc(job.id);
            writeBatch.update(jobRef, {
                ...patch,
                manualRegenerationCount: admin.firestore.FieldValue.increment(1),
                'traceability.lastManualRegenerationAt': now,
                'traceability.lastManualRegeneratedByUid': request.auth.uid,
                'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
                updatedAt: now,
            });
            writeBatch.set(jobRef.collection('logs').doc(), {
                type: 'system',
                level: 'info',
                message: 'Regeneración masiva de fallidos encolada desde la aplicación.',
                payload: {
                    requestedByUid: request.auth.uid,
                    requestedByDisplayName,
                    source: 'batch_failed_retry',
                    batchId,
                    provider: job.provider,
                    prompt,
                },
                createdAt: now,
            });
            queuedJobs += 1;
        }
        catch {
            skippedJobIds.push(job.id);
        }
    });
    if (queuedJobs > 0) {
        await writeBatch.commit();
    }
    return {
        success: true,
        batchId,
        queuedJobs,
        skippedJobs: skippedJobIds.length,
        skippedJobIds,
    };
});
//# sourceMappingURL=regenerateFailedBatchJobs.js.map