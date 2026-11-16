import { randomUUID } from 'node:crypto';
import { AutomationBudgetError, pauseAutomationGeneration } from '../automation/budget';
import { getJobAutoReviewMaxAttempts, getJobTimeoutMs } from '../config/runtime';
import { withManglarJobBudget } from '../manglar/budget';
import { validatePlannedPhotoReview } from '../media/photoPlanFile';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { Job, Provider } from '../../../shared/src/types';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { claimJob, createLog, isClaimStillActive } from './jobWorker.claims';
import {
  isReviewResume,
  logProviderStepStart,
  nextGenerationAttempt,
  obtainProviderResultWithinBudget,
  preparePlannedPhoto,
  signInputImages,
} from './jobWorker.generation';
import { retryOrFailJob } from './jobWorker.persistence';
import { requeueExpiredJobs } from './jobWorker.requeue';
import { AttemptContext, persistReviewOutcome, reviewGeneratedAttempt } from './jobWorker.review';

// Job processing pipeline: claim -> provider -> Gemini review -> persist. The pieces live in the
// neighbouring jobWorker.*.ts modules; requeueExpiredJobs is re-exported to keep the public surface.
export { requeueExpiredJobs } from './jobWorker.requeue';

const logClaim = (jobId: string, workerId: string, claimedJob: Job, source: 'create' | 'requeue') =>
  createLog(jobId, {
    type: 'claim',
    level: 'info',
    message: 'Trabajo reclamado por el worker.',
    payload: {
      workerId,
      claimToken: claimedJob.claimToken,
      source,
    },
  });

const measureAttemptDurationSeconds = (job: Job): number => {
  const startedAtMs = toMillis(job.lastAttemptStartedAt) || Date.now();
  return Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
};

/** Budget exhaustion pauses automation jobs; every other error goes through the provider retry policy. */
const handleProcessingError = async (claimedJob: Job, error: unknown): Promise<void> => {
  if (error instanceof AutomationBudgetError && claimedJob.automationManaged) {
    await pauseAutomationGeneration(claimedJob, error.message);
    return;
  }
  await retryOrFailJob(claimedJob, error);
};

const processJobCore = async (
  jobId: string,
  source: 'create' | 'requeue',
  options?: { skipBacklogSweep?: boolean },
): Promise<void> => {
  if (!options?.skipBacklogSweep) {
    await requeueExpiredJobs();
  }

  // 1. Claim
  const workerId = `worker:${source}:${randomUUID()}`;
  const claimedJob = await claimJob(jobId, workerId);
  if (!claimedJob) {
    return;
  }
  await logClaim(jobId, workerId, claimedJob, source);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), getJobTimeoutMs());

  try {
    // 2. Provider (or existing output / reused reference)
    const imageConfig = normalizeProviderImageConfig(
      claimedJob.provider as Provider,
      claimedJob.imageConfig,
      claimedJob.aspectRatio,
    );
    const inputUrls = await signInputImages(claimedJob);
    await logProviderStepStart(jobId, claimedJob, imageConfig);
    const providerResult = await obtainProviderResultWithinBudget({
      job: claimedJob,
      jobId,
      imageConfig,
      inputUrls,
      signal: controller.signal,
    });

    if (!(await isClaimStillActive(jobId, claimedJob.claimToken))) {
      return;
    }

    const attempt: AttemptContext = {
      claimedJob,
      jobId,
      providerResult,
      durationSeconds: measureAttemptDurationSeconds(claimedJob),
      generationAttempt: nextGenerationAttempt(claimedJob),
      maxAutoReviewAttempts: claimedJob.autoReviewMaxAttempts || getJobAutoReviewMaxAttempts(),
    };

    if (claimedJob.photoTask && !isReviewResume(claimedJob)) {
      await preparePlannedPhoto(claimedJob, providerResult, imageConfig);
    }

    // 3. Gemini review (a failed review has already been persisted)
    const review = await reviewGeneratedAttempt(attempt, controller.signal);
    if (!review) {
      return;
    }
    if (claimedJob.photoTask) {
      await validatePlannedPhotoReview(providerResult.imageBytes, claimedJob.photoTask, review);
    }

    // 4. Persistence according to the verdict
    await persistReviewOutcome(attempt, review);
  } catch (error) {
    await handleProcessingError(claimedJob, error);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const processJob: typeof processJobCore = (jobId, source, options) =>
  withManglarJobBudget(jobId, () => processJobCore(jobId, source, options));
