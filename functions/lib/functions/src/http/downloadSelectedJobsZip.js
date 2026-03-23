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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadSelectedJobsZip = void 0;
const admin = __importStar(require("firebase-admin"));
const jszip_1 = __importDefault(require("jszip"));
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const downloadAssets_helpers_1 = require("./downloadAssets.helpers");
const db = (0, appFirestore_1.getAppFirestore)();
const MAX_SELECTED_JOBS = 100;
exports.downloadSelectedJobsZip = (0, https_1.onRequest)({
    timeoutSeconds: 300,
    cors: true,
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
            throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para descargar la selección.');
        }
        const decodedToken = await admin.auth().verifyIdToken(token);
        await (0, roles_1.assertUserRoles)(decodedToken.uid, decodedToken.role, ['admin', 'operador', 'revisor']);
        const body = (0, downloadAssets_helpers_1.parseBody)(request.body);
        const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : '';
        const jobIds = Array.isArray(body.jobIds)
            ? body.jobIds
                .filter((value) => typeof value === 'string')
                .map((value) => value.trim())
                .filter(Boolean)
            : [];
        const selectedOutputIdsByJobId = body.selectedOutputIdsByJobId && typeof body.selectedOutputIdsByJobId === 'object'
            ? body.selectedOutputIdsByJobId
            : {};
        if (!batchId || jobIds.length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'Debes indicar el lote y al menos un job para descargar.');
        }
        if (jobIds.length > MAX_SELECTED_JOBS) {
            throw new https_1.HttpsError('invalid-argument', `Solo puedes descargar hasta ${MAX_SELECTED_JOBS} jobs por ZIP.`);
        }
        const batchSnapshot = await db.collection('batches').doc(batchId).get();
        if (!batchSnapshot.exists) {
            throw new https_1.HttpsError('not-found', 'Lote no encontrado.');
        }
        const batch = { id: batchSnapshot.id, ...batchSnapshot.data() };
        const jobsSnapshot = await db
            .collection('jobs')
            .where('batchId', '==', batchId)
            .orderBy('createdAt', 'asc')
            .get();
        const selectedIds = new Set(jobIds);
        const orderedSelectedJobs = jobsSnapshot.docs
            .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
            .filter((job) => selectedIds.has(job.id) && (0, domain_1.resolveApprovedJobOutput)(job)?.resultImagePath);
        if (orderedSelectedJobs.length === 0) {
            throw new https_1.HttpsError('failed-precondition', 'Los jobs seleccionados no tienen imágenes listas para descargar.');
        }
        const poseIndexes = Object.fromEntries(jobsSnapshot.docs.map((snapshot, index) => [snapshot.id, index]));
        const zip = new jszip_1.default();
        const zipFolderName = `${(0, downloadAssets_helpers_1.buildZipFolderName)(batch)}_seleccion`;
        const folder = zip.folder(zipFolderName);
        if (!folder) {
            throw new Error('No se pudo preparar el ZIP de la selección.');
        }
        for (const job of orderedSelectedJobs) {
            const requestedOutputId = typeof selectedOutputIdsByJobId[job.id || ''] === 'string'
                ? String(selectedOutputIdsByJobId[job.id || '']).trim()
                : '';
            const selectedOutputSnapshot = requestedOutputId
                ? db.collection('jobs').doc(job.id).collection('outputs').doc(requestedOutputId).get()
                : null;
            const resolvedSelectedOutputSnapshot = selectedOutputSnapshot ? await selectedOutputSnapshot : null;
            const selectedOutput = resolvedSelectedOutputSnapshot?.exists
                ? { id: resolvedSelectedOutputSnapshot.id, ...resolvedSelectedOutputSnapshot.data() }
                : null;
            const resultImagePath = (selectedOutput || (0, domain_1.resolveApprovedJobOutput)(job))?.resultImagePath;
            if (!resultImagePath) {
                continue;
            }
            const bytes = await (0, downloadAssets_helpers_1.readAssetBytes)(resultImagePath);
            folder.file((0, downloadAssets_helpers_1.buildJobImageFilename)(batch, job, poseIndexes[job.id] ?? 0), bytes);
        }
        const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });
        response.set('Content-Type', 'application/zip');
        response.set('Content-Disposition', `attachment; filename="${zipFolderName}.zip"`);
        response.set('Cache-Control', 'private, no-store, max-age=0');
        response.status(200).send(zipBuffer);
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
        console.error('Error preparing selected jobs ZIP:', error);
        response.status(500).json({ message: 'No se pudo preparar la descarga de la selección.' });
    }
});
//# sourceMappingURL=downloadSelectedJobsZip.js.map