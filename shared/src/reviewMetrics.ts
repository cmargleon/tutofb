import { Job, JobAutoReviewVerdict, JobReviewSignals } from './types';

export interface JobReviewOutcomeCounts {
  jobsWithHumanIntervention: number;
  humanInterventionCount: number;
  manualSelectionCount: number;
  geminiApprovedJobs: number;
  geminiRejectedJobs: number;
  geminiTruePositiveJobs: number;
  geminiTrueNegativeJobs: number;
  geminiFalsePositiveJobs: number;
  geminiFalseNegativeJobs: number;
  humanReviewAvoidedJobs: number;
}

export const EMPTY_JOB_REVIEW_SIGNALS: JobReviewSignals = {
  firstAutoReviewVerdict: null,
  latestAutoReviewVerdict: null,
  hasHumanIntervention: false,
  humanInterventionCount: 0,
  manualSelectionCount: 0,
  hasGeminiFalsePositive: false,
  hasGeminiFalseNegative: false,
  lastHumanDecision: null,
  lastHumanDecisionAt: null,
  lastHumanDecisionByUid: null,
  lastHumanDecisionByDisplayName: null,
  lastSelectedOutputId: null,
  lastSelectedOutputVerdict: null,
};

const normalizeVerdict = (value: unknown): JobAutoReviewVerdict | null =>
  value === 'approved' || value === 'rejected' ? value : null;

export const getJobReviewSignals = (
  job: Pick<Job, 'reviewSignals' | 'latestAutoReview'> | null | undefined,
): JobReviewSignals => {
  const raw = job?.reviewSignals;
  return {
    ...EMPTY_JOB_REVIEW_SIGNALS,
    ...raw,
    firstAutoReviewVerdict: normalizeVerdict(raw?.firstAutoReviewVerdict),
    latestAutoReviewVerdict:
      normalizeVerdict(raw?.latestAutoReviewVerdict) || normalizeVerdict(job?.latestAutoReview?.verdict),
    humanInterventionCount:
      typeof raw?.humanInterventionCount === 'number' && Number.isFinite(raw.humanInterventionCount)
        ? Math.max(0, Math.trunc(raw.humanInterventionCount))
        : 0,
    manualSelectionCount:
      typeof raw?.manualSelectionCount === 'number' && Number.isFinite(raw.manualSelectionCount)
        ? Math.max(0, Math.trunc(raw.manualSelectionCount))
        : 0,
    hasHumanIntervention: raw?.hasHumanIntervention === true,
    hasGeminiFalsePositive: raw?.hasGeminiFalsePositive === true,
    hasGeminiFalseNegative: raw?.hasGeminiFalseNegative === true,
  };
};

export const getJobReviewOutcomeCounts = (job: Job | undefined): JobReviewOutcomeCounts => {
  if (!job) {
    return {
      jobsWithHumanIntervention: 0,
      humanInterventionCount: 0,
      manualSelectionCount: 0,
      geminiApprovedJobs: 0,
      geminiRejectedJobs: 0,
      geminiTruePositiveJobs: 0,
      geminiTrueNegativeJobs: 0,
      geminiFalsePositiveJobs: 0,
      geminiFalseNegativeJobs: 0,
      humanReviewAvoidedJobs: 0,
    };
  }

  const signals = getJobReviewSignals(job);
  const firstVerdict = signals.firstAutoReviewVerdict;
  const latestVerdict = signals.latestAutoReviewVerdict;
  const effectiveApprovedVerdict = firstVerdict === 'approved' || latestVerdict === 'approved';
  const effectiveRejectedVerdict = firstVerdict === 'rejected' || latestVerdict === 'rejected';

  return {
    jobsWithHumanIntervention: signals.hasHumanIntervention ? 1 : 0,
    humanInterventionCount: signals.humanInterventionCount,
    manualSelectionCount: signals.manualSelectionCount,
    geminiApprovedJobs: effectiveApprovedVerdict ? 1 : 0,
    geminiRejectedJobs: effectiveRejectedVerdict ? 1 : 0,
    geminiTruePositiveJobs:
      effectiveApprovedVerdict && !signals.hasGeminiFalsePositive && !signals.hasHumanIntervention ? 1 : 0,
    geminiTrueNegativeJobs: effectiveRejectedVerdict && !signals.hasGeminiFalseNegative ? 1 : 0,
    geminiFalsePositiveJobs: signals.hasGeminiFalsePositive ? 1 : 0,
    geminiFalseNegativeJobs: signals.hasGeminiFalseNegative ? 1 : 0,
    humanReviewAvoidedJobs:
      effectiveApprovedVerdict && !signals.hasHumanIntervention && (job.manualRegenerationCount || 0) === 0 ? 1 : 0,
  };
};

export const getRatePct = (numerator: number, denominator: number, digits = 1): number =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(digits)) : 0;
