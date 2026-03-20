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
exports.onClientDelete = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const recursiveDelete_1 = require("../utils/recursiveDelete");
const appFirestore_1 = require("../firebase/appFirestore");
exports.onClientDelete = (0, firestore_1.onDocumentDeleted)('clients/{clientId}', async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const clientId = event.params.clientId;
    const db = (0, appFirestore_1.getAppFirestore)();
    const bucket = admin.storage().bucket();
    const [modelsSnapshot, batchesSnapshot, jobsSnapshot] = await Promise.all([
        db.collection('models').where('clientId', '==', clientId).get(),
        db.collection('batches').where('clientId', '==', clientId).get(),
        db.collection('jobs').where('clientId', '==', clientId).get(),
    ]);
    await (0, recursiveDelete_1.recursiveDeleteDocuments)(jobsSnapshot.docs);
    await (0, recursiveDelete_1.recursiveDeleteDocuments)(batchesSnapshot.docs);
    await (0, recursiveDelete_1.recursiveDeleteDocuments)(modelsSnapshot.docs);
    await Promise.allSettled([
        bucket.deleteFiles({ prefix: `models/${clientId}/`, force: true }),
        bucket.deleteFiles({ prefix: `generated/${clientId}/`, force: true }),
    ]);
});
//# sourceMappingURL=onClientDelete.js.map