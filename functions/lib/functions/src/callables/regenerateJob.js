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
exports.regenerateJob = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const regenerateJob_helpers_1 = require("./regenerateJob.helpers");
const appFirestore_1 = require("../firebase/appFirestore");
exports.regenerateJob = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador', 'revisor']);
    const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
    const provider = request.data?.provider;
    const prompt = typeof request.data?.prompt === 'string' ? request.data.prompt.trim() : '';
    if (!jobId) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un trabajo para regenerar.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const jobRef = db.collection('jobs').doc(jobId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
        throw new https_1.HttpsError('not-found', 'Trabajo no encontrado.');
    }
    const job = { id: snapshot.id, ...snapshot.data() };
    if (job.status === 'processing') {
        throw new https_1.HttpsError('failed-precondition', 'Este trabajo ya se está procesando. Espera a que termine antes de regenerarlo.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
        await jobRef.update({
            ...(0, regenerateJob_helpers_1.buildRegenerateJobPatch)(job, provider || '', prompt),
            updatedAt: now,
        });
    }
    catch (error) {
        throw new https_1.HttpsError('invalid-argument', error instanceof Error ? error.message : 'Solicitud inválida.');
    }
    await jobRef.collection('logs').add({
        type: 'system',
        level: 'info',
        message: 'Regeneración encolada desde la aplicación.',
        payload: {
            requestedByUid: request.auth.uid,
            provider,
            prompt,
        },
        createdAt: now,
    });
    return {
        success: true,
        jobId,
    };
});
//# sourceMappingURL=regenerateJob.js.map