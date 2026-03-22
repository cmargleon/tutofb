import { getAppFirestore } from '../firebase/appFirestore';
import { HealthStatus, ProviderHealthCheck, QueueHealthSnapshot, SystemAlert, SystemAlertSettings } from '../../../shared/src/types';

const SETTINGS_COLLECTION = 'system_alert_settings';
const SETTINGS_DOC_ID = 'global';

export const DEFAULT_SYSTEM_ALERT_SETTINGS: SystemAlertSettings = {
  dailyCostUsdThreshold: 25,
  recentErrorRateThreshold: 10,
  pendingJobsThreshold: 25,
  staleProcessingJobsThreshold: 1,
};

export const sanitizeSystemAlertSettings = (
  input: Partial<SystemAlertSettings> | null | undefined,
): SystemAlertSettings => ({
  dailyCostUsdThreshold:
    typeof input?.dailyCostUsdThreshold === 'number' && Number.isFinite(input.dailyCostUsdThreshold) && input.dailyCostUsdThreshold > 0
      ? Number(input.dailyCostUsdThreshold.toFixed(2))
      : DEFAULT_SYSTEM_ALERT_SETTINGS.dailyCostUsdThreshold,
  recentErrorRateThreshold:
    typeof input?.recentErrorRateThreshold === 'number' && Number.isFinite(input.recentErrorRateThreshold) && input.recentErrorRateThreshold >= 0
      ? Number(input.recentErrorRateThreshold.toFixed(1))
      : DEFAULT_SYSTEM_ALERT_SETTINGS.recentErrorRateThreshold,
  pendingJobsThreshold:
    typeof input?.pendingJobsThreshold === 'number' && Number.isFinite(input.pendingJobsThreshold) && input.pendingJobsThreshold >= 1
      ? Math.round(input.pendingJobsThreshold)
      : DEFAULT_SYSTEM_ALERT_SETTINGS.pendingJobsThreshold,
  staleProcessingJobsThreshold:
    typeof input?.staleProcessingJobsThreshold === 'number' && Number.isFinite(input.staleProcessingJobsThreshold) && input.staleProcessingJobsThreshold >= 1
      ? Math.round(input.staleProcessingJobsThreshold)
      : DEFAULT_SYSTEM_ALERT_SETTINGS.staleProcessingJobsThreshold,
});

export const getSystemAlertSettingsDocRef = () =>
  getAppFirestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID);

export const getSystemAlertSettings = async (): Promise<SystemAlertSettings> => {
  const snapshot = await getSystemAlertSettingsDocRef().get();
  if (!snapshot.exists) {
    return DEFAULT_SYSTEM_ALERT_SETTINGS;
  }

  return sanitizeSystemAlertSettings(snapshot.data() as Partial<SystemAlertSettings>);
};

const createAlert = (
  partial: Omit<SystemAlert, 'checkedAt'>,
  checkedAt: Date,
): SystemAlert => ({
  ...partial,
  checkedAt,
});

export const buildSystemAlerts = ({
  settings,
  queue,
  providers,
  todayCostUsd,
  checkedAt,
}: {
  settings: SystemAlertSettings;
  queue: QueueHealthSnapshot;
  providers: ProviderHealthCheck[];
  todayCostUsd: number;
  checkedAt: Date;
}): SystemAlert[] => {
  const alerts: SystemAlert[] = [];

  if (settings.dailyCostUsdThreshold !== null && todayCostUsd >= settings.dailyCostUsdThreshold) {
    alerts.push(
      createAlert(
        {
          id: 'daily_cost',
          status: todayCostUsd >= settings.dailyCostUsdThreshold * 1.5 ? 'down' : 'degraded',
          title: 'Gasto diario alto',
          description: `El costo acumulado del día ya va en $${todayCostUsd.toFixed(2)} USD.`,
          metricLabel: 'Costo del día',
          currentValue: Number(todayCostUsd.toFixed(2)),
          thresholdValue: settings.dailyCostUsdThreshold,
        },
        checkedAt,
      ),
    );
  }

  if (queue.recentErrorRate >= settings.recentErrorRateThreshold) {
    alerts.push(
      createAlert(
        {
          id: 'recent_error_rate',
          status: queue.recentErrorRate >= Math.max(settings.recentErrorRateThreshold * 2, 20) ? 'down' : 'degraded',
          title: 'Tasa de error elevada',
          description: `La ventana reciente de ${queue.windowHours}h muestra demasiados trabajos fallidos.`,
          metricLabel: 'Error reciente',
          currentValue: queue.recentErrorRate,
          thresholdValue: settings.recentErrorRateThreshold,
        },
        checkedAt,
      ),
    );
  }

  if (queue.pendingJobs >= settings.pendingJobsThreshold) {
    alerts.push(
      createAlert(
        {
          id: 'queue_backlog',
          status: queue.pendingJobs >= settings.pendingJobsThreshold * 2 ? 'down' : 'degraded',
          title: 'Cola pendiente alta',
          description: 'Hay demasiados trabajos esperando turno y conviene revisar capacidad o proveedor.',
          metricLabel: 'Pendientes',
          currentValue: queue.pendingJobs,
          thresholdValue: settings.pendingJobsThreshold,
        },
        checkedAt,
      ),
    );
  }

  if (queue.staleProcessingJobs >= settings.staleProcessingJobsThreshold) {
    alerts.push(
      createAlert(
        {
          id: 'stale_processing_jobs',
          status: queue.staleProcessingJobs >= settings.staleProcessingJobsThreshold + 2 ? 'down' : 'degraded',
          title: 'Jobs atascados detectados',
          description: 'Hay trabajos vencidos en procesamiento; probablemente necesiten reencolado o revisión.',
          metricLabel: 'Atascados',
          currentValue: queue.staleProcessingJobs,
          thresholdValue: settings.staleProcessingJobsThreshold,
        },
        checkedAt,
      ),
    );
  }

  const unhealthyProviders = providers.filter((provider) => provider.status !== 'healthy');
  if (unhealthyProviders.length > 0) {
    const hasDownProvider = unhealthyProviders.some((provider) => provider.status === 'down');
    alerts.push(
      createAlert(
        {
          id: 'provider_status',
          status: hasDownProvider ? 'down' : 'degraded',
          title: hasDownProvider ? 'Proveedor caído' : 'Proveedor degradado',
          description: unhealthyProviders
            .map((provider) => `${provider.provider}: ${provider.detail}`)
            .join(' · '),
          metricLabel: 'Proveedores afectados',
          currentValue: unhealthyProviders.length,
          thresholdValue: 0,
        },
        checkedAt,
      ),
    );
  }

  return alerts.sort((left, right) => {
    const order: Record<HealthStatus, number> = { down: 0, degraded: 1, healthy: 2 };
    return order[left.status] - order[right.status];
  });
};
