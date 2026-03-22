import {
  HealthStatus,
  ProviderHealthCheck,
  QueueHealthSnapshot,
  SystemAlert,
  SystemAlertId,
  SystemAlertSettings,
  SystemHealthSnapshot,
} from '../../../shared/src/types';

const DEFAULT_QUEUE_HEALTH: QueueHealthSnapshot = {
  pendingJobs: 0,
  processingJobs: 0,
  staleProcessingJobs: 0,
  recentCompletedJobs: 0,
  recentFailedJobs: 0,
  recentTerminalJobs: 0,
  recentErrorRate: 0,
  windowHours: 24,
};

const DEFAULT_SYSTEM_ALERT_SETTINGS: SystemAlertSettings = {
  dailyCostUsdThreshold: 25,
  recentErrorRateThreshold: 10,
  pendingJobsThreshold: 25,
  staleProcessingJobsThreshold: 1,
};

const VALID_HEALTH_STATUSES: HealthStatus[] = ['healthy', 'degraded', 'down'];
const VALID_PROVIDER_NAMES: ProviderHealthCheck['provider'][] = ['fal.ai', 'OpenAI', 'Gemini'];
const VALID_ALERT_IDS: SystemAlertId[] = [
  'daily_cost',
  'recent_error_rate',
  'queue_backlog',
  'stale_processing_jobs',
  'provider_status',
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isHealthStatus = (value: unknown): value is HealthStatus =>
  typeof value === 'string' && VALID_HEALTH_STATUSES.includes(value as HealthStatus);

const isProviderName = (value: unknown): value is ProviderHealthCheck['provider'] =>
  typeof value === 'string' && VALID_PROVIDER_NAMES.includes(value as ProviderHealthCheck['provider']);

const isSystemAlertId = (value: unknown): value is SystemAlertId =>
  typeof value === 'string' && VALID_ALERT_IDS.includes(value as SystemAlertId);

const toFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toOptionalFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeSettings = (value: unknown): SystemAlertSettings => {
  if (!isRecord(value)) {
    return DEFAULT_SYSTEM_ALERT_SETTINGS;
  }

  return {
    dailyCostUsdThreshold:
      value.dailyCostUsdThreshold === null
        ? null
        : typeof value.dailyCostUsdThreshold === 'number' && Number.isFinite(value.dailyCostUsdThreshold) && value.dailyCostUsdThreshold > 0
          ? Number(value.dailyCostUsdThreshold.toFixed(2))
          : DEFAULT_SYSTEM_ALERT_SETTINGS.dailyCostUsdThreshold,
    recentErrorRateThreshold:
      typeof value.recentErrorRateThreshold === 'number' &&
      Number.isFinite(value.recentErrorRateThreshold) &&
      value.recentErrorRateThreshold >= 0
        ? Number(value.recentErrorRateThreshold.toFixed(1))
        : DEFAULT_SYSTEM_ALERT_SETTINGS.recentErrorRateThreshold,
    pendingJobsThreshold:
      typeof value.pendingJobsThreshold === 'number' && Number.isFinite(value.pendingJobsThreshold) && value.pendingJobsThreshold >= 1
        ? Math.round(value.pendingJobsThreshold)
        : DEFAULT_SYSTEM_ALERT_SETTINGS.pendingJobsThreshold,
    staleProcessingJobsThreshold:
      typeof value.staleProcessingJobsThreshold === 'number' &&
      Number.isFinite(value.staleProcessingJobsThreshold) &&
      value.staleProcessingJobsThreshold >= 1
        ? Math.round(value.staleProcessingJobsThreshold)
        : DEFAULT_SYSTEM_ALERT_SETTINGS.staleProcessingJobsThreshold,
    updatedAt: value.updatedAt,
    updatedByUid: typeof value.updatedByUid === 'string' ? value.updatedByUid : null,
    updatedByDisplayName: typeof value.updatedByDisplayName === 'string' ? value.updatedByDisplayName : null,
  };
};

const normalizeQueue = (value: unknown): QueueHealthSnapshot => {
  if (!isRecord(value)) {
    return DEFAULT_QUEUE_HEALTH;
  }

  return {
    pendingJobs: toFiniteNumber(value.pendingJobs, DEFAULT_QUEUE_HEALTH.pendingJobs),
    processingJobs: toFiniteNumber(value.processingJobs, DEFAULT_QUEUE_HEALTH.processingJobs),
    staleProcessingJobs: toFiniteNumber(value.staleProcessingJobs, DEFAULT_QUEUE_HEALTH.staleProcessingJobs),
    recentCompletedJobs: toFiniteNumber(value.recentCompletedJobs, DEFAULT_QUEUE_HEALTH.recentCompletedJobs),
    recentFailedJobs: toFiniteNumber(value.recentFailedJobs, DEFAULT_QUEUE_HEALTH.recentFailedJobs),
    recentTerminalJobs: toFiniteNumber(value.recentTerminalJobs, DEFAULT_QUEUE_HEALTH.recentTerminalJobs),
    recentErrorRate: toFiniteNumber(value.recentErrorRate, DEFAULT_QUEUE_HEALTH.recentErrorRate),
    windowHours: toFiniteNumber(value.windowHours, DEFAULT_QUEUE_HEALTH.windowHours),
  };
};

const normalizeProvider = (value: unknown): ProviderHealthCheck | null => {
  if (!isRecord(value) || !isProviderName(value.provider)) {
    return null;
  }

  const status = isHealthStatus(value.status) ? value.status : 'degraded';

  return {
    provider: value.provider,
    status,
    ok: typeof value.ok === 'boolean' ? value.ok : status === 'healthy',
    httpStatus: toOptionalFiniteNumber(value.httpStatus),
    latencyMs: toOptionalFiniteNumber(value.latencyMs),
    detail: typeof value.detail === 'string' && value.detail.trim() ? value.detail : 'Sin detalle disponible.',
    checkedAt: value.checkedAt ?? new Date(),
  };
};

const normalizeAlert = (value: unknown): SystemAlert | null => {
  if (!isRecord(value) || !isSystemAlertId(value.id)) {
    return null;
  }

  return {
    id: value.id,
    status: isHealthStatus(value.status) ? value.status : 'degraded',
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'Alerta del sistema',
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description
        : 'Hay una condición del sistema que conviene revisar.',
    metricLabel: typeof value.metricLabel === 'string' ? value.metricLabel : null,
    currentValue:
      typeof value.currentValue === 'number' || typeof value.currentValue === 'string' ? value.currentValue : null,
    thresholdValue:
      typeof value.thresholdValue === 'number' || typeof value.thresholdValue === 'string' ? value.thresholdValue : null,
    checkedAt: value.checkedAt ?? new Date(),
  };
};

export const normalizeSystemHealthSnapshot = (value: unknown): SystemHealthSnapshot => {
  const raw = isRecord(value) ? value : {};
  const overallStatus = isHealthStatus(raw.overallStatus) ? raw.overallStatus : 'degraded';

  return {
    overallStatus,
    summary:
      typeof raw.summary === 'string' && raw.summary.trim()
        ? raw.summary
        : 'No se pudo completar toda la lectura del estado del sistema.',
    providers: Array.isArray(raw.providers) ? raw.providers.map(normalizeProvider).filter(Boolean) as ProviderHealthCheck[] : [],
    queue: normalizeQueue(raw.queue),
    alerts: Array.isArray(raw.alerts) ? raw.alerts.map(normalizeAlert).filter(Boolean) as SystemAlert[] : [],
    settings: normalizeSettings(raw.settings),
    todayCostUsd: toFiniteNumber(raw.todayCostUsd, 0),
    checkedAt: raw.checkedAt ?? new Date(),
  };
};
