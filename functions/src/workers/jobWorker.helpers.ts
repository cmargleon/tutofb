import { photoPromptConflicts } from '../../../shared/src/modelPhotoSets';
import { APPROVED_TRY_ON_PROMPT_FORMAT } from '../../../shared/src/approvedTryOnPrompt';
import { buildFinalGenerationPrompt } from '../../../shared/src/domain';
import { PRODUCT_IDENTITY_RULES } from '../automation/presets';
import { Job } from '../../../shared/src/types';

export const shouldBackstopPendingJob = (job: Pick<Job, 'status' | 'retryNotBefore' | 'claimToken' | 'automationManaged' | 'automationGate'>): boolean => {
  if (job.status !== 'pending' || (job.automationManaged && job.automationGate)) {
    return false;
  }

  if (job.claimToken) {
    return false;
  }

  return !job.retryNotBefore;
};

// Use Gemini's correction for the next attempt while retaining the original requested prompt.
export const buildAutomaticRetryPromptPatch = (job: Job, nextPromptBase?: string): Partial<Job> => {
  if (job.imageEdit) return {};
  if (job.photoTask?.aspectRatio) {
    if (!nextPromptBase?.trim() || photoPromptConflicts(nextPromptBase).length || nextPromptBase.length > 2000) return {};
    const correction = nextPromptBase.replace(job.photoTask.instructions, '').trim();
    return { promptBase: correction || job.photoTask.instructions, finalPrompt: `${job.photoTask.instructions}${correction ? `\nCorrection: ${correction}` : ''}` };
  }
  if (job.photoTask) return nextPromptBase?.trim() && !photoPromptConflicts(nextPromptBase).length && nextPromptBase.length <= 2000 ? { promptBase: nextPromptBase, finalPrompt: `${job.requestedPromptBase || job.promptBase}\nCorrección: ${nextPromptBase}\nObligaciones invariables del plan:\n${job.photoTask.instructions}` } : {};
  const promptBase = job.automationManaged ? nextPromptBase : nextPromptBase?.trim();
  if (job.automationManaged && promptBase?.trim()) return { promptBase, finalPrompt: promptBase };
  if (!promptBase) return {};
  return {
    promptBase,
    finalPrompt: job.generationKind === 'product'
      ? `${PRODUCT_IDENTITY_RULES}\n${job.requestedPromptBase || job.promptBase}\nCorrection: ${promptBase}`
      : job.promptFormat === APPROVED_TRY_ON_PROMPT_FORMAT ? promptBase : buildFinalGenerationPrompt(promptBase,
        job.garmentReferenceImageType || (job.garmentIsMultiAngle ? 'multi_angle_composite' : 'single_view'),
        job.promptCaseText, job.modelIdentityTraitsSnapshot || null),
  };
};

export const extensionForContentType = (contentType: string): string => {
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
};

export const mimeTypeFromStoragePath = (storagePath: string): string => {
  const normalized = storagePath.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  return 'image/png';
};
