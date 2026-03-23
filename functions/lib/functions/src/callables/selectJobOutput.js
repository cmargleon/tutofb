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
exports.selectJobOutput = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
exports.selectJobOutput = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador', 'revisor']);
    const jobId = typeof request.data?.jobId === 'string' ? request.data.jobId.trim() : '';
    const rawOutputId = typeof request.data?.outputId === 'string' ? request.data.outputId.trim() : '';
    const outputId = rawOutputId || null;
    if (!jobId) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un trabajo para guardar la selección.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const jobRef = db.collection('jobs').doc(jobId);
    const userRef = db.collection('users').doc(request.auth.uid);
    const [jobSnapshot, userSnapshot] = await Promise.all([jobRef.get(), userRef.get()]);
    if (!jobSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'Trabajo no encontrado.');
    }
    const job = { id: jobSnapshot.id, ...jobSnapshot.data() };
    const now = admin.firestore.FieldValue.serverTimestamp();
    const requestedByDisplayName = userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data().displayName
        : null;
    if (!outputId) {
        await jobRef.update({
            userSelectedOutputId: null,
            userSelectedOutput: null,
            updatedAt: now,
        });
        await jobRef.collection('logs').add({
            type: 'system',
            level: 'info',
            message: 'Se restableció la salida aprobada automática del job.',
            payload: {
                requestedByUid: request.auth.uid,
                requestedByDisplayName,
                previousOutputId: job.userSelectedOutputId || null,
            },
            createdAt: now,
        });
        return {
            success: true,
            jobId,
            outputId: null,
        };
    }
    const outputSnapshot = await jobRef.collection('outputs').doc(outputId).get();
    if (!outputSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'La miniatura seleccionada ya no existe dentro de este job.');
    }
    const output = { id: outputSnapshot.id, ...outputSnapshot.data() };
    if (!output.resultImagePath) {
        throw new https_1.HttpsError('failed-precondition', 'La salida seleccionada todavía no tiene una imagen disponible.');
    }
    await jobRef.update({
        userSelectedOutputId: output.id,
        userSelectedOutput: output,
        updatedAt: now,
    });
    await jobRef.collection('logs').add({
        type: 'system',
        level: 'info',
        message: 'Usuario marcó manualmente una salida como aprobada.',
        outputId: output.id,
        payload: {
            requestedByUid: request.auth.uid,
            requestedByDisplayName,
            outputId: output.id,
            generationAttempt: output.generationAttempt || null,
            previousOutputId: job.userSelectedOutputId || null,
        },
        createdAt: now,
    });
    return {
        success: true,
        jobId,
        outputId: output.id,
    };
});
//# sourceMappingURL=selectJobOutput.js.map