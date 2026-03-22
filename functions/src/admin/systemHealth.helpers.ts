import { HealthStatus, ProviderHealthCheck, QueueHealthSnapshot, SystemHealthSnapshot } from '../../../shared/src/types';

const buildSummary = (status: HealthStatus, providers: ProviderHealthCheck[], queue: QueueHealthSnapshot): string => {
  if (status === 'healthy') {
    return 'APIs disponibles, cola bajo control y sin señales recientes de error relevantes.';
  }

  const issues: string[] = [];
  const downProviders = providers.filter((provider) => provider.status === 'down');
  const degradedProviders = providers.filter((provider) => provider.status === 'degraded');

  if (downProviders.length > 0) {
    issues.push(`API caída: ${downProviders.map((provider) => provider.provider).join(', ')}`);
  }

  if (degradedProviders.length > 0) {
    issues.push(`API degradada: ${degradedProviders.map((provider) => provider.provider).join(', ')}`);
  }

  if (queue.staleProcessingJobs > 0) {
    issues.push(`${queue.staleProcessingJobs} jobs parecen atascados`);
  }

  if (queue.pendingJobs > 25) {
    issues.push(`cola pendiente alta (${queue.pendingJobs})`);
  }

  if (queue.recentErrorRate >= 10) {
    issues.push(`tasa de error reciente en ${queue.recentErrorRate}%`);
  }

  return issues.length > 0
    ? issues.join(' · ')
    : 'Hay señales de degradación en el sistema y conviene revisar la operación.';
};

export const computeOverallHealth = (
  providers: ProviderHealthCheck[],
  queue: QueueHealthSnapshot,
): Pick<SystemHealthSnapshot, 'overallStatus' | 'summary'> => {
  const hasProviderDown = providers.some((provider) => provider.status === 'down');
  const hasProviderDegraded = providers.some((provider) => provider.status === 'degraded');
  const isDown =
    hasProviderDown ||
    queue.staleProcessingJobs >= 3 ||
    queue.pendingJobs >= 80 ||
    queue.processingJobs >= 25 ||
    queue.recentErrorRate >= 25;

  if (isDown) {
    return {
      overallStatus: 'down',
      summary: buildSummary('down', providers, queue),
    };
  }

  const isDegraded =
    hasProviderDegraded ||
    queue.staleProcessingJobs > 0 ||
    queue.pendingJobs >= 25 ||
    queue.processingJobs >= 10 ||
    queue.recentErrorRate >= 10;

  if (isDegraded) {
    return {
      overallStatus: 'degraded',
      summary: buildSummary('degraded', providers, queue),
    };
  }

  return {
    overallStatus: 'healthy',
    summary: buildSummary('healthy', providers, queue),
  };
};
