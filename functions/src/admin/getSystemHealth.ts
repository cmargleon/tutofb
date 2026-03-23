import { onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import {
  FAL_KEY,
  GEMINI_API_KEY,
  getGeminiImageReviewModel,
  getOpenAIBaseUrl,
  OPENAI_API_KEY,
} from '../config/runtime';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';
import { HealthStatus, Job, ProviderHealthCheck, QueueHealthSnapshot, SystemHealthSnapshot } from '../../../shared/src/types';
import { toMillis } from '../../../shared/src/utils/dateUtils';
import { computeOverallHealth } from './systemHealth.helpers';
import { buildSystemAlerts, getSystemAlertSettings } from './systemAlerts';

const SYSTEM_WINDOW_HOURS = 24;
const REQUEST_TIMEOUT_MS = 8000;
const FAL_HEALTHCHECK_URL = 'https://queue.fal.run/fal-ai/nano-banana-pro/requests/health/status';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
): Promise<{ response: Response; latencyMs: number }> => {
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
  } finally {
    clearTimeout(timer);
  }
};

const buildProviderResult = (
  provider: ProviderHealthCheck['provider'],
  status: HealthStatus,
  ok: boolean,
  detail: string,
  httpStatus: number | null,
  latencyMs: number | null,
): ProviderHealthCheck => ({
  provider,
  status,
  ok,
  detail,
  httpStatus,
  latencyMs,
  checkedAt: new Date(),
});

const checkOpenAIHealth = async (): Promise<ProviderHealthCheck> => {
  const apiKey = OPENAI_API_KEY.value();
  if (!apiKey) {
    return buildProviderResult('OpenAI', 'down', false, 'OPENAI_API_KEY no está configurada.', null, null);
  }

  try {
    const { response, latencyMs } = await fetchWithTimeout(`${getOpenAIBaseUrl()}/models`, {
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

    return buildProviderResult(
      'OpenAI',
      response.status === 429 ? 'degraded' : 'down',
      false,
      detail,
      response.status,
      latencyMs,
    );
  } catch (error: any) {
    const detail = error?.name === 'AbortError'
      ? 'OpenAI no respondió dentro del tiempo esperado.'
      : (error?.message || 'No se pudo contactar OpenAI.');

    return buildProviderResult('OpenAI', 'down', false, detail, null, null);
  }
};

const checkFalHealth = async (): Promise<ProviderHealthCheck> => {
  const apiKey = FAL_KEY.value();
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
      return buildProviderResult(
        'fal.ai',
        'healthy',
        true,
        'La API respondió en el endpoint de cola; el request de prueba no existe, pero el servicio está accesible.',
        response.status,
        latencyMs,
      );
    }

    const detail = response.status === 429
      ? 'fal.ai respondió con rate limit.'
      : `fal.ai respondió con estado ${response.status}.`;

    return buildProviderResult(
      'fal.ai',
      response.status === 429 ? 'degraded' : 'down',
      false,
      detail,
      response.status,
      latencyMs,
    );
  } catch (error: any) {
    const detail = error?.name === 'AbortError'
      ? 'fal.ai no respondió dentro del tiempo esperado.'
      : (error?.message || 'No se pudo contactar fal.ai.');

    return buildProviderResult('fal.ai', 'down', false, detail, null, null);
  }
};

const checkGeminiHealth = async (): Promise<ProviderHealthCheck> => {
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) {
    return buildProviderResult('Gemini', 'down', false, 'GEMINI_API_KEY no está configurada.', null, null);
  }

  const model = getGeminiImageReviewModel();
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
      return buildProviderResult(
        'Gemini',
        'healthy',
        true,
        `API responde correctamente con el modelo ${model}.`,
        response.status,
        latencyMs,
      );
    }

    const detail =
      response.status === 429
        ? `Gemini respondió con rate limit para el modelo ${model}.`
        : response.status === 404
          ? `Gemini no encontró el modelo configurado (${model}).`
          : `Gemini respondió con estado ${response.status} para el modelo ${model}.`;

    return buildProviderResult(
      'Gemini',
      response.status === 429 ? 'degraded' : 'down',
      false,
      detail,
      response.status,
      latencyMs,
    );
  } catch (error: any) {
    const detail = error?.name === 'AbortError'
      ? 'Gemini no respondió dentro del tiempo esperado.'
      : (error?.message || 'No se pudo contactar Gemini.');

    return buildProviderResult('Gemini', 'down', false, detail, null, null);
  }
};

const getQueueHealth = async (): Promise<QueueHealthSnapshot> => {
  const db = getAppFirestore();
  const cutoff = Timestamp.fromMillis(Date.now() - SYSTEM_WINDOW_HOURS * 60 * 60 * 1000);

  const [pendingSnapshot, processingSnapshot, recentSnapshot] = await Promise.all([
    db.collection('jobs').where('status', '==', 'pending').get(),
    db.collection('jobs').where('status', '==', 'processing').get(),
    db.collection('jobs').where('updatedAt', '>=', cutoff).get(),
  ]);

  const processingJobs = processingSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Job));
  const recentJobs = recentSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Job));
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

const getTodayCostUsd = async (): Promise<number> => {
  const db = getAppFirestore();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const snapshot = await db.collection('analytics_daily').doc(today).get();
  if (!snapshot.exists) {
    return 0;
  }

  const raw = snapshot.data()?.costUsd;
  return typeof raw === 'number' && Number.isFinite(raw) ? Number(raw.toFixed(2)) : 0;
};

export const getSystemHealth = onCall(
  {
    timeoutSeconds: 30,
    secrets: [FAL_KEY, OPENAI_API_KEY, GEMINI_API_KEY],
  },
  async (request): Promise<SystemHealthSnapshot> => {
    await assertCallableRoles(request, ['admin', 'revisor']);

    const [openaiHealth, falHealth, geminiHealth, queue, settings, todayCostUsd] = await Promise.all([
      checkOpenAIHealth(),
      checkFalHealth(),
      checkGeminiHealth(),
      getQueueHealth(),
      getSystemAlertSettings(),
      getTodayCostUsd(),
    ]);

    const providers = [falHealth, openaiHealth, geminiHealth];
    const overall = computeOverallHealth(providers, queue);
    const checkedAt = new Date();
    const alerts = buildSystemAlerts({
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
  },
);
