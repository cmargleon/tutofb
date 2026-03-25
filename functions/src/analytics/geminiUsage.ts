import * as admin from 'firebase-admin';
import { GeminiUsageFeature, GeminiUsageRecord, GeminiUsageStatus } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

interface GeminiUsageMetadata {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
}

interface GeminiUsagePayload {
  usageMetadata?: GeminiUsageMetadata;
}

export interface GeminiUsageContext {
  feature: GeminiUsageFeature;
  model: string;
  batchId?: string | null;
  jobId?: string | null;
  clientId?: string | null;
  clientNameSnapshot?: string | null;
  modelId?: string | null;
  modelNameSnapshot?: string | null;
  garmentId?: string | null;
  garmentName?: string | null;
  poseId?: string | null;
  poseFileName?: string | null;
  userUid?: string | null;
}

interface TrackGeminiUsageInput {
  context: GeminiUsageContext;
  status: GeminiUsageStatus;
  usageMetadata?: GeminiUsageMetadata;
  durationMs?: number | null;
  httpStatus?: number | null;
  errorMessage?: string | null;
}

interface CallGeminiGenerateContentArgs {
  apiKey: string;
  model: string;
  body: unknown;
  context: Omit<GeminiUsageContext, 'model'>;
  signal?: AbortSignal;
}

interface CallGeminiGenerateContentResult<TPayload> {
  payload: TPayload;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

const GEMINI_INPUT_COST_PER_MILLION_USD = 0.25;
const GEMINI_OUTPUT_COST_PER_MILLION_USD = 1.5;
const GEMINI_USAGE_COLLECTION = 'analytics_gemini_usage';

const toSafeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
};

const normalizeUsage = (
  usageMetadata?: GeminiUsageMetadata,
): CallGeminiGenerateContentResult<never>['usage'] => {
  const inputTokens = toSafeInteger(usageMetadata?.promptTokenCount);
  const outputTokens = toSafeInteger(usageMetadata?.candidatesTokenCount);
  const reportedTotalTokens = toSafeInteger(usageMetadata?.totalTokenCount);
  const totalTokens = reportedTotalTokens || inputTokens + outputTokens;
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * GEMINI_INPUT_COST_PER_MILLION_USD +
    (outputTokens / 1_000_000) * GEMINI_OUTPUT_COST_PER_MILLION_USD;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  };
};

const persistGeminiUsage = async ({
  context,
  status,
  usageMetadata,
  durationMs,
  httpStatus,
  errorMessage,
}: TrackGeminiUsageInput): Promise<void> => {
  const usage = normalizeUsage(usageMetadata);
  const payload: Omit<GeminiUsageRecord, 'id'> = {
    provider: 'gemini',
    feature: context.feature,
    operation: 'generateContent',
    model: context.model,
    status,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    httpStatus: typeof httpStatus === 'number' && Number.isFinite(httpStatus) ? httpStatus : null,
    errorMessage: typeof errorMessage === 'string' && errorMessage.trim() ? errorMessage.trim().slice(0, 1000) : null,
    batchId: context.batchId || null,
    jobId: context.jobId || null,
    clientId: context.clientId || null,
    clientNameSnapshot: context.clientNameSnapshot || null,
    modelId: context.modelId || null,
    modelNameSnapshot: context.modelNameSnapshot || null,
    garmentId: context.garmentId || null,
    garmentName: context.garmentName || null,
    poseId: context.poseId || null,
    poseFileName: context.poseFileName || null,
    userUid: context.userUid || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp() as unknown,
  };

  await getAppFirestore().collection(GEMINI_USAGE_COLLECTION).add(payload);
};

const parseJsonSafely = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractErrorMessage = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message.trim();
      }
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
  }

  return fallback;
};

export const callGeminiGenerateContent = async <TPayload>({
  apiKey,
  model,
  body,
  context,
  signal,
}: CallGeminiGenerateContentArgs): Promise<CallGeminiGenerateContentResult<TPayload>> => {
  const startedAt = Date.now();
  let loggedUsage = false;
  const usageContext: GeminiUsageContext = {
    ...context,
    model,
  };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    const rawText = await response.text();
    const parsed = parseJsonSafely(rawText) as TPayload | null;
    const parsedUsagePayload = parsed as GeminiUsagePayload | null;
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      const errorMessage = extractErrorMessage(parsed, rawText || `Gemini respondió con status ${response.status}.`);
      try {
        await persistGeminiUsage({
          context: usageContext,
          status: 'error',
          usageMetadata: parsedUsagePayload?.usageMetadata,
          durationMs,
          httpStatus: response.status,
          errorMessage,
        });
        loggedUsage = true;
      } catch (trackingError) {
        console.error('No se pudo registrar el uso fallido de Gemini.', trackingError);
      }
      throw new Error(errorMessage);
    }

    if (!parsed) {
      const errorMessage = 'Gemini devolvió una respuesta JSON inválida.';
      try {
        await persistGeminiUsage({
          context: usageContext,
          status: 'error',
          durationMs,
          httpStatus: response.status,
          errorMessage,
        });
        loggedUsage = true;
      } catch (trackingError) {
        console.error('No se pudo registrar la respuesta inválida de Gemini.', trackingError);
      }
      throw new Error(errorMessage);
    }

    try {
      await persistGeminiUsage({
        context: usageContext,
        status: 'success',
        usageMetadata: parsedUsagePayload?.usageMetadata,
        durationMs,
        httpStatus: response.status,
      });
      loggedUsage = true;
    } catch (trackingError) {
      console.error('No se pudo registrar el uso exitoso de Gemini.', trackingError);
    }

    return {
      payload: parsed,
      usage: normalizeUsage(parsedUsagePayload?.usageMetadata),
    };
  } catch (error) {
    if (error instanceof Error && !loggedUsage) {
      const durationMs = Date.now() - startedAt;
      try {
        await persistGeminiUsage({
          context: usageContext,
          status: 'error',
          durationMs,
          errorMessage: error.message,
        });
        loggedUsage = true;
      } catch (trackingError) {
        console.error('No se pudo registrar el error de transporte de Gemini.', trackingError);
      }
    }
    throw error;
  }
};
