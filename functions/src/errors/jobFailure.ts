import {
  JobFailureInfo,
  JobFailureReasonCode,
  JobFailureStage,
  JobFailureSource,
  Provider,
} from '../../../shared/src/types';

type FailureContext = {
  provider?: Provider | null;
  requestId?: string | null;
  outputId?: string | null;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
};

type ProviderGenerationErrorOptions = {
  provider: Provider;
  reasonCode: JobFailureReasonCode;
  message: string;
  stage?: JobFailureStage;
  requestId?: string | null;
  httpStatus?: number | null;
  providerStatus?: string | null;
  retryable?: boolean;
  raw?: Record<string, unknown> | null;
};

type GeminiAutoReviewErrorOptions = {
  reasonCode: JobFailureReasonCode;
  message: string;
  finishReason?: string | null;
  promptFeedback?: Record<string, unknown> | null;
  retryable?: boolean;
  raw?: Record<string, unknown> | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeMessage = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
};

const distinctMessage = (primary: string | null | undefined, fallback: string | null | undefined): string | null => {
  const normalizedPrimary = normalizeMessage(primary);
  const normalizedFallback = normalizeMessage(fallback);

  if (!normalizedPrimary) {
    return normalizedFallback;
  }

  if (!normalizedFallback || normalizedPrimary === normalizedFallback) {
    return normalizedPrimary;
  }

  return normalizedPrimary;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || /abort|timeout|timed out/i.test(error.message));

const isRateLimitMessage = (message: string | null): boolean =>
  Boolean(message && /(429|rate limit|too many requests|quota)/i.test(message));

const isMissingConfigMessage = (message: string | null): boolean =>
  Boolean(message && /no est[aá] configurad[ao]/i.test(message));

const defaultSourceForStage = (stage: JobFailureStage): JobFailureSource => {
  switch (stage) {
    case 'validation':
      return 'gemini';
    case 'manual':
      return 'operator';
    case 'generation':
    case 'delivery':
      return 'provider';
    case 'system':
    default:
      return 'system';
  }
};

const buildBaseFailureInfo = (
  partial: Pick<JobFailureInfo, 'reasonCode' | 'title' | 'userMessage' | 'retryable'> &
    Partial<Omit<JobFailureInfo, 'reasonCode' | 'title' | 'userMessage' | 'retryable'>>,
  context: FailureContext = {},
): JobFailureInfo => ({
  source: partial.source || defaultSourceForStage(partial.stage || 'system'),
  stage: partial.stage || 'system',
  reasonCode: partial.reasonCode,
  title: partial.title,
  userMessage: partial.userMessage,
  technicalMessage: partial.technicalMessage || null,
  retryable: partial.retryable,
  provider: partial.provider ?? context.provider ?? null,
  requestId: partial.requestId ?? context.requestId ?? null,
  outputId: partial.outputId ?? context.outputId ?? null,
  attemptNumber: partial.attemptNumber ?? context.attemptNumber ?? null,
  maxAttempts: partial.maxAttempts ?? context.maxAttempts ?? null,
  httpStatus: partial.httpStatus ?? null,
  providerStatus: partial.providerStatus ?? null,
  finishReason: partial.finishReason ?? null,
  promptFeedback: partial.promptFeedback ?? null,
  raw: partial.raw ?? null,
});

export class ProviderGenerationError extends Error {
  readonly provider: Provider;
  readonly reasonCode: JobFailureReasonCode;
  readonly stage: JobFailureStage;
  readonly requestId: string | null;
  readonly httpStatus: number | null;
  readonly providerStatus: string | null;
  readonly retryable: boolean;
  readonly raw: Record<string, unknown> | null;

  constructor(options: ProviderGenerationErrorOptions) {
    super(options.message);
    this.name = 'ProviderGenerationError';
    this.provider = options.provider;
    this.reasonCode = options.reasonCode;
    this.stage = options.stage || 'generation';
    this.requestId = options.requestId || null;
    this.httpStatus = options.httpStatus ?? null;
    this.providerStatus = options.providerStatus ?? null;
    this.retryable = options.retryable ?? true;
    this.raw = options.raw ?? null;
  }
}

export class GeminiAutoReviewError extends Error {
  readonly reasonCode: JobFailureReasonCode;
  readonly finishReason: string | null;
  readonly promptFeedback: Record<string, unknown> | null;
  readonly retryable: boolean;
  readonly raw: Record<string, unknown> | null;

  constructor(options: GeminiAutoReviewErrorOptions) {
    super(options.message);
    this.name = 'GeminiAutoReviewError';
    this.reasonCode = options.reasonCode;
    this.finishReason = options.finishReason || null;
    this.promptFeedback = options.promptFeedback || null;
    this.retryable = options.retryable ?? true;
    this.raw = options.raw ?? null;
  }
}

export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof ProviderGenerationError) {
    return {
      name: error.name,
      message: error.message,
      provider: error.provider,
      reasonCode: error.reasonCode,
      stage: error.stage,
      requestId: error.requestId,
      httpStatus: error.httpStatus,
      providerStatus: error.providerStatus,
      retryable: error.retryable,
      raw: error.raw,
      stack: error.stack,
    };
  }

  if (error instanceof GeminiAutoReviewError) {
    return {
      name: error.name,
      message: error.message,
      reasonCode: error.reasonCode,
      finishReason: error.finishReason,
      promptFeedback: error.promptFeedback,
      retryable: error.retryable,
      raw: error.raw,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: 'Error desconocido',
    raw: error,
  };
};

export const withFailureOutputId = (
  failureInfo: JobFailureInfo | null | undefined,
  outputId: string | null | undefined,
): JobFailureInfo | null => {
  if (!failureInfo) {
    return null;
  }

  return {
    ...failureInfo,
    outputId: outputId || failureInfo.outputId || null,
  };
};

export const toFailureSummary = (failureInfo: JobFailureInfo | null | undefined): string | null => {
  if (!failureInfo) {
    return null;
  }

  const title = normalizeMessage(failureInfo.title);
  const message = normalizeMessage(failureInfo.userMessage);
  if (!title) {
    return message;
  }

  if (!message || title === message) {
    return title;
  }

  return `${title}: ${message}`;
};

export const buildManualCancellationFailureInfo = ({
  userMessage,
  technicalMessage,
  retryable = false,
}: {
  userMessage: string;
  technicalMessage?: string | null;
  retryable?: boolean;
}): JobFailureInfo =>
  buildBaseFailureInfo({
    source: 'operator',
    stage: 'manual',
    reasonCode: 'manual_cancellation',
    title: 'Generación cancelada',
    userMessage,
    technicalMessage: technicalMessage || userMessage,
    retryable,
  });

export const buildGeminiRejectedFailureInfo = ({
  summary,
  attemptNumber,
  maxAttempts,
  provider,
  requestId,
  retryable,
  raw,
}: {
  summary: string;
  attemptNumber: number;
  maxAttempts: number;
  provider?: Provider | null;
  requestId?: string | null;
  retryable: boolean;
  raw?: Record<string, unknown> | null;
}): JobFailureInfo =>
  buildBaseFailureInfo(
    {
      source: 'gemini',
      stage: 'validation',
      reasonCode: 'gemini_rejected_output',
      title: retryable ? 'Gemini rechazó este intento' : 'Gemini rechazó la imagen',
      userMessage: normalizeMessage(summary) || 'Gemini rechazó la imagen generada.',
      technicalMessage: normalizeMessage(summary),
      retryable,
      provider: provider || null,
      requestId: requestId || null,
      raw: raw || null,
    },
    { attemptNumber, maxAttempts },
  );

export const buildJobTimeoutFailureInfo = ({
  retryable,
  attemptNumber,
  maxAttempts,
  provider,
  requestId,
}: {
  retryable: boolean;
  attemptNumber?: number | null;
  maxAttempts?: number | null;
  provider?: Provider | null;
  requestId?: string | null;
}): JobFailureInfo =>
  buildBaseFailureInfo(
    {
      source: 'system',
      stage: 'system',
      reasonCode: 'job_timeout',
      title: retryable ? 'El job se reencoló por timeout' : 'El job agotó sus reintentos por timeout',
      userMessage: retryable
        ? 'El trabajo excedió el tiempo máximo de ejecución y volvió a cola.'
        : 'El trabajo excedió el tiempo máximo de ejecución y agotó sus reintentos.',
      technicalMessage: retryable
        ? 'El worker perdió el tiempo máximo de ejecución antes de completar el job.'
        : 'El worker perdió el tiempo máximo de ejecución y el job quedó fallido al agotar reintentos.',
      retryable,
      provider: provider || null,
      requestId: requestId || null,
    },
    { attemptNumber, maxAttempts },
  );

export const buildJobFailureInfo = (error: unknown, context: FailureContext = {}): JobFailureInfo => {
  if (error instanceof ProviderGenerationError) {
    switch (error.reasonCode) {
      case 'provider_configuration_missing':
        return buildBaseFailureInfo(
          {
            source: 'system',
            stage: 'system',
            reasonCode: error.reasonCode,
            title: 'Configuración incompleta del proveedor',
            userMessage: 'Falta una credencial o parámetro necesario para usar este proveedor.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: false,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_rate_limited':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor limitó la solicitud',
            userMessage: 'El proveedor rechazó la generación por límite de uso o cuota.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: true,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_timeout':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor excedió el tiempo máximo',
            userMessage: 'El proveedor no terminó la generación dentro del tiempo esperado.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: true,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_missing_request_id':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor respondió sin identificador',
            userMessage: 'El proveedor aceptó la solicitud, pero no devolvió un identificador para rastrear la generación.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: true,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_failed_status':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor marcó la generación como fallida',
            userMessage: error.providerStatus
              ? `El proveedor devolvió el estado ${error.providerStatus}.`
              : 'El proveedor informó que la generación falló.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_no_image':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor no devolvió una imagen utilizable',
            userMessage: 'La generación terminó sin una imagen válida para guardar.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: true,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_image_download_failed':
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'No se pudo descargar la imagen generada',
            userMessage: 'El proveedor sí generó una imagen, pero no se pudo descargar para guardarla.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: true,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
      case 'provider_http_error':
      default:
        return buildBaseFailureInfo(
          {
            stage: error.stage,
            reasonCode: error.reasonCode,
            title: 'El proveedor devolvió un error',
            userMessage: 'El proveedor devolvió un error durante la generación.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            provider: error.provider,
            requestId: error.requestId,
            httpStatus: error.httpStatus,
            providerStatus: error.providerStatus,
            raw: error.raw,
          },
          context,
        );
    }
  }

  if (error instanceof GeminiAutoReviewError) {
    switch (error.reasonCode) {
      case 'gemini_timeout':
        return buildBaseFailureInfo(
          {
            source: 'gemini',
            stage: 'validation',
            reasonCode: error.reasonCode,
            title: 'Gemini excedió el tiempo máximo',
            userMessage: 'La validación automática tardó demasiado y no se pudo completar.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            finishReason: error.finishReason,
            promptFeedback: error.promptFeedback,
            raw: error.raw,
          },
          context,
        );
      case 'gemini_prompt_blocked':
        return buildBaseFailureInfo(
          {
            source: 'gemini',
            stage: 'validation',
            reasonCode: error.reasonCode,
            title: 'Gemini bloqueó la validación',
            userMessage: 'Gemini rechazó el prompt de validación y no devolvió un resultado interpretable.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: false,
            finishReason: error.finishReason,
            promptFeedback: error.promptFeedback,
            raw: error.raw,
          },
          context,
        );
      case 'gemini_finish_reason':
        return buildBaseFailureInfo(
          {
            source: 'gemini',
            stage: 'validation',
            reasonCode: error.reasonCode,
            title: 'Gemini terminó sin una respuesta válida',
            userMessage: error.finishReason
              ? `Gemini finalizó la validación con finish reason ${error.finishReason}.`
              : 'Gemini terminó la validación sin devolver texto utilizable.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            finishReason: error.finishReason,
            promptFeedback: error.promptFeedback,
            raw: error.raw,
          },
          context,
        );
      case 'gemini_empty_response':
        return buildBaseFailureInfo(
          {
            source: 'gemini',
            stage: 'validation',
            reasonCode: error.reasonCode,
            title: 'Gemini no devolvió texto utilizable',
            userMessage: 'La validación automática no produjo una respuesta legible.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            finishReason: error.finishReason,
            promptFeedback: error.promptFeedback,
            raw: error.raw,
          },
          context,
        );
      case 'gemini_api_error':
      default:
        return buildBaseFailureInfo(
          {
            source: 'gemini',
            stage: 'validation',
            reasonCode: error.reasonCode,
            title: 'Falló la validación con Gemini',
            userMessage: 'No se pudo completar la validación automática con Gemini.',
            technicalMessage: distinctMessage(error.message, null),
            retryable: error.retryable,
            finishReason: error.finishReason,
            promptFeedback: error.promptFeedback,
            raw: error.raw,
          },
          context,
        );
    }
  }

  const serialized = serializeError(error);
  const message = normalizeMessage(typeof serialized.message === 'string' ? serialized.message : null);

  if (isAbortError(error)) {
    return buildBaseFailureInfo(
      {
        source: 'system',
        stage: 'system',
        reasonCode: 'job_timeout',
        title: 'El job excedió el tiempo máximo',
        userMessage: 'La ejecución se interrumpió por timeout.',
        technicalMessage: message,
        retryable: true,
        raw: isRecord(serialized) ? serialized : null,
      },
      context,
    );
  }

  if (isMissingConfigMessage(message)) {
    return buildBaseFailureInfo(
      {
        source: 'system',
        stage: 'system',
        reasonCode: 'provider_configuration_missing',
        title: 'Configuración incompleta del proveedor',
        userMessage: 'Falta una credencial o parámetro necesario para completar la generación.',
        technicalMessage: message,
        retryable: false,
        raw: isRecord(serialized) ? serialized : null,
      },
      context,
    );
  }

  if (isRateLimitMessage(message)) {
    return buildBaseFailureInfo(
      {
        source: context.provider ? 'provider' : 'system',
        stage: context.provider ? 'generation' : 'system',
        reasonCode: 'provider_rate_limited',
        title: 'Límite de uso alcanzado',
        userMessage: 'El servicio rechazó la solicitud por cuota o rate limit.',
        technicalMessage: message,
        retryable: true,
        raw: isRecord(serialized) ? serialized : null,
      },
      context,
    );
  }

  return buildBaseFailureInfo(
    {
      source: context.provider ? 'provider' : 'system',
      stage: context.provider ? 'generation' : 'system',
      reasonCode: 'unknown',
      title: 'La generación falló',
      userMessage: 'Ocurrió un error no clasificado durante el procesamiento del job.',
      technicalMessage: message || 'Error desconocido.',
      retryable: true,
      raw: isRecord(serialized) ? serialized : null,
    },
    context,
  );
};
