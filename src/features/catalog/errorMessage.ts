import { Job } from '../../../shared/src/types';

const MESSAGE_KEYS = ['message', 'detail', 'error_description', 'title', 'reason'] as const;
const NOISY_MARKERS = ['"input"', '"image_urls"', '"prompt"', '"responseSummary"', '"stack"'] as const;
const MAX_FALLBACK_LENGTH = 220;

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

export const getCatalogJobErrorMessage = (job: Pick<Job, 'lastError' | 'traceability'>): string | null => {
  const candidates = [
    job.lastError,
    job.traceability?.lastProviderErrorMessage,
  ];

  for (const candidate of candidates) {
    const message = extractMessageFromUnknown(candidate);
    if (message) {
      return message;
    }
  }

  return null;
};
