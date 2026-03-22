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
exports.regenerateJobsBulk = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const regenerateJob_helpers_1 = require("./regenerateJob.helpers");
const MAX_BULK_JOBS = 50;
exports.regenerateJobsBulk = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador', 'revisor']);
    const requestedJobs = Array.isArray(request.data?.jobs) ? request.data.jobs : [];
    const normalizedJobs = requestedJobs
        .map((entry) => ({
        jobId: typeof entry?.jobId === 'string' ? entry.jobId.trim() : '',
        provider: typeof entry?.provider === 'string' ? entry.provider.trim() : '',
        prompt: typeof entry?.prompt === 'string' ? entry.prompt.trim() : '',
    }))
        .filter((entry) => entry.jobId);
    if (normalizedJobs.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar al menos un job para reencolar.');
    }
    if (normalizedJobs.length > MAX_BULK_JOBS) {
        throw new https_1.HttpsError('invalid-argument', `Solo puedes reencolar hasta ${MAX_BULK_JOBS} jobs por acción.`);
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const userSnapshot = await db.collection('users').doc(request.auth.uid).get();
    const requestedByDisplayName = userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data().displayName
        : null;
    const uniqueJobIds = Array.from(new Set(normalizedJobs.map((entry) => entry.jobId)));
    const jobRefs = uniqueJobIds.map((jobId) => db.collection('jobs').doc(jobId));
    const jobSnapshots = await db.getAll(...jobRefs);
    const jobsById = Object.fromEntries(jobSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() }]));
    const writeBatch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const skippedJobIds = [];
    let queuedJobs = 0;
    for (const entry of normalizedJobs) {
        const job = jobsById[entry.jobId];
        if (!job || job.status === 'processing') {
            skippedJobIds.push(entry.jobId);
            continue;
        }
        const provider = entry.provider || job.provider;
        const prompt = entry.prompt || (job.promptBase || job.finalPrompt || '').trim();
        if (job.experimentEnabled) {
            if (provider !== job.provider || prompt !== (job.promptBase || '').trim()) {
                skippedJobIds.push(entry.jobId);
                continue;
            }
        }
        try {
            const patch = (0, regenerateJob_helpers_1.buildRegenerateJobPatch)(job, provider, prompt);
            const jobRef = db.collection('jobs').doc(job.id);
            writeBatch.update(jobRef, {
                ...patch,
                manualRegenerationCount: admin.firestore.FieldValue.increment(1),
                'traceability.lastManualRegenerationAt': now,
                'traceability.lastManualRegeneratedByUid': request.auth.uid,
                'traceability.lastManualRegeneratedByDisplayName': requestedByDisplayName,
                updatedAt: now,
            });
            writeBatch.set(jobRef.collection('logs').doc(), {
                type: 'system',
                level: 'info',
                message: 'Regeneración masiva encolada desde la aplicación.',
                payload: {
                    requestedByUid: request.auth.uid,
                    requestedByDisplayName,
                    source: 'bulk_regeneration',
                    provider,
                    prompt,
                },
                createdAt: now,
            });
            queuedJobs += 1;
        }
        catch {
            skippedJobIds.push(entry.jobId);
        }
    }
    if (queuedJobs > 0) {
        await writeBatch.commit();
    }
    return {
        success: true,
        queuedJobs,
        skippedJobs: skippedJobIds.length,
        skippedJobIds,
    };
});
//# sourceMappingURL=regenerateJobsBulk.js.map