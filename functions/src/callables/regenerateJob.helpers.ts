import { buildFinalGenerationPrompt, isProvider } from '../../../shared/src/domain';
import { Job } from '../../../shared/src/types';

export const buildRegenerateJobPatch = (job: Job, provider: string, prompt: string) => {
  if (!isProvider(provider)) {
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
    promptCaseKey: job.promptCaseKey ?? null,
    promptCaseText: job.promptCaseText ?? null,
    finalPrompt: buildFinalGenerationPrompt(
      trimmedPrompt,
      job.garmentReferenceImageType || (job.garmentIsMultiAngle ? 'multi_angle_composite' : 'single_view'),
      job.promptCaseText,
    ),
    status: 'pending' as const,
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
