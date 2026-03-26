import { FieldValue } from 'firebase-admin/firestore';
import { Job, JobAutoReviewVerdict, JobOutput, JobReviewSignals } from '../../../shared/src/types';
import { EMPTY_JOB_REVIEW_SIGNALS, getJobReviewSignals } from '../../../shared/src/reviewMetrics';

const normalizeVerdict = (value: unknown): JobAutoReviewVerdict | null =>
  value === 'approved' || value === 'rejected' ? value : null;

const inferSelectionDecision = (
  job: Job,
  output: JobOutput,
): JobReviewSignals['lastHumanDecision'] => {
  const selectedVerdict = normalizeVerdict(output.autoReview?.verdict);
  if (selectedVerdict === 'approved') {
    return 'selected_auto_approved_output';
  }

  if (selectedVerdict === 'rejected') {
    return 'selected_auto_rejected_output';
  }

  if (job.currentOutput?.id && output.id !== job.currentOutput.id) {
    return 'selected_alternative_output';
  }

  return 'selected_alternative_output';
};

export const buildInitialReviewSignals = (): JobReviewSignals => ({
  ...EMPTY_JOB_REVIEW_SIGNALS,
});

export const buildAutoReviewSignalsPatch = (job: Pick<Job, 'reviewSignals' | 'latestAutoReview'>, verdict: JobAutoReviewVerdict) => {
  const current = getJobReviewSignals(job);
  return {
    'reviewSignals.firstAutoReviewVerdict': current.firstAutoReviewVerdict || verdict,
    'reviewSignals.latestAutoReviewVerdict': verdict,
  };
};

export const buildSelectOutputReviewSignalsPatch = ({
  job,
  output,
  uid,
  displayName,
}: {
  job: Job;
  output: JobOutput;
  uid: string;
  displayName: string | null;
}) => {
  const currentSignals = getJobReviewSignals(job);
  const currentVerdict = normalizeVerdict(job.currentOutput?.autoReview?.verdict) || normalizeVerdict(job.latestAutoReview?.verdict);
  const selectedVerdict = normalizeVerdict(output.autoReview?.verdict);
  const selectedDifferentOutput = Boolean(job.currentOutput?.id && output.id !== job.currentOutput.id);
  const falsePositive = currentVerdict === 'approved' && (selectedDifferentOutput || selectedVerdict !== 'approved');
  const falseNegative = selectedVerdict === 'rejected';

  return {
    'reviewSignals.hasHumanIntervention': true,
    'reviewSignals.humanInterventionCount': FieldValue.increment(1),
    'reviewSignals.manualSelectionCount': FieldValue.increment(1),
    'reviewSignals.hasGeminiFalsePositive': currentSignals.hasGeminiFalsePositive || falsePositive,
    'reviewSignals.hasGeminiFalseNegative': currentSignals.hasGeminiFalseNegative || falseNegative,
    'reviewSignals.lastHumanDecision': inferSelectionDecision(job, output),
    'reviewSignals.lastHumanDecisionAt': FieldValue.serverTimestamp(),
    'reviewSignals.lastHumanDecisionByUid': uid,
    'reviewSignals.lastHumanDecisionByDisplayName': displayName,
    'reviewSignals.lastSelectedOutputId': output.id,
    'reviewSignals.lastSelectedOutputVerdict': selectedVerdict || 'unreviewed',
  };
};

export const buildClearSelectionReviewSignalsPatch = ({
  job,
  uid,
  displayName,
}: {
  job: Job;
  uid: string;
  displayName: string | null;
}) => {
  const currentSignals = getJobReviewSignals(job);
  return {
    'reviewSignals.hasHumanIntervention': currentSignals.hasHumanIntervention,
    'reviewSignals.lastHumanDecision': 'cleared_manual_selection' as const,
    'reviewSignals.lastHumanDecisionAt': FieldValue.serverTimestamp(),
    'reviewSignals.lastHumanDecisionByUid': uid,
    'reviewSignals.lastHumanDecisionByDisplayName': displayName,
    'reviewSignals.lastSelectedOutputId': null,
    'reviewSignals.lastSelectedOutputVerdict': null,
  };
};

export const buildRegenerationReviewSignalsPatch = ({
  job,
  uid,
  displayName,
}: {
  job: Job;
  uid: string;
  displayName: string | null;
}) => {
  const currentSignals = getJobReviewSignals(job);
  const currentVerdict = normalizeVerdict(job.currentOutput?.autoReview?.verdict) || normalizeVerdict(job.latestAutoReview?.verdict);
  const falsePositive = currentVerdict === 'approved';

  return {
    'reviewSignals.hasHumanIntervention': true,
    'reviewSignals.humanInterventionCount': FieldValue.increment(1),
    'reviewSignals.hasGeminiFalsePositive': currentSignals.hasGeminiFalsePositive || falsePositive,
    'reviewSignals.hasGeminiFalseNegative': currentSignals.hasGeminiFalseNegative,
    'reviewSignals.lastHumanDecision':
      currentVerdict === 'approved'
        ? 'regenerated_after_auto_approved'
        : currentVerdict === 'rejected'
          ? 'regenerated_after_auto_rejected'
          : 'regenerated_without_auto_review',
    'reviewSignals.lastHumanDecisionAt': FieldValue.serverTimestamp(),
    'reviewSignals.lastHumanDecisionByUid': uid,
    'reviewSignals.lastHumanDecisionByDisplayName': displayName,
    'reviewSignals.latestAutoReviewVerdict': currentVerdict,
  };
};
