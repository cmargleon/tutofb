import policy from '../../../shared/src/automationPolling.json';
import type { AutomationJob } from '../../../shared/src/types';

/** Monitoring deadline only: never changes production state or cancels a job. */
export function automationPolling(job: Pick<AutomationJob, 'createdAt' | 'status'>, now = Date.now()) {
  const createdAtMs = job.createdAt.toMillis();
  const deadlineMs = createdAtMs + policy.timeoutSeconds * 1000;
  const terminal = ['completed', 'failed', 'needs_attention'].includes(job.status);
  const timedOut = !terminal && now >= deadlineMs;
  const interval = now - createdAtMs < policy.initialWindowSeconds * 1000
    ? policy.initialIntervalSeconds : policy.subsequentIntervalSeconds;
  return {
    createdAt: new Date(createdAtMs).toISOString(),
    pollingDeadlineAt: new Date(deadlineMs).toISOString(),
    pollAfterSeconds: terminal || timedOut ? 0 : Math.min(interval, Math.ceil((deadlineMs - now) / 1000)),
    pollingTimedOut: timedOut,
    pollingPolicy: policy,
  };
}
