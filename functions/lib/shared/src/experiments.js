"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeBatchExperimentAnalytics = exports.buildExperimentArms = exports.isExperimentEligibleProvider = exports.isExperimentMode = exports.EXPERIMENT_EXCLUDED_PROVIDERS = exports.EXPERIMENT_ALLOWED_PROVIDERS = exports.EXPERIMENT_MODE_VALUES = void 0;
exports.EXPERIMENT_MODE_VALUES = ['ab_paired', 'ab_interleaved'];
exports.EXPERIMENT_ALLOWED_PROVIDERS = ['fal-seedream', 'openai-gpt-image-1.5'];
exports.EXPERIMENT_EXCLUDED_PROVIDERS = ['fal-banana-pro'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const isExperimentMode = (value) => exports.EXPERIMENT_MODE_VALUES.includes(value);
exports.isExperimentMode = isExperimentMode;
const isExperimentEligibleProvider = (value) => exports.EXPERIMENT_ALLOWED_PROVIDERS.includes(value);
exports.isExperimentEligibleProvider = isExperimentEligibleProvider;
const buildExperimentArms = (providers) => providers.map((provider, index) => ({
    id: `arm_${index + 1}`,
    provider,
    label: ALPHABET[index] || `Arm ${index + 1}`,
}));
exports.buildExperimentArms = buildExperimentArms;
const round = (value, digits = 2) => Number(value.toFixed(digits));
const computeBatchExperimentAnalytics = (batch, jobs) => {
    if (!batch?.experimentEnabled || !batch.id || !batch.experimentId || !batch.experimentMode || !batch.experimentArms?.length) {
        return null;
    }
    const experimentJobs = jobs.filter((job) => job.experimentEnabled && job.experimentId === batch.experimentId);
    if (experimentJobs.length === 0) {
        return null;
    }
    const comparableGroups = new Set(experimentJobs
        .map((job) => job.experimentComparisonKey)
        .filter((value) => typeof value === 'string' && value.length > 0)).size;
    const rawArms = batch.experimentArms.map((arm) => {
        const armJobs = experimentJobs.filter((job) => job.experimentArmId === arm.id);
        const totalJobs = armJobs.length;
        const completedJobs = armJobs.filter((job) => job.status === 'completed').length;
        const failedJobs = armJobs.filter((job) => job.status === 'failed').length;
        const pendingJobs = armJobs.filter((job) => job.status === 'pending').length;
        const processingJobs = armJobs.filter((job) => job.status === 'processing').length;
        const manualRegenerationCount = armJobs.reduce((sum, job) => sum + (job.manualRegenerationCount || 0), 0);
        const regeneratedJobs = armJobs.filter((job) => (job.manualRegenerationCount || 0) > 0).length;
        const totalCostUsd = armJobs.reduce((sum, job) => sum + (job.totalCostUsd || 0), 0);
        const totalDurationSeconds = armJobs.reduce((sum, job) => sum + (job.totalDurationSeconds || 0), 0);
        return {
            armId: arm.id,
            label: arm.label,
            provider: arm.provider,
            totalJobs,
            completedJobs,
            failedJobs,
            pendingJobs,
            processingJobs,
            manualRegenerationCount,
            regeneratedJobs,
            regenerationRatePct: totalJobs > 0 ? round((manualRegenerationCount / totalJobs) * 100, 1) : 0,
            totalCostUsd: round(totalCostUsd, 4),
            avgCostPerJobUsd: totalJobs > 0 ? round(totalCostUsd / totalJobs, 4) : 0,
            avgCostPerCompletedJobUsd: completedJobs > 0 ? round(totalCostUsd / completedJobs, 4) : round(totalCostUsd, 4),
            totalDurationSeconds,
            avgDurationPerJobSeconds: totalJobs > 0 ? round(totalDurationSeconds / totalJobs, 1) : 0,
            efficiencyScore: 0,
        };
    });
    const minCost = Math.max(0.0001, Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.avgCostPerCompletedJobUsd || arm.avgCostPerJobUsd || 0.0001))));
    const minDuration = Math.max(0.0001, Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.avgDurationPerJobSeconds || 0.0001))));
    const minRegeneration = Math.max(0.0001, Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.regenerationRatePct || 0.0001))));
    const arms = rawArms.map((arm) => {
        const costRatio = (arm.avgCostPerCompletedJobUsd || arm.avgCostPerJobUsd || minCost) / minCost;
        const durationRatio = (arm.avgDurationPerJobSeconds || minDuration) / minDuration;
        const regenerationRatio = (Math.max(0.0001, arm.regenerationRatePct || 0.0001)) / minRegeneration;
        return {
            ...arm,
            efficiencyScore: round(costRatio * 0.4 + durationRatio * 0.35 + regenerationRatio * 0.25, 3),
        };
    });
    const winner = [...arms].sort((left, right) => left.efficiencyScore - right.efficiencyScore)[0] || null;
    const recommendation = winner
        ? `${winner.label} (${winner.provider}) muestra mejor balance entre costo, tiempo total y necesidad de regeneraciones.`
        : 'Todavía no hay datos suficientes para recomendar un brazo del experimento.';
    return {
        batchId: batch.id,
        experimentId: batch.experimentId,
        mode: batch.experimentMode,
        totalJobs: experimentJobs.length,
        comparableGroups,
        arms,
        winningArmId: winner?.armId || null,
        winningProvider: winner?.provider || null,
        recommendation,
    };
};
exports.computeBatchExperimentAnalytics = computeBatchExperimentAnalytics;
//# sourceMappingURL=experiments.js.map