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
exports.readAssetBytes = exports.parseBody = exports.getBearerToken = exports.setCorsHeaders = exports.buildZipFolderName = exports.buildJobImageFilename = exports.getExtension = exports.isRemoteUrl = exports.normalizeFilename = void 0;
const admin = __importStar(require("firebase-admin"));
const domain_1 = require("../../../shared/src/domain");
const bucket = admin.storage().bucket();
const normalizeFilename = (value) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'archivo';
exports.normalizeFilename = normalizeFilename;
const isRemoteUrl = (value) => value.startsWith('http://') || value.startsWith('https://');
exports.isRemoteUrl = isRemoteUrl;
const getExtension = (value) => {
    const match = value.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1]?.toLowerCase() || 'png';
};
exports.getExtension = getExtension;
const buildJobImageFilename = (batch, job, poseIndex) => [
    (0, exports.normalizeFilename)(batch.clientNameSnapshot || 'cliente'),
    (0, exports.normalizeFilename)(batch.modelNameSnapshot || 'modelo'),
    (0, exports.normalizeFilename)(job.garmentName || `job-${job.id}`),
    `pose-${poseIndex + 1}`,
    `job-${job.id}.${(0, exports.getExtension)((0, domain_1.resolveApprovedJobOutput)(job)?.resultImagePath || '')}`,
].join('_');
exports.buildJobImageFilename = buildJobImageFilename;
const buildZipFolderName = (batch) => [
    (0, exports.normalizeFilename)(batch.clientNameSnapshot || 'cliente'),
    (0, exports.normalizeFilename)(batch.modelNameSnapshot || 'modelo'),
    (0, exports.normalizeFilename)(batch.id || 'batch'),
].join('_');
exports.buildZipFolderName = buildZipFolderName;
const setCorsHeaders = (origin, response) => {
    response.set('Access-Control-Allow-Origin', origin || '*');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Vary', 'Origin');
};
exports.setCorsHeaders = setCorsHeaders;
const getBearerToken = (authorizationHeader) => {
    if (!authorizationHeader?.startsWith('Bearer ')) {
        return null;
    }
    const token = authorizationHeader.slice('Bearer '.length).trim();
    return token || null;
};
exports.getBearerToken = getBearerToken;
const parseBody = (body) => {
    if (typeof body === 'string') {
        return JSON.parse(body);
    }
    if (body && typeof body === 'object') {
        return body;
    }
    return {};
};
exports.parseBody = parseBody;
const readAssetBytes = async (storagePath) => {
    if ((0, exports.isRemoteUrl)(storagePath)) {
        const response = await fetch(storagePath);
        if (!response.ok) {
            throw new Error(`No se pudo descargar el archivo remoto (${response.status}).`);
        }
        return Buffer.from(await response.arrayBuffer());
    }
    const [buffer] = await bucket.file(storagePath).download();
    return buffer;
};
exports.readAssetBytes = readAssetBytes;
//# sourceMappingURL=downloadAssets.helpers.js.map