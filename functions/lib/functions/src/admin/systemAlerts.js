"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSystemAlerts = exports.getSystemAlertSettings = exports.getSystemAlertSettingsDocRef = exports.sanitizeSystemAlertSettings = exports.DEFAULT_SYSTEM_ALERT_SETTINGS = void 0;
const appFirestore_1 = require("../firebase/appFirestore");
const SETTINGS_COLLECTION = 'system_alert_settings';
const SETTINGS_DOC_ID = 'global';
exports.DEFAULT_SYSTEM_ALERT_SETTINGS = {
    dailyCostUsdThreshold: 25,
    recentErrorRateThreshold: 10,
    pendingJobsThreshold: 25,
    staleProcessingJobsThreshold: 1,
};
const sanitizeSystemAlertSettings = (input) => ({
    dailyCostUsdThreshold: typeof input?.dailyCostUsdThreshold === 'number' && Number.isFinite(input.dailyCostUsdThreshold) && input.dailyCostUsdThreshold > 0
        ? Number(input.dailyCostUsdThreshold.toFixed(2))
        : exports.DEFAULT_SYSTEM_ALERT_SETTINGS.dailyCostUsdThreshold,
    recentErrorRateThreshold: typeof input?.recentErrorRateThreshold === 'number' && Number.isFinite(input.recentErrorRateThreshold) && input.recentErrorRateThreshold >= 0
        ? Number(input.recentErrorRateThreshold.toFixed(1))
        : exports.DEFAULT_SYSTEM_ALERT_SETTINGS.recentErrorRateThreshold,
    pendingJobsThreshold: typeof input?.pendingJobsThreshold === 'number' && Number.isFinite(input.pendingJobsThreshold) && input.pendingJobsThreshold >= 1
        ? Math.round(input.pendingJobsThreshold)
        : exports.DEFAULT_SYSTEM_ALERT_SETTINGS.pendingJobsThreshold,
    staleProcessingJobsThreshold: typeof input?.staleProcessingJobsThreshold === 'number' && Number.isFinite(input.staleProcessingJobsThreshold) && input.staleProcessingJobsThreshold >= 1
        ? Math.round(input.staleProcessingJobsThreshold)
        : exports.DEFAULT_SYSTEM_ALERT_SETTINGS.staleProcessingJobsThreshold,
});
exports.sanitizeSystemAlertSettings = sanitizeSystemAlertSettings;
const getSystemAlertSettingsDocRef = () => (0, appFirestore_1.getAppFirestore)().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID);
exports.getSystemAlertSettingsDocRef = getSystemAlertSettingsDocRef;
const getSystemAlertSettings = async () => {
    const snapshot = await (0, exports.getSystemAlertSettingsDocRef)().get();
    if (!snapshot.exists) {
        return exports.DEFAULT_SYSTEM_ALERT_SETTINGS;
    }
    return (0, exports.sanitizeSystemAlertSettings)(snapshot.data());
};
exports.getSystemAlertSettings = getSystemAlertSettings;
const createAlert = (partial, checkedAt) => ({
    ...partial,
    checkedAt,
});
const buildSystemAlerts = ({ settings, queue, providers, todayCostUsd, checkedAt, }) => {
    const alerts = [];
    if (settings.dailyCostUsdThreshold !== null && todayCostUsd >= settings.dailyCostUsdThreshold) {
        alerts.push(createAlert({
            id: 'daily_cost',
            status: todayCostUsd >= settings.dailyCostUsdThreshold * 1.5 ? 'down' : 'degraded',
            title: 'Gasto diario alto',
            description: `El costo acumulado del día ya va en $${todayCostUsd.toFixed(2)} USD.`,
            metricLabel: 'Costo del día',
            currentValue: Number(todayCostUsd.toFixed(2)),
            thresholdValue: settings.dailyCostUsdThreshold,
        }, checkedAt));
    }
    if (queue.recentErrorRate >= settings.recentErrorRateThreshold) {
        alerts.push(createAlert({
            id: 'recent_error_rate',
            status: queue.recentErrorRate >= Math.max(settings.recentErrorRateThreshold * 2, 20) ? 'down' : 'degraded',
            title: 'Tasa de error elevada',
            description: `La ventana reciente de ${queue.windowHours}h muestra demasiados trabajos fallidos.`,
            metricLabel: 'Error reciente',
            currentValue: queue.recentErrorRate,
            thresholdValue: settings.recentErrorRateThreshold,
        }, checkedAt));
    }
    if (queue.pendingJobs >= settings.pendingJobsThreshold) {
        alerts.push(createAlert({
            id: 'queue_backlog',
            status: queue.pendingJobs >= settings.pendingJobsThreshold * 2 ? 'down' : 'degraded',
            title: 'Cola pendiente alta',
            description: 'Hay demasiados trabajos esperando turno y conviene revisar capacidad o proveedor.',
            metricLabel: 'Pendientes',
            currentValue: queue.pendingJobs,
            thresholdValue: settings.pendingJobsThreshold,
        }, checkedAt));
    }
    if (queue.staleProcessingJobs >= settings.staleProcessingJobsThreshold) {
        alerts.push(createAlert({
            id: 'stale_processing_jobs',
            status: queue.staleProcessingJobs >= settings.staleProcessingJobsThreshold + 2 ? 'down' : 'degraded',
            title: 'Jobs atascados detectados',
            description: 'Hay trabajos vencidos en procesamiento; probablemente necesiten reencolado o revisión.',
            metricLabel: 'Atascados',
            currentValue: queue.staleProcessingJobs,
            thresholdValue: settings.staleProcessingJobsThreshold,
        }, checkedAt));
    }
    const unhealthyProviders = providers.filter((provider) => provider.status !== 'healthy');
    if (unhealthyProviders.length > 0) {
        const hasDownProvider = unhealthyProviders.some((provider) => provider.status === 'down');
        alerts.push(createAlert({
            id: 'provider_status',
            status: hasDownProvider ? 'down' : 'degraded',
            title: hasDownProvider ? 'Proveedor caído' : 'Proveedor degradado',
            description: unhealthyProviders
                .map((provider) => `${provider.provider}: ${provider.detail}`)
                .join(' · '),
            metricLabel: 'Proveedores afectados',
            currentValue: unhealthyProviders.length,
            thresholdValue: 0,
        }, checkedAt));
    }
    return alerts.sort((left, right) => {
        const order = { down: 0, degraded: 1, healthy: 2 };
        return order[left.status] - order[right.status];
    });
};
exports.buildSystemAlerts = buildSystemAlerts;
//# sourceMappingURL=systemAlerts.js.map