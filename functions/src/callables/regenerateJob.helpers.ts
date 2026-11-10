import { resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { getManglarContext } from '../manglar/context';
import { APPROVED_TRY_ON_PROMPT_FORMAT, validateApprovedTryOnPrompt } from '../../../shared/src/approvedTryOnPrompt';
import { buildFinalGenerationPrompt, isProvider } from '../../../shared/src/domain';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { PRODUCT_IDENTITY_RULES } from '../automation/presets';
import { Job } from '../../../shared/src/types';

export const buildRegenerateJobPatch = (job: Job, provider: string, prompt: string, manualMaxRetries = 3) => {
  if (!isProvider(provider)) {
    throw new Error('Proveedor inválido.');
  }

  const isApprovedPrompt = job.generationKind !== 'product' && job.promptFormat === APPROVED_TRY_ON_PROMPT_FORMAT;
  const trimmedPrompt = isApprovedPrompt ? validateApprovedTryOnPrompt(prompt) : prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('El prompt no puede quedar vacío para regenerar.');
  }

  const { imageConfig, aspectRatio } = (job.photoProfile ? resolveCommercialPhotoConfig : normalizeProviderImageConfig)(provider, job.imageConfig, job.aspectRatio);

  return {
    ...(getManglarContext()?.budgetId ? { manglarBudgetId: getManglarContext()!.budgetId } : {}),
    ...(job.automationJobId ? { automationManaged: false, automationReviewPending: false, automationGate: null, autoReviewMaxAttempts: 3, maxRetries: manualMaxRetries } : {}),
    provider,
    imageConfig,
    aspectRatio,
    requestedPromptBase: trimmedPrompt,
    promptBase: trimmedPrompt,
    promptCaseKey: job.promptCaseKey ?? null,
    promptCaseText: job.promptCaseText ?? null,
    finalPrompt: isApprovedPrompt ? trimmedPrompt : job.generationKind === 'product' ? `${PRODUCT_IDENTITY_RULES}\n${trimmedPrompt}` : buildFinalGenerationPrompt(
      trimmedPrompt,
      job.garmentReferenceImageType || (job.garmentIsMultiAngle ? 'multi_angle_composite' : 'single_view'),
      job.promptCaseText,
      job.modelIdentityTraitsSnapshot || null,
    ),
    status: 'pending' as const,
    queuePriority: 1,
    retryCount: 0,
    generationAttemptCount: 0,
    autoReviewMaxAttempts: job.automationJobId ? 3 : job.autoReviewMaxAttempts || 3,
    latestAutoReview: null,
    claimToken: null,
    claimedBy: null,
    claimExpiresAt: null,
    timeoutAt: null,
    startedAt: null,
    lastAttemptStartedAt: null,
    lastError: null,
    failureInfo: null,
  };
};
