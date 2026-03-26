import {
  Batch,
  BatchExperimentAnalytics,
  ExperimentArm,
  ExperimentArmAnalytics,
  ExperimentMode,
  Job,
  Provider,
} from './types';
import { getJobReviewOutcomeCounts, getRatePct } from './reviewMetrics';

export const EXPERIMENT_MODE_VALUES: ExperimentMode[] = ['ab_paired', 'ab_interleaved'];
export const EXPERIMENT_ALLOWED_PROVIDERS: Provider[] = ['fal-seedream', 'openai-gpt-image-1.5'];
export const EXPERIMENT_EXCLUDED_PROVIDERS: Provider[] = ['fal-banana-pro'];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const isExperimentMode = (value: unknown): value is ExperimentMode =>
  EXPERIMENT_MODE_VALUES.includes(value as ExperimentMode);

export const isExperimentEligibleProvider = (value: unknown): value is Provider =>
  EXPERIMENT_ALLOWED_PROVIDERS.includes(value as Provider);

export const buildExperimentArms = (providers: Provider[]): ExperimentArm[] =>
  providers.map((provider, index) => ({
    id: `arm_${index + 1}`,
    provider,
    label: ALPHABET[index] || `Arm ${index + 1}`,
  }));

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

export const computeBatchExperimentAnalytics = (
  batch: Pick<Batch, 'id' | 'experimentEnabled' | 'experimentId' | 'experimentMode' | 'experimentArms'> | null | undefined,
  jobs: Job[],
): BatchExperimentAnalytics | null => {
  if (!batch?.experimentEnabled || !batch.id || !batch.experimentId || !batch.experimentMode || !batch.experimentArms?.length) {
    return null;
  }

  const experimentJobs = jobs.filter((job) => job.experimentEnabled && job.experimentId === batch.experimentId);
  if (experimentJobs.length === 0) {
    return null;
  }

  const comparableGroups = new Set(
    experimentJobs
      .map((job) => job.experimentComparisonKey)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ).size;

  const rawArms = batch.experimentArms.map((arm) => {
    const armJobs = experimentJobs.filter((job) => job.experimentArmId === arm.id);
    const totalJobs = armJobs.length;
    const completedJobs = armJobs.filter((job) => job.status === 'completed').length;
    const failedJobs = armJobs.filter((job) => job.status === 'failed').length;
    const pendingJobs = armJobs.filter((job) => job.status === 'pending').length;
    const processingJobs = armJobs.filter((job) => job.status === 'processing').length;
    const reviewCounts = armJobs.reduce(
      (acc, job) => {
        const current = getJobReviewOutcomeCounts(job);
        return {
          jobsWithHumanIntervention: acc.jobsWithHumanIntervention + current.jobsWithHumanIntervention,
          humanInterventionCount: acc.humanInterventionCount + current.humanInterventionCount,
          manualSelectionCount: acc.manualSelectionCount + current.manualSelectionCount,
          geminiFalsePositiveJobs: acc.geminiFalsePositiveJobs + current.geminiFalsePositiveJobs,
          geminiFalseNegativeJobs: acc.geminiFalseNegativeJobs + current.geminiFalseNegativeJobs,
          geminiTruePositiveJobs: acc.geminiTruePositiveJobs + current.geminiTruePositiveJobs,
        };
      },
      {
        jobsWithHumanIntervention: 0,
        humanInterventionCount: 0,
        manualSelectionCount: 0,
        geminiFalsePositiveJobs: 0,
        geminiFalseNegativeJobs: 0,
        geminiTruePositiveJobs: 0,
      },
    );
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
      jobsWithHumanIntervention: reviewCounts.jobsWithHumanIntervention,
      humanInterventionCount: reviewCounts.humanInterventionCount,
      manualSelectionCount: reviewCounts.manualSelectionCount,
      manualRegenerationCount,
      regeneratedJobs,
      regenerationRatePct: getRatePct(manualRegenerationCount, totalJobs),
      humanInterventionRatePct: getRatePct(reviewCounts.jobsWithHumanIntervention, totalJobs),
      geminiFalsePositiveJobs: reviewCounts.geminiFalsePositiveJobs,
      geminiFalseNegativeJobs: reviewCounts.geminiFalseNegativeJobs,
      geminiPrecisionPct: getRatePct(
        reviewCounts.geminiTruePositiveJobs,
        reviewCounts.geminiTruePositiveJobs + reviewCounts.geminiFalsePositiveJobs,
      ),
      totalCostUsd: round(totalCostUsd, 4),
      avgCostPerJobUsd: totalJobs > 0 ? round(totalCostUsd / totalJobs, 4) : 0,
      avgCostPerCompletedJobUsd: completedJobs > 0 ? round(totalCostUsd / completedJobs, 4) : round(totalCostUsd, 4),
      totalDurationSeconds,
      avgDurationPerJobSeconds: totalJobs > 0 ? round(totalDurationSeconds / totalJobs, 1) : 0,
      efficiencyScore: 0,
    } satisfies ExperimentArmAnalytics;
  });

  const minCost = Math.max(0.0001, Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.avgCostPerCompletedJobUsd || arm.avgCostPerJobUsd || 0.0001))));
  const minDuration = Math.max(0.0001, Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.avgDurationPerJobSeconds || 0.0001))));
  const minIntervention = Math.max(
    0.0001,
    Math.min(...rawArms.map((arm) => Math.max(0.0001, arm.humanInterventionRatePct || 0.0001))),
  );

  const arms = rawArms.map((arm) => {
    const costRatio = (arm.avgCostPerCompletedJobUsd || arm.avgCostPerJobUsd || minCost) / minCost;
    const durationRatio = (arm.avgDurationPerJobSeconds || minDuration) / minDuration;
    const interventionRatio = (Math.max(0.0001, arm.humanInterventionRatePct || 0.0001)) / minIntervention;

    return {
      ...arm,
      efficiencyScore: round(costRatio * 0.4 + durationRatio * 0.35 + interventionRatio * 0.25, 3),
    };
  });

  const winner = [...arms].sort((left, right) => left.efficiencyScore - right.efficiencyScore)[0] || null;
  const recommendation = winner
    ? `${winner.label} (${winner.provider}) muestra mejor balance entre costo, tiempo total y necesidad de intervención humana.`
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
