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
exports.onModelDelete = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const deletePlans_1 = require("./deletePlans");
const recursiveDelete_1 = require("../utils/recursiveDelete");
const appFirestore_1 = require("../firebase/appFirestore");
exports.onModelDelete = (0, firestore_1.onDocumentDeleted)('models/{modelId}', async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const model = snapshot.data();
    const modelId = event.params.modelId;
    const db = (0, appFirestore_1.getAppFirestore)();
    const bucket = admin.storage().bucket();
    const [batchesSnapshot, jobsSnapshot, outputsSnapshot] = await Promise.all([
        db.collection('batches').where('modelId', '==', modelId).get(),
        db.collection('jobs').where('modelId', '==', modelId).get(),
        db.collectionGroup('outputs').where('modelId', '==', modelId).get(),
    ]);
    const outputPaths = (0, deletePlans_1.extractLiveOutputPaths)(outputsSnapshot.docs.map((docSnapshot) => docSnapshot.data()));
    await (0, recursiveDelete_1.recursiveDeleteDocuments)(jobsSnapshot.docs);
    await (0, recursiveDelete_1.recursiveDeleteDocuments)(batchesSnapshot.docs);
    await Promise.allSettled([
        bucket.deleteFiles({ prefix: `models/${model.clientId}/${modelId}/`, force: true }),
        ...outputPaths.map((storagePath) => bucket.file(storagePath).delete({ ignoreNotFound: true })),
    ]);
});
//# sourceMappingURL=onModelDelete.js.map