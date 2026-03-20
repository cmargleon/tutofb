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
exports.downloadJobImage = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const downloadAssets_helpers_1 = require("./downloadAssets.helpers");
const db = (0, appFirestore_1.getAppFirestore)();
exports.downloadJobImage = (0, https_1.onRequest)({
    timeoutSeconds: 120,
    cors: [/localhost:\d+$/, /127\.0\.0\.1:\d+$/],
}, async (request, response) => {
    (0, downloadAssets_helpers_1.setCorsHeaders)(request.headers.origin, response);
    if (request.method === 'OPTIONS') {
        response.status(204).send('');
        return;
    }
    if (request.method !== 'POST') {
        response.status(405).json({ message: 'Método no permitido.' });
        return;
    }
    try {
        const token = (0, downloadAssets_helpers_1.getBearerToken)(request.header('Authorization') || request.header('authorization'));
        if (!token) {
            throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para descargar la imagen.');
        }
        const decodedToken = await admin.auth().verifyIdToken(token);
        await (0, roles_1.assertUserRoles)(decodedToken.uid, decodedToken.role, ['admin', 'operador', 'revisor']);
        const body = (0, downloadAssets_helpers_1.parseBody)(request.body);
        const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
        if (!jobId) {
            throw new https_1.HttpsError('invalid-argument', 'Debes indicar la imagen que quieres descargar.');
        }
        const jobSnapshot = await db.collection('jobs').doc(jobId).get();
        if (!jobSnapshot.exists) {
            throw new https_1.HttpsError('not-found', 'Trabajo no encontrado.');
        }
        const job = { id: jobSnapshot.id, ...jobSnapshot.data() };
        const resultImagePath = job.currentOutput?.resultImagePath;
        if (!resultImagePath) {
            throw new https_1.HttpsError('failed-precondition', 'Este trabajo todavía no tiene un resultado disponible.');
        }
        const batchSnapshot = await db.collection('batches').doc(job.batchId).get();
        if (!batchSnapshot.exists) {
            throw new https_1.HttpsError('not-found', 'No se encontró el lote asociado a la imagen.');
        }
        const batch = { id: batchSnapshot.id, ...batchSnapshot.data() };
        const jobsSnapshot = await db
            .collection('jobs')
            .where('batchId', '==', job.batchId)
            .orderBy('createdAt', 'asc')
            .get();
        const orderedJobs = jobsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
        const poseIndex = Math.max(0, orderedJobs.findIndex((candidate) => candidate.id === job.id));
        const fileBytes = await (0, downloadAssets_helpers_1.readAssetBytes)(resultImagePath);
        const fileName = (0, downloadAssets_helpers_1.buildJobImageFilename)(batch, job, poseIndex);
        const contentType = job.currentOutput?.contentType || 'image/png';
        response.set('Content-Type', contentType);
        response.set('Content-Disposition', `attachment; filename="${fileName}"`);
        response.set('Cache-Control', 'private, no-store, max-age=0');
        response.status(200).send(fileBytes);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            response.status(400).json({ message: 'El cuerpo de la solicitud no es JSON válido.' });
            return;
        }
        if (error instanceof https_1.HttpsError) {
            const statusCode = error.code === 'unauthenticated'
                ? 401
                : error.code === 'permission-denied'
                    ? 403
                    : error.code === 'not-found'
                        ? 404
                        : error.code === 'failed-precondition' || error.code === 'invalid-argument'
                            ? 400
                            : 500;
            response.status(statusCode).json({ message: error.message });
            return;
        }
        console.error('Error preparing job image download:', error);
        response.status(500).json({ message: 'No se pudo preparar la descarga de la imagen.' });
    }
});
//# sourceMappingURL=downloadJobImage.js.map