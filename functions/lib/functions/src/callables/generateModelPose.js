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
exports.generateModelPose = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const runtime_1 = require("../config/runtime");
const providerCosts_1 = require("../../../shared/src/constants/providerCosts");
const textToImage_1 = require("../providers/textToImage");
const runProvider = (provider, prompt, aspectRatio, falKey, openaiKey, referenceImageUrl) => {
    if (referenceImageUrl) {
        switch (provider) {
            case 'fal-seedream-v4.5':
                return (0, textToImage_1.editModelPhotoWithSeedreamV45)(prompt, aspectRatio, referenceImageUrl, falKey);
            case 'fal-banana-pro':
                return (0, textToImage_1.editModelPhotoWithBananaPro)(prompt, aspectRatio, referenceImageUrl, falKey);
            case 'openai-dalle':
                return (0, textToImage_1.editModelPhotoWithOpenAI)(prompt, aspectRatio, referenceImageUrl, openaiKey);
            default:
                throw new Error(`El proveedor ${provider} no soporta generación de poses desde referencia.`);
        }
    }
    switch (provider) {
        case 'fal-flux-pro': return (0, textToImage_1.generateModelPhotoWithFluxPro)(prompt, aspectRatio, falKey);
        case 'fal-flux-schnell': return (0, textToImage_1.generateModelPhotoWithFluxSchnell)(prompt, aspectRatio, falKey);
        case 'fal-seedream-v4': return (0, textToImage_1.generateModelPhotoWithSeedreamV4)(prompt, aspectRatio, falKey);
        case 'fal-seedream-v4.5': return (0, textToImage_1.generateModelPhotoWithSeedreamV45)(prompt, aspectRatio, falKey);
        case 'fal-banana': return (0, textToImage_1.generateModelPhotoWithBanana)(prompt, aspectRatio, falKey);
        case 'fal-banana-pro': return (0, textToImage_1.generateModelPhotoWithBananaPro)(prompt, aspectRatio, falKey);
        case 'fal-banana-2': return (0, textToImage_1.generateModelPhotoWithBanana2)(prompt, aspectRatio, falKey);
        case 'openai-dalle': return (0, textToImage_1.generateModelPhotoWithOpenAI)(prompt, aspectRatio, openaiKey);
        default: return (0, textToImage_1.generateModelPhotoWithFluxPro)(prompt, aspectRatio, falKey);
    }
};
exports.generateModelPose = (0, https_1.onCall)({ secrets: [runtime_1.FAL_KEY, runtime_1.OPENAI_API_KEY], timeoutSeconds: 300 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para usar esta función.');
    }
    const data = request.data;
    const { prompt, provider, aspectRatio, count, tempSessionId, clientId, modelId = null, stage = null, referenceStoragePath = null, } = data;
    if (!prompt || !provider || !aspectRatio || !count || !tempSessionId || !clientId) {
        throw new https_1.HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
    }
    if (count < 1 || count > 12) {
        throw new https_1.HttpsError('invalid-argument', 'El número de fotos debe estar entre 1 y 12.');
    }
    const bucket = admin.storage().bucket();
    const falKey = runtime_1.FAL_KEY.value();
    const openaiKey = runtime_1.OPENAI_API_KEY.value();
    const referenceImageUrl = referenceStoragePath
        ? (await bucket.file(referenceStoragePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000,
            version: 'v4',
        }))[0]
        : null;
    const results = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
        const result = await runProvider(provider, prompt, aspectRatio, falKey, openaiKey, referenceImageUrl);
        const ext = result.contentType.includes('jpeg') || result.contentType.includes('jpg') ? 'jpg' : 'png';
        const storageBasePath = modelId
            ? `model_generations/${clientId}/${modelId}/${stage ?? 'general'}/${tempSessionId}`
            : `model_generations/${clientId}/${tempSessionId}`;
        const storagePath = `${storageBasePath}/${index}.${ext}`;
        await bucket.file(storagePath).save(result.imageBytes, {
            metadata: { contentType: result.contentType },
            resumable: false,
        });
        return { index, storagePath, contentType: result.contentType };
    }));
    const photos = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
    const errors = results
        .filter((r) => r.status === 'rejected')
        .map((r, i) => ({ index: i, message: String(r.reason?.message ?? 'Error desconocido') }));
    if (photos.length === 0) {
        throw new https_1.HttpsError('internal', `Todas las generaciones fallaron: ${errors.map((e) => e.message).join('; ')}`);
    }
    // Write cost log
    const costPerPhoto = providerCosts_1.MODEL_PHOTO_PROVIDER_COSTS[provider] ?? 0;
    const estimatedCostUsd = costPerPhoto * photos.length;
    await admin.firestore().collection('model_generation_logs').add({
        provider,
        requestedPhotos: count,
        completedPhotos: photos.length,
        estimatedCostUsd,
        clientId,
        modelId,
        stage,
        createdByUid: request.auth.uid,
        createdByDisplayName: request.auth.token.name ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, photos, errors, estimatedCostUsd };
});
//# sourceMappingURL=generateModelPose.js.map