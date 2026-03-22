"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchArchive = void 0;
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const clamp = (value, min, max, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(parsed)));
};
const asTrimmedString = (value) => typeof value === 'string' ? value.trim() : '';
const asOptionalTrimmedString = (value) => {
    const trimmed = asTrimmedString(value);
    return trimmed ? trimmed : null;
};
const toMillis = (value) => {
    if (!value) {
        return 0;
    }
    if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate().getTime();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};
const matchesText = (value, queryText) => !queryText || (value || '').toLocaleLowerCase().includes(queryText);
exports.searchArchive = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'operador', 'revisor']);
    const db = (0, appFirestore_1.getAppFirestore)();
    const clientId = asTrimmedString(request.data?.clientId);
    const provider = asTrimmedString(request.data?.provider);
    const batchStatus = asTrimmedString(request.data?.batchStatus);
    const jobStatus = asTrimmedString(request.data?.jobStatus);
    const modelQuery = asTrimmedString(request.data?.modelQuery).toLocaleLowerCase();
    const garmentQuery = asTrimmedString(request.data?.garmentQuery).toLocaleLowerCase();
    const limit = clamp(request.data?.limit, 1, 40, 20);
    const scanLimit = clamp(request.data?.scanLimit, limit, 160, Math.max(limit * 4, 80));
    let batchesQuery = db.collection('batches').orderBy('createdAt', 'desc').limit(scanLimit);
    const dateFrom = asTrimmedString(request.data?.dateFrom);
    const dateTo = asTrimmedString(request.data?.dateTo);
    if (dateFrom) {
        const fromDate = new Date(`${dateFrom}T00:00:00`);
        if (Number.isNaN(fromDate.getTime())) {
            throw new https_1.HttpsError('invalid-argument', 'La fecha inicial no es válida.');
        }
        batchesQuery = batchesQuery.where('createdAt', '>=', fromDate);
    }
    if (dateTo) {
        const toDate = new Date(`${dateTo}T23:59:59`);
        if (Number.isNaN(toDate.getTime())) {
            throw new https_1.HttpsError('invalid-argument', 'La fecha final no es válida.');
        }
        batchesQuery = batchesQuery.where('createdAt', '<=', toDate);
    }
    const batchesSnapshot = await batchesQuery.get();
    const scannedBatches = batchesSnapshot.size;
    const candidateBatches = batchesSnapshot.docs
        .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((batch) => {
        if (clientId && batch.clientId !== clientId) {
            return false;
        }
        if (provider && batch.provider !== provider) {
            return false;
        }
        if (batchStatus && batch.status !== batchStatus) {
            return false;
        }
        if (!matchesText(batch.modelNameSnapshot, modelQuery)) {
            return false;
        }
        return true;
    });
    const results = [];
    for (const batch of candidateBatches) {
        if (results.length >= limit) {
            break;
        }
        const jobsSnapshot = await db.collection('jobs').where('batchId', '==', batch.id).get();
        const matchedJobs = jobsSnapshot.docs
            .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
            .filter((job) => {
            if (jobStatus && job.status !== jobStatus) {
                return false;
            }
            if (provider && job.provider !== provider) {
                return false;
            }
            if (!matchesText(job.garmentName, garmentQuery)) {
                return false;
            }
            return true;
        });
        if (matchedJobs.length === 0) {
            continue;
        }
        results.push({
            batch,
            matchedJobCount: matchedJobs.length,
            matchedJobIds: matchedJobs.map((job) => job.id).filter(Boolean),
            matchedGarments: Array.from(new Set(matchedJobs
                .map((job) => asOptionalTrimmedString(job.garmentName))
                .filter((garmentName) => Boolean(garmentName)))).sort((left, right) => left.localeCompare(right)),
            latestMatchedAt: matchedJobs.reduce((latest, job) => {
                const current = job.updatedAt || job.createdAt;
                return toMillis(current) > toMillis(latest) ? current : latest;
            }, batch.updatedAt || batch.createdAt),
        });
    }
    return {
        success: true,
        results,
        scannedBatches,
        truncated: candidateBatches.length > results.length || scannedBatches >= scanLimit,
    };
});
//# sourceMappingURL=searchArchive.js.map