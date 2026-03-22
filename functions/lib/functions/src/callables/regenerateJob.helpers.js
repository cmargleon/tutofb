"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRegenerateJobPatch = void 0;
const domain_1 = require("../../../shared/src/domain");
const buildRegenerateJobPatch = (job, provider, prompt) => {
    if (!(0, domain_1.isProvider)(provider)) {
        throw new Error('Proveedor inválido.');
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
        throw new Error('El prompt no puede quedar vacío para regenerar.');
    }
    return {
        provider,
        requestedPromptBase: trimmedPrompt,
        promptBase: trimmedPrompt,
        finalPrompt: (0, domain_1.buildFinalGenerationPrompt)(trimmedPrompt, job.backgroundConfig, job.garmentIsMultiAngle),
        status: 'pending',
        queuePriority: 1,
        retryCount: 0,
        generationAttemptCount: 0,
        autoReviewMaxAttempts: job.autoReviewMaxAttempts || 3,
        latestAutoReview: null,
        claimToken: null,
        claimedBy: null,
        claimExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        lastAttemptStartedAt: null,
        lastError: null,
    };
};
exports.buildRegenerateJobPatch = buildRegenerateJobPatch;
//# sourceMappingURL=regenerateJob.helpers.js.map