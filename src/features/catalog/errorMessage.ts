import { Job, JobFailureInfo, JobOutput } from '../../../shared/src/types';

const MESSAGE_KEYS = ['message', 'detail', 'error_description', 'title', 'reason'] as const;
const NOISY_MARKERS = ['"input"', '"image_urls"', '"prompt"', '"responseSummary"', '"stack"'] as const;
const MAX_FALLBACK_LENGTH = 220;

const STAGE_LABELS: Record<JobFailureInfo['stage'], string> = {
  generation: 'Generacion',
  validation: 'Validacion Gemini',
  delivery: 'Descarga del resultado',
  manual: 'Cancelacion manual',
  system: 'Sistema',
};

const SOURCE_LABELS: Record<JobFailureInfo['source'], string> = {
  provider: 'Proveedor',
  gemini: 'Gemini',
  operator: 'Operador',
  system: 'Sistema',
};

type FailureHost = Pick<Job, 'lastError' | 'traceability' | 'failureInfo' | 'latestAutoReview'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeInlineMessage = (value: string): string | null => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return null;
  }

  const noisyMarkerIndex = NOISY_MARKERS.reduce((earliest, marker) => {
    const markerIndex = singleLine.indexOf(marker);
    if (markerIndex === -1) {
      return earliest;
    }

    return earliest === -1 ? markerIndex : Math.min(earliest, markerIndex);
  }, -1);

  const cleaned = (noisyMarkerIndex >= 0 ? singleLine.slice(0, noisyMarkerIndex) : singleLine)
    .replace(/[\s,:;.-]+$/g, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.length > MAX_FALLBACK_LENGTH ? `${cleaned.slice(0, MAX_FALLBACK_LENGTH - 1)}…` : cleaned;
};

const parseJsonCandidate = (value: string): unknown | null => {
  const candidates = [value];
  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(value.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
};

const extractMessageFromUnknown = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const parsed = parseJsonCandidate(value);
    if (parsed !== null) {
      const nestedMessage = extractMessageFromUnknown(parsed);
      if (nestedMessage) {
        return nestedMessage;
      }
    }

    const regexMatches = [
      /"message"\s*:\s*"([^"]+)"/i,
      /"detail"\s*:\s*"([^"]+)"/i,
      /"reason"\s*:\s*"([^"]+)"/i,
    ];

    for (const matcher of regexMatches) {
      const match = value.match(matcher);
      if (match?.[1]) {
        const normalized = normalizeInlineMessage(match[1]);
        if (normalized) {
          return normalized;
        }
      }
    }

    return normalizeInlineMessage(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractMessageFromUnknown(entry);
      if (message) {
        return message;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of MESSAGE_KEYS) {
    const message = extractMessageFromUnknown(value[key]);
    if (message) {
      return message;
    }
  }

  if (isRecord(value.error)) {
    const nestedErrorMessage = extractMessageFromUnknown(value.error);
    if (nestedErrorMessage) {
      return nestedErrorMessage;
    }
  }

  return null;
};

const buildLegacyFailureInfo = (message: string): JobFailureInfo => {
  const isCancellation = /cancelad[oa]/i.test(message);
  return {
    source: isCancellation ? 'operator' : 'system',
    stage: isCancellation ? 'manual' : 'system',
    reasonCode: isCancellation ? 'manual_cancellation' : 'legacy_error',
    title: isCancellation ? 'Generacion cancelada' : 'La generacion fallo',
    userMessage: message,
    technicalMessage: message,
    retryable: !isCancellation,
    provider: null,
    requestId: null,
    outputId: null,
    attemptNumber: null,
    maxAttempts: null,
    httpStatus: null,
    providerStatus: null,
    finishReason: null,
    promptFeedback: null,
    raw: null,
    occurredAt: null,
  };
};

const buildRejectedOutputFallback = (output: Pick<JobOutput, 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'>): JobFailureInfo | null => {
  if (output.autoReview?.verdict !== 'rejected') {
    return null;
  }

  return {
    source: 'gemini',
    stage: 'validation',
    reasonCode: 'gemini_rejected_output',
    title: 'Gemini rechazo esta imagen',
    userMessage: output.autoReview.summary,
    technicalMessage: output.autoReview.summary,
    retryable: false,
    provider: output.provider,
    requestId: output.requestId || null,
    outputId: null,
    attemptNumber: output.generationAttempt || output.autoReview.attemptNumber || null,
    maxAttempts: null,
    httpStatus: null,
    providerStatus: null,
    finishReason: null,
    promptFeedback: null,
    raw: {
      criteria: output.autoReview.criteria,
      revisedPrompt: output.autoReview.revisedPrompt,
    },
    occurredAt: output.autoReview.reviewedAt,
  };
};

export const getOutputFailureInfo = (
  output: Pick<JobOutput, 'failureInfo' | 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'> | null | undefined,
): JobFailureInfo | null => {
  if (!output) {
    return null;
  }

  return output.failureInfo || buildRejectedOutputFallback(output);
};

export const getJobFailureInfo = (
  job: FailureHost,
  output?: Pick<JobOutput, 'failureInfo' | 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'> | null,
): JobFailureInfo | null => {
  const rejectedOutputFallback = getOutputFailureInfo(output);
  if (rejectedOutputFallback) {
    return rejectedOutputFallback;
  }

  if (job.failureInfo) {
    return job.failureInfo;
  }

  if (job.latestAutoReview?.verdict === 'rejected') {
    return {
      source: 'gemini',
      stage: 'validation',
      reasonCode: 'gemini_rejected_output',
      title: 'Gemini rechazo esta imagen',
      userMessage: job.latestAutoReview.summary,
      technicalMessage: job.latestAutoReview.summary,
      retryable: false,
      provider: null,
      requestId: null,
      outputId: null,
      attemptNumber: job.latestAutoReview.attemptNumber || null,
      maxAttempts: null,
      httpStatus: null,
      providerStatus: null,
      finishReason: null,
      promptFeedback: null,
      raw: {
        criteria: job.latestAutoReview.criteria,
        revisedPrompt: job.latestAutoReview.revisedPrompt,
      },
      occurredAt: job.latestAutoReview.reviewedAt,
    };
  }

  const candidates = [
    job.lastError,
    job.traceability?.lastProviderErrorMessage,
  ];

  for (const candidate of candidates) {
    const message = extractMessageFromUnknown(candidate);
    if (message) {
      return buildLegacyFailureInfo(message);
    }
  }

  return null;
};

export const getCatalogJobErrorMessage = (
  job: FailureHost,
  output?: Pick<JobOutput, 'failureInfo' | 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'> | null,
): string | null => {
  const failureInfo = getJobFailureInfo(job, output);
  if (!failureInfo) {
    return null;
  }

  return failureInfo.userMessage || failureInfo.technicalMessage || failureInfo.title;
};

export const getCatalogJobFailureTitle = (
  job: FailureHost,
  output?: Pick<JobOutput, 'failureInfo' | 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'> | null,
): string | null => getJobFailureInfo(job, output)?.title || null;

export const getCatalogJobFailureTechnicalMessage = (
  job: FailureHost,
  output?: Pick<JobOutput, 'failureInfo' | 'autoReview' | 'requestId' | 'provider' | 'generationAttempt'> | null,
): string | null => {
  const failureInfo = getJobFailureInfo(job, output);
  if (!failureInfo) {
    return null;
  }

  if (failureInfo.technicalMessage && failureInfo.technicalMessage !== failureInfo.userMessage) {
    return failureInfo.technicalMessage;
  }

  if (failureInfo.finishReason) {
    return `Finish reason: ${failureInfo.finishReason}`;
  }

  return null;
};

export const getCatalogJobFailureFacts = (failureInfo: JobFailureInfo | null): Array<{ label: string; value: string }> => {
  if (!failureInfo) {
    return [];
  }

  const facts = [
    { label: 'Origen', value: SOURCE_LABELS[failureInfo.source] },
    { label: 'Etapa', value: STAGE_LABELS[failureInfo.stage] },
    failureInfo.provider ? { label: 'Proveedor', value: failureInfo.provider } : null,
    failureInfo.requestId ? { label: 'Request ID', value: failureInfo.requestId } : null,
    failureInfo.attemptNumber
      ? {
          label: 'Intento',
          value: failureInfo.maxAttempts
            ? `${failureInfo.attemptNumber}/${failureInfo.maxAttempts}`
            : `${failureInfo.attemptNumber}`,
        }
      : null,
    failureInfo.finishReason ? { label: 'Finish reason', value: failureInfo.finishReason } : null,
    failureInfo.providerStatus ? { label: 'Estado provider', value: failureInfo.providerStatus } : null,
    typeof failureInfo.httpStatus === 'number' ? { label: 'HTTP', value: `${failureInfo.httpStatus}` } : null,
  ];

  return facts.filter((fact): fact is { label: string; value: string } => Boolean(fact));
};

export const isFailureCancellation = (failureInfo: JobFailureInfo | null): boolean =>
  Boolean(failureInfo && failureInfo.reasonCode === 'manual_cancellation');
