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
exports.cancelPendingBatchJobs = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
exports.cancelPendingBatchJobs = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador']);
    const batchId = typeof request.data?.batchId === 'string' ? request.data.batchId.trim() : '';
    if (!batchId) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un lote válido.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const batchSnapshot = await db.collection('batches').doc(batchId).get();
    if (!batchSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'Lote no encontrado.');
    }
    const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batchId).get();
    const pendingJobs = jobsSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((job) => job.status === 'pending');
    if (pendingJobs.length === 0) {
        return {
            success: true,
            batchId,
            cancelledJobs: 0,
        };
    }
    const writeBatch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    pendingJobs.forEach((job) => {
        const jobRef = db.collection('jobs').doc(job.id);
        writeBatch.update(jobRef, {
            status: 'failed',
            queuePriority: 0,
            claimToken: null,
            claimedBy: null,
            claimExpiresAt: null,
            timeoutAt: null,
            startedAt: null,
            lastAttemptStartedAt: null,
            updatedAt: now,
            lastError: 'Cancelado manualmente desde la cola.',
        });
        writeBatch.set(jobRef.collection('logs').doc(), {
            type: 'system',
            level: 'warn',
            message: 'El job pendiente fue cancelado manualmente desde la cola.',
            payload: {
                requestedByUid: request.auth.uid,
                source: 'queue_cancel_pending',
                batchId,
            },
            createdAt: now,
        });
    });
    await writeBatch.commit();
    return {
        success: true,
        batchId,
        cancelledJobs: pendingJobs.length,
    };
});
//# sourceMappingURL=cancelPendingBatchJobs.js.map