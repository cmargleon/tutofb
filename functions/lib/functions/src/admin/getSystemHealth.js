"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSystemHealth = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const runtime_1 = require("../config/runtime");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const systemHealth_helpers_1 = require("./systemHealth.helpers");
const systemAlerts_1 = require("./systemAlerts");
const SYSTEM_WINDOW_HOURS = 24;
const REQUEST_TIMEOUT_MS = 8000;
const FAL_HEALTHCHECK_URL = 'https://queue.fal.run/fal-ai/nano-banana-pro/requests/health/status';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const toMillis = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof firestore_1.Timestamp) {
        return value.toMillis();
    }
    if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};
const fetchWithTimeout = async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
        const response = await fetch(input, {
            ...init,
            signal: controller.signal,
        });
        return {
            response,
            latencyMs: Date.now() - startedAt,
        };
    }
    finally {
        clearTimeout(timer);
    }
};
const buildProviderResult = (provider, status, ok, detail, httpStatus, latencyMs) => ({
    provider,
    status,
    ok,
    detail,
    httpStatus,
    latencyMs,
    checkedAt: new Date(),
});
const checkOpenAIHealth = async () => {
    const apiKey = runtime_1.OPENAI_API_KEY.value();
    if (!apiKey) {
        return buildProviderResult('OpenAI', 'down', false, 'OPENAI_API_KEY no está configurada.', null, null);
    }
    try {
        const { response, latencyMs } = await fetchWithTimeout(`${(0, runtime_1.getOpenAIBaseUrl)()}/models`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });
        if (response.ok) {
            return buildProviderResult('OpenAI', 'healthy', true, 'API responde correctamente.', response.status, latencyMs);
        }
        const detail = response.status === 429
            ? 'OpenAI respondió con rate limit.'
            : `OpenAI respondió con estado ${response.status}.`;
        return buildProviderResult('OpenAI', response.status === 429 ? 'degraded' : 'down', false, detail, response.status, latencyMs);
    }
    catch (error) {
        const detail = error?.name === 'AbortError'
            ? 'OpenAI no respondió dentro del tiempo esperado.'
            : (error?.message || 'No se pudo contactar OpenAI.');
        return buildProviderResult('OpenAI', 'down', false, detail, null, null);
    }
};
const checkFalHealth = async () => {
    const apiKey = runtime_1.FAL_KEY.value();
    if (!apiKey) {
        return buildProviderResult('fal.ai', 'down', false, 'FAL_KEY no está configurada.', null, null);
    }
    try {
        const { response, latencyMs } = await fetchWithTimeout(FAL_HEALTHCHECK_URL, {
            method: 'GET',
            headers: {
                Authorization: `Key ${apiKey}`,
            },
        });
        if (response.ok) {
            return buildProviderResult('fal.ai', 'healthy', true, 'API responde correctamente.', response.status, latencyMs);
        }
        if (response.status === 404) {
            return buildProviderResult('fal.ai', 'healthy', true, 'La API respondió en el endpoint de cola; el request de prueba no existe, pero el servicio está accesible.', response.status, latencyMs);
        }
        const detail = response.status === 429
            ? 'fal.ai respondió con rate limit.'
            : `fal.ai respondió con estado ${response.status}.`;
        return buildProviderResult('fal.ai', response.status === 429 ? 'degraded' : 'down', false, detail, response.status, latencyMs);
    }
    catch (error) {
        const detail = error?.name === 'AbortError'
            ? 'fal.ai no respondió dentro del tiempo esperado.'
            : (error?.message || 'No se pudo contactar fal.ai.');
        return buildProviderResult('fal.ai', 'down', false, detail, null, null);
    }
};
const checkGeminiHealth = async () => {
    const apiKey = runtime_1.GEMINI_API_KEY.value();
    if (!apiKey) {
        return buildProviderResult('Gemini', 'down', false, 'GEMINI_API_KEY no está configurada.', null, null);
    }
    const model = (0, runtime_1.getGeminiImageReviewModel)();
    const normalizedModel = model.startsWith('models/') ? model : `models/${model}`;
    const modelUrl = `${GEMINI_API_BASE_URL}/${normalizedModel}`;
    try {
        const { response, latencyMs } = await fetchWithTimeout(`${modelUrl}?key=${encodeURIComponent(apiKey)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (response.ok) {
            return buildProviderResult('Gemini', 'healthy', true, `API responde correctamente con el modelo ${model}.`, response.status, latencyMs);
        }
        const detail = response.status === 429
            ? `Gemini respondió con rate limit para el modelo ${model}.`
            : response.status === 404
                ? `Gemini no encontró el modelo configurado (${model}).`
                : `Gemini respondió con estado ${response.status} para el modelo ${model}.`;
        return buildProviderResult('Gemini', response.status === 429 ? 'degraded' : 'down', false, detail, response.status, latencyMs);
    }
    catch (error) {
        const detail = error?.name === 'AbortError'
            ? 'Gemini no respondió dentro del tiempo esperado.'
            : (error?.message || 'No se pudo contactar Gemini.');
        return buildProviderResult('Gemini', 'down', false, detail, null, null);
    }
};
const getQueueHealth = async () => {
    const db = (0, appFirestore_1.getAppFirestore)();
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - SYSTEM_WINDOW_HOURS * 60 * 60 * 1000);
    const [pendingSnapshot, processingSnapshot, recentSnapshot] = await Promise.all([
        db.collection('jobs').where('status', '==', 'pending').get(),
        db.collection('jobs').where('status', '==', 'processing').get(),
        db.collection('jobs').where('updatedAt', '>=', cutoff).get(),
    ]);
    const processingJobs = processingSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const recentJobs = recentSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const now = Date.now();
    const staleProcessingJobs = processingJobs.filter((job) => {
        const expiresAtMs = toMillis(job.claimExpiresAt);
        return expiresAtMs !== null && expiresAtMs < now;
    }).length;
    const recentCompletedJobs = recentJobs.filter((job) => job.status === 'completed').length;
    const recentFailedJobs = recentJobs.filter((job) => job.status === 'failed').length;
    const recentTerminalJobs = recentCompletedJobs + recentFailedJobs;
    const recentErrorRate = recentTerminalJobs > 0
        ? Number(((recentFailedJobs / recentTerminalJobs) * 100).toFixed(1))
        : 0;
    return {
        pendingJobs: pendingSnapshot.size,
        processingJobs: processingSnapshot.size,
        staleProcessingJobs,
        recentCompletedJobs,
        recentFailedJobs,
        recentTerminalJobs,
        recentErrorRate,
        windowHours: SYSTEM_WINDOW_HOURS,
    };
};
const getTodayCostUsd = async () => {
    const db = (0, appFirestore_1.getAppFirestore)();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const snapshot = await db.collection('analytics_daily').doc(today).get();
    if (!snapshot.exists) {
        return 0;
    }
    const raw = snapshot.data()?.costUsd;
    return typeof raw === 'number' && Number.isFinite(raw) ? Number(raw.toFixed(2)) : 0;
};
exports.getSystemHealth = (0, https_1.onCall)({
    timeoutSeconds: 30,
    secrets: [runtime_1.FAL_KEY, runtime_1.OPENAI_API_KEY, runtime_1.GEMINI_API_KEY],
}, async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin', 'revisor']);
    const [openaiHealth, falHealth, geminiHealth, queue, settings, todayCostUsd] = await Promise.all([
        checkOpenAIHealth(),
        checkFalHealth(),
        checkGeminiHealth(),
        getQueueHealth(),
        (0, systemAlerts_1.getSystemAlertSettings)(),
        getTodayCostUsd(),
    ]);
    const providers = [falHealth, openaiHealth, geminiHealth];
    const overall = (0, systemHealth_helpers_1.computeOverallHealth)(providers, queue);
    const checkedAt = new Date();
    const alerts = (0, systemAlerts_1.buildSystemAlerts)({
        settings,
        queue,
        providers,
        todayCostUsd,
        checkedAt,
    });
    return {
        overallStatus: overall.overallStatus,
        summary: overall.summary,
        providers,
        queue,
        alerts,
        settings,
        todayCostUsd,
        checkedAt,
    };
});
//# sourceMappingURL=getSystemHealth.js.map