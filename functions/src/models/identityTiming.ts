import { performance } from 'node:perf_hooks';
import { info } from 'firebase-functions/logger';

const seen = new Set<string>();
// First invocation is a cold-start indicator, not a measurement of platform startup.
export function identityTiming(operation: string, modelId?: string) {
  const started = performance.now();
  const firstInvocation = !seen.has(operation);
  seen.add(operation);
  const stages: Record<string, number> = {};
  return {
    async measure<T>(stage: string, run: () => Promise<T>): Promise<T> {
      const start = performance.now();
      try { return await run(); }
      finally { stages[stage] = (stages[stage] || 0) + performance.now() - start; }
    },
    finish(outcome: 'success' | 'error') {
      info('model_identity_timing', { operation, modelId, firstInvocation, outcome,
        processUptimeMs: Math.round(process.uptime() * 1000), durationMs: Math.round(performance.now() - started),
        stagesMs: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Math.round(value)])) });
    },
  };
}
export type IdentityTiming = ReturnType<typeof identityTiming>;
