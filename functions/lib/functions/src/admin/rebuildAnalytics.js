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
exports.rebuildAnalytics = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const aggregation_1 = require("../analytics/aggregation");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const deleteCollectionDocs = async (collectionName) => {
    const db = (0, appFirestore_1.getAppFirestore)();
    const snapshot = await db.collection(collectionName).get();
    const batchSize = 400;
    for (let index = 0; index < snapshot.docs.length; index += batchSize) {
        const batch = db.batch();
        snapshot.docs.slice(index, index + batchSize).forEach((docSnapshot) => {
            batch.delete(docSnapshot.ref);
        });
        await batch.commit();
    }
};
exports.rebuildAnalytics = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const db = (0, appFirestore_1.getAppFirestore)();
    const [jobsSnapshot, outputsSnapshot] = await Promise.all([
        db.collection('jobs').get(),
        db.collectionGroup('outputs').get(),
    ]);
    const jobs = jobsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    const outputs = outputsSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
    const rebuilt = (0, aggregation_1.buildAnalyticsSnapshot)(jobs, outputs);
    await Promise.all([
        deleteCollectionDocs('analytics_daily'),
        deleteCollectionDocs('analytics_providers'),
        deleteCollectionDocs('analytics_clients'),
    ]);
    const batch = db.batch();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    batch.set(db.collection('analytics_summary').doc('global'), {
        ...rebuilt.summary,
        updatedAt: timestamp,
    });
    rebuilt.daily.forEach((daily) => {
        batch.set(db.collection('analytics_daily').doc(daily.date), {
            ...daily,
            updatedAt: timestamp,
        });
    });
    rebuilt.providers.forEach((providerStats) => {
        batch.set(db.collection('analytics_providers').doc(providerStats.provider), {
            ...providerStats,
            updatedAt: timestamp,
        });
    });
    rebuilt.clients.forEach((clientStats) => {
        batch.set(db.collection('analytics_clients').doc(clientStats.clientId), {
            ...clientStats,
            updatedAt: timestamp,
        });
    });
    await batch.commit();
    return {
        success: true,
        summary: {
            totalJobs: rebuilt.summary.totalJobs,
            totalCompletedOutputs: rebuilt.summary.totalCompletedOutputs,
            totalCostUsd: rebuilt.summary.totalCostUsd,
        },
    };
});
//# sourceMappingURL=rebuildAnalytics.js.map