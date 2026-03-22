"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAnalyticsSnapshot = exports.getJobStateDelta = exports.formatMexicoCityDate = void 0;
const firestore_1 = require("firebase-admin/firestore");
const providerCosts_1 = require("../../../shared/src/constants/providerCosts");
const toDate = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof firestore_1.Timestamp) {
        return value.toDate();
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const formatMexicoCityDate = (value) => {
    const date = toDate(value) || new Date();
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(date);
};
exports.formatMexicoCityDate = formatMexicoCityDate;
const emptyStateSummary = () => ({
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    pendingJobs: 0,
    processingJobs: 0,
    successRate: 0,
    avgDurationSeconds: null,
    totalCompletedOutputs: 0,
    totalCostUsd: 0,
    projectedMonthlyCostUsd: null,
    updatedAt: new Date(),
});
const increment = (target, key, delta) => {
    target[key] = (target[key] || 0) + delta;
};
const applyJobStatus = (target, status, delta) => {
    if (status === 'completed') {
        increment(target, 'completedJobs', delta);
        return;
    }
    if (status === 'failed') {
        increment(target, 'failedJobs', delta);
        return;
    }
    if (status === 'processing') {
        increment(target, 'processingJobs', delta);
        return;
    }
    increment(target, 'pendingJobs', delta);
};
const getJobStateDelta = (before, after) => {
    const summary = {};
    const providerFailed = {};
    const dailyFailed = [];
    if (!before && after) {
        increment(summary, 'totalJobs', 1);
        applyJobStatus(summary, after.status, 1);
        if (after.status === 'failed') {
            providerFailed[after.provider] = (providerFailed[after.provider] || 0) + 1;
            dailyFailed.push({ date: (0, exports.formatMexicoCityDate)(after.updatedAt), delta: 1 });
        }
        return { summary, providerFailed, dailyFailed };
    }
    if (before && !after) {
        increment(summary, 'totalJobs', -1);
        applyJobStatus(summary, before.status, -1);
        if (before.status === 'failed') {
            providerFailed[before.provider] = (providerFailed[before.provider] || 0) - 1;
            dailyFailed.push({ date: (0, exports.formatMexicoCityDate)(before.updatedAt), delta: -1 });
        }
        return { summary, providerFailed, dailyFailed };
    }
    if (!before || !after) {
        return { summary, providerFailed, dailyFailed };
    }
    if (before.status !== after.status) {
        applyJobStatus(summary, before.status, -1);
        applyJobStatus(summary, after.status, 1);
    }
    if (before.status === 'failed') {
        providerFailed[before.provider] = (providerFailed[before.provider] || 0) - 1;
        dailyFailed.push({ date: (0, exports.formatMexicoCityDate)(before.updatedAt), delta: -1 });
    }
    if (after.status === 'failed') {
        providerFailed[after.provider] = (providerFailed[after.provider] || 0) + 1;
        dailyFailed.push({ date: (0, exports.formatMexicoCityDate)(after.updatedAt), delta: 1 });
    }
    return { summary, providerFailed, dailyFailed };
};
exports.getJobStateDelta = getJobStateDelta;
const buildAnalyticsSnapshot = (jobs, outputs) => {
    const summary = emptyStateSummary();
    const dailyMap = new Map();
    const providerMap = new Map();
    const clientMap = new Map();
    const clientProviderMap = new Map();
    jobs.forEach((job) => {
        summary.totalJobs += 1;
        if (job.status === 'completed') {
            summary.completedJobs += 1;
        }
        else if (job.status === 'failed') {
            summary.failedJobs += 1;
            const date = (0, exports.formatMexicoCityDate)(job.updatedAt);
            const currentDaily = dailyMap.get(date) || {
                date,
                completed: 0,
                failed: 0,
                costUsd: 0,
                updatedAt: new Date(),
            };
            currentDaily.failed += 1;
            dailyMap.set(date, currentDaily);
            const providerStats = providerMap.get(job.provider) || {
                provider: job.provider,
                completed: 0,
                failed: 0,
                avgDurationSeconds: null,
                costPerImageUsd: providerCosts_1.PROVIDER_COSTS[job.provider],
                totalCostUsd: 0,
                updatedAt: new Date(),
            };
            providerStats.failed += 1;
            providerMap.set(job.provider, providerStats);
        }
        else if (job.status === 'processing') {
            summary.processingJobs += 1;
        }
        else {
            summary.pendingJobs += 1;
        }
    });
    outputs.forEach((output) => {
        summary.totalCompletedOutputs += 1;
        summary.totalCostUsd += output.costUsd || 0;
        summary.avgDurationSeconds = null;
        const providerStats = providerMap.get(output.provider) || {
            provider: output.provider,
            completed: 0,
            failed: 0,
            avgDurationSeconds: null,
            costPerImageUsd: providerCosts_1.PROVIDER_COSTS[output.provider],
            totalCostUsd: 0,
            updatedAt: new Date(),
        };
        providerStats.completed += 1;
        providerStats.totalCostUsd += output.costUsd || 0;
        providerStats.updatedAt = new Date();
        providerMap.set(output.provider, providerStats);
        const clientStats = clientMap.get(output.clientId) || {
            clientId: output.clientId,
            clientNameSnapshot: output.clientNameSnapshot,
            completed: 0,
            totalCostUsd: 0,
            updatedAt: new Date(),
        };
        clientStats.completed += 1;
        clientStats.totalCostUsd += output.costUsd || 0;
        clientStats.updatedAt = new Date();
        clientMap.set(output.clientId, clientStats);
        const clientProviderKey = `${output.clientId}__${output.provider}`;
        const clientProviderStats = clientProviderMap.get(clientProviderKey) || {
            id: clientProviderKey,
            clientId: output.clientId,
            clientNameSnapshot: output.clientNameSnapshot,
            provider: output.provider,
            completed: 0,
            totalCostUsd: 0,
            updatedAt: new Date(),
        };
        clientProviderStats.completed += 1;
        clientProviderStats.totalCostUsd += output.costUsd || 0;
        clientProviderStats.updatedAt = new Date();
        clientProviderMap.set(clientProviderKey, clientProviderStats);
        const date = (0, exports.formatMexicoCityDate)(output.createdAt);
        const daily = dailyMap.get(date) || {
            date,
            completed: 0,
            failed: 0,
            costUsd: 0,
            updatedAt: new Date(),
        };
        daily.completed += 1;
        daily.costUsd += output.costUsd || 0;
        daily.updatedAt = new Date();
        dailyMap.set(date, daily);
    });
    const totalDuration = outputs.reduce((sum, output) => sum + (output.durationSeconds || 0), 0);
    summary.successRate =
        summary.completedJobs + summary.failedJobs > 0
            ? Math.round((summary.completedJobs / (summary.completedJobs + summary.failedJobs)) * 100)
            : 0;
    summary.avgDurationSeconds =
        summary.totalCompletedOutputs > 0 ? Math.round(totalDuration / summary.totalCompletedOutputs) : null;
    summary.updatedAt = new Date();
    const providers = Array.from(providerMap.values()).map((providerStats) => {
        const providerOutputs = outputs.filter((output) => output.provider === providerStats.provider);
        const durationTotal = providerOutputs.reduce((sum, output) => sum + (output.durationSeconds || 0), 0);
        const completed = providerStats.completed;
        return {
            ...providerStats,
            avgDurationSeconds: completed > 0 ? Math.round(durationTotal / completed) : null,
            costPerImageUsd: completed > 0 ? Number((providerStats.totalCostUsd / completed).toFixed(4)) : providerCosts_1.PROVIDER_COSTS[providerStats.provider],
            totalCostUsd: Number(providerStats.totalCostUsd.toFixed(4)),
            updatedAt: new Date(),
        };
    });
    const clients = Array.from(clientMap.values())
        .sort((left, right) => right.completed - left.completed)
        .slice(0, 10)
        .map((client) => ({
        ...client,
        totalCostUsd: Number(client.totalCostUsd.toFixed(4)),
        updatedAt: new Date(),
    }));
    const clientProviders = Array.from(clientProviderMap.values())
        .sort((left, right) => right.totalCostUsd - left.totalCostUsd)
        .map((entry) => ({
        ...entry,
        totalCostUsd: Number(entry.totalCostUsd.toFixed(4)),
        updatedAt: new Date(),
    }));
    const daily = Array.from(dailyMap.values())
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((entry) => ({
        ...entry,
        costUsd: Number(entry.costUsd.toFixed(4)),
        updatedAt: new Date(),
    }));
    return {
        summary: {
            ...summary,
            totalCostUsd: Number(summary.totalCostUsd.toFixed(4)),
        },
        daily,
        providers,
        clients,
        clientProviders,
    };
};
exports.buildAnalyticsSnapshot = buildAnalyticsSnapshot;
//# sourceMappingURL=aggregation.js.map