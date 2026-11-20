import { geminiModelRates, geminiUsageCost } from '../../../shared/src/constants/geminiPrices';
import { runManglarPaid } from '../manglar/budget';
import { reserveAutomationOperation, settleAutomationOperation } from '../automation/budget';
import { GEMINI_OPERATION_HOLD_USD } from '../costs/generationEstimates';
import * as admin from 'firebase-admin';
import { GeminiUsageFeature, GeminiUsageRecord, GeminiUsageStatus } from '../../../shared/src/types';
import { getAppFirestore } from '../firebase/appFirestore';

interface GeminiUsageMetadata {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
}

interface GeminiUsagePayload {
  usageMetadata?: GeminiUsageMetadata;
}

export interface GeminiUsageContext {
  automation?: { id: string; key: string; kind: 'classification' | 'review'; generation?: { id: string; claimToken: string | null } };
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
    thinkingTokens: number;
  };
}

const GEMINI_USAGE_COLLECTION = 'analytics_gemini_usage';

const toSafeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
};

export const normalizeUsage = (
  model: string,
  usageMetadata?: GeminiUsageMetadata,
): CallGeminiGenerateContentResult<never>['usage'] => {
  const inputTokens = toSafeInteger(usageMetadata?.promptTokenCount);
  const thinkingTokens = toSafeInteger(usageMetadata?.thoughtsTokenCount);
  const candidateTokens = toSafeInteger(usageMetadata?.candidatesTokenCount);
  const outputTokens = candidateTokens + thinkingTokens;
  const reportedTotalTokens = toSafeInteger(usageMetadata?.totalTokenCount);
  const totalTokens = reportedTotalTokens || inputTokens + outputTokens;
  const estimatedCostUsd = geminiUsageCost(model, inputTokens, candidateTokens, thinkingTokens);

  return {
    inputTokens,
    thinkingTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
  };
};

export const recordedGeminiCostUsd = (model: string, metadata?: GeminiUsageMetadata): number | null => {
  const counts = [metadata?.promptTokenCount, metadata?.candidatesTokenCount, metadata?.thoughtsTokenCount];
  if (typeof counts[0] !== 'number' || typeof counts[1] !== 'number'
    || counts.some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))) return null;
  return normalizeUsage(model, metadata).estimatedCostUsd;
};

const persistGeminiUsage = async ({
  context,
  status,
  usageMetadata,
  durationMs,
  httpStatus,
  errorMessage,
}: TrackGeminiUsageInput): Promise<void> => {
  const usage = normalizeUsage(context.model, usageMetadata);
  const pricing = geminiModelRates(context.model, usage.inputTokens);
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
    thinkingTokens: usage.thinkingTokens,
    pricingStatus: pricing.pricingStatus,
    pricingVerifiedAt: pricing.pricingVerifiedAt,
    pricingSourceUrl: pricing.pricingSourceUrl,
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

const callGeminiGenerateContentCore = async <TPayload>({
  apiKey,
  model,
  body,
  context,
  signal,
}: CallGeminiGenerateContentArgs): Promise<CallGeminiGenerateContentResult<TPayload>> => {
  const startedAt = Date.now();
  const pricing = geminiModelRates(model, 0);
  if (pricing.pricingStatus !== 'verified') console.warn('Gemini pricing uses conservative rates.', { model, pricingStatus: pricing.pricingStatus, pricingSourceUrl: pricing.pricingSourceUrl });
  let loggedUsage = false;
  const usageContext: GeminiUsageContext = {
    ...context,
    model,
  };

  const operation = context.automation ? await reserveAutomationOperation(context.automation.id, context.automation.key, context.automation.kind, GEMINI_OPERATION_HOLD_USD, context.automation.generation) : null;
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

    if (operation && context.automation) await settleAutomationOperation(context.automation.id, operation, recordedGeminiCostUsd(model, parsedUsagePayload?.usageMetadata));
    return {
      payload: parsed,
      usage: normalizeUsage(model, parsedUsagePayload?.usageMetadata),
    };
  } catch (error) {
    if (operation && context.automation) await settleAutomationOperation(context.automation.id, operation, null);
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

export const callGeminiGenerateContent: typeof callGeminiGenerateContentCore = (request) =>
  runManglarPaid(GEMINI_OPERATION_HOLD_USD, () => callGeminiGenerateContentCore(request), undefined,
    result => recordedGeminiCostUsd(request.model, (result.payload as GeminiUsagePayload)?.usageMetadata));
