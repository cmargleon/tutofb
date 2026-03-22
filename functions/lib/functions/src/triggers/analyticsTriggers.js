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
exports.onJobOutputAnalyticsDelete = exports.onJobOutputAnalyticsCreate = exports.onJobAnalyticsUpdate = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const aggregation_1 = require("../analytics/aggregation");
const appFirestore_1 = require("../firebase/appFirestore");
const db = (0, appFirestore_1.getAppFirestore)();
const getClientProviderDocId = (clientId, provider) => `${clientId}__${provider}`;
const updateDailyDoc = (batch, date, updates) => {
    const ref = db.collection('analytics_daily').doc(date);
    const payload = {
        date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (updates.completed) {
        payload.completed = admin.firestore.FieldValue.increment(updates.completed);
    }
    if (updates.failed) {
        payload.failed = admin.firestore.FieldValue.increment(updates.failed);
    }
    if (updates.costUsd) {
        payload.costUsd = admin.firestore.FieldValue.increment(updates.costUsd);
    }
    batch.set(ref, payload, { merge: true });
};
exports.onJobAnalyticsUpdate = (0, firestore_1.onDocumentWritten)('jobs/{jobId}', async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const delta = (0, aggregation_1.getJobStateDelta)(before, after);
    const hasSummaryChanges = Object.values(delta.summary).some((value) => (value || 0) !== 0);
    const hasProviderChanges = Object.values(delta.providerFailed).some((value) => (value || 0) !== 0);
    const hasDailyChanges = delta.dailyFailed.some((entry) => entry.delta !== 0);
    if (!hasSummaryChanges && !hasProviderChanges && !hasDailyChanges) {
        return;
    }
    const batch = db.batch();
    batch.set(db.collection('analytics_summary').doc('global'), {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(delta.summary.totalJobs ? { totalJobs: admin.firestore.FieldValue.increment(delta.summary.totalJobs) } : {}),
        ...(delta.summary.completedJobs
            ? { completedJobs: admin.firestore.FieldValue.increment(delta.summary.completedJobs) }
            : {}),
        ...(delta.summary.failedJobs ? { failedJobs: admin.firestore.FieldValue.increment(delta.summary.failedJobs) } : {}),
        ...(delta.summary.pendingJobs ? { pendingJobs: admin.firestore.FieldValue.increment(delta.summary.pendingJobs) } : {}),
        ...(delta.summary.processingJobs
            ? { processingJobs: admin.firestore.FieldValue.increment(delta.summary.processingJobs) }
            : {}),
    }, { merge: true });
    Object.entries(delta.providerFailed).forEach(([provider, failedDelta]) => {
        if (!failedDelta) {
            return;
        }
        batch.set(db.collection('analytics_providers').doc(provider), {
            provider,
            failed: admin.firestore.FieldValue.increment(failedDelta),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
    delta.dailyFailed.forEach((entry) => {
        if (!entry.delta) {
            return;
        }
        updateDailyDoc(batch, entry.date, { failed: entry.delta });
    });
    await batch.commit();
});
exports.onJobOutputAnalyticsCreate = (0, firestore_1.onDocumentCreated)('jobs/{jobId}/outputs/{outputId}', async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const output = snapshot.data();
    const batch = db.batch();
    const date = output.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(output.createdAt.toDate()) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const durationSeconds = output.durationSeconds || 0;
    batch.set(db.collection('analytics_summary').doc('global'), {
        totalCompletedOutputs: admin.firestore.FieldValue.increment(1),
        totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
        totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    updateDailyDoc(batch, date, {
        completed: 1,
        costUsd: output.costUsd || 0,
    });
    batch.set(db.collection('analytics_providers').doc(output.provider), {
        provider: output.provider,
        completed: admin.firestore.FieldValue.increment(1),
        totalCompletedOutputs: admin.firestore.FieldValue.increment(1),
        totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
        totalDurationSeconds: admin.firestore.FieldValue.increment(durationSeconds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('analytics_clients').doc(output.clientId), {
        clientId: output.clientId,
        clientNameSnapshot: output.clientNameSnapshot,
        completed: admin.firestore.FieldValue.increment(1),
        totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('analytics_client_providers').doc(getClientProviderDocId(output.clientId, output.provider)), {
        clientId: output.clientId,
        clientNameSnapshot: output.clientNameSnapshot,
        provider: output.provider,
        completed: admin.firestore.FieldValue.increment(1),
        totalCostUsd: admin.firestore.FieldValue.increment(output.costUsd || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
});
exports.onJobOutputAnalyticsDelete = (0, firestore_1.onDocumentDeleted)('jobs/{jobId}/outputs/{outputId}', async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const output = snapshot.data();
    const batch = db.batch();
    const date = output.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(output.createdAt.toDate()) : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const durationSeconds = output.durationSeconds || 0;
    batch.set(db.collection('analytics_summary').doc('global'), {
        totalCompletedOutputs: admin.firestore.FieldValue.increment(-1),
        totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
        totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    updateDailyDoc(batch, date, {
        completed: -1,
        costUsd: -(output.costUsd || 0),
    });
    batch.set(db.collection('analytics_providers').doc(output.provider), {
        provider: output.provider,
        completed: admin.firestore.FieldValue.increment(-1),
        totalCompletedOutputs: admin.firestore.FieldValue.increment(-1),
        totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
        totalDurationSeconds: admin.firestore.FieldValue.increment(-durationSeconds),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('analytics_clients').doc(output.clientId), {
        clientId: output.clientId,
        clientNameSnapshot: output.clientNameSnapshot,
        completed: admin.firestore.FieldValue.increment(-1),
        totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('analytics_client_providers').doc(getClientProviderDocId(output.clientId, output.provider)), {
        clientId: output.clientId,
        clientNameSnapshot: output.clientNameSnapshot,
        provider: output.provider,
        completed: admin.firestore.FieldValue.increment(-1),
        totalCostUsd: admin.firestore.FieldValue.increment(-(output.costUsd || 0)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
});
//# sourceMappingURL=analyticsTriggers.js.map