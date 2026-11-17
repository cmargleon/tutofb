import { JobAutoReviewCriterion, JobAutoReviewMarketplaceData, JobAutoReviewVerdict } from '../../../shared/src/types';
import { GeminiAutoReviewError } from '../errors/jobFailure';
import type { GeneratedImageReviewResult, ReviewRequest } from './geminiImageReview';

// Parsing of Gemini's answer: tolerant sanitizing of every field and the verdict rules on top of Gemini's verdict.

interface GeminiResponsePart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiResponsePart[];
  };
  finishReason?: string;
}

export interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: Record<string, unknown>;
}

export interface GeminiReviewPayload {
  photoValidation?: {
    fidelity: boolean;
    destinations: Array<{ channel: string; position: number; passed: boolean; notes: string }>;
  };
  verdict?: unknown;
  summary?: unknown;
  revisedPrompt?: unknown;
  criteria?: unknown;
  marketplaceData?: unknown;
}

export const sanitizeText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const sanitizeCriteria = (value: unknown): JobAutoReviewCriterion[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const item = entry as Record<string, unknown>;
      const key = sanitizeText(item.key, `criterion_${index + 1}`);
      const label = sanitizeText(item.label, `Criterio ${index + 1}`);
      const passed = typeof item.passed === 'boolean' ? item.passed : false;
      const notes = sanitizeText(item.notes, 'Sin detalle adicional.');
      return { key, label, passed, notes };
    })
    .filter((entry): entry is JobAutoReviewCriterion => Boolean(entry));
};

const sanitizeNullableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const sanitizeMarketplaceData = (value: unknown): JobAutoReviewMarketplaceData => {
  if (!value || typeof value !== 'object') {
    return {
      title: null,
      description: null,
      brand: null,
      gender: null,
      garmentType: null,
      primaryColor: null,
      sport: null,
      isSportswear: null,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    title: sanitizeNullableText(record.title),
    description: sanitizeNullableText(record.description),
    brand: sanitizeNullableText(record.brand),
    gender: sanitizeNullableText(record.gender),
    garmentType: sanitizeNullableText(record.garmentType),
    primaryColor: sanitizeNullableText(record.primaryColor),
    sport: sanitizeNullableText(record.sport),
    isSportswear: typeof record.isSportswear === 'boolean' ? record.isSportswear : null,
  };
};

export const extractResponseText = (payload: GeminiGenerateContentResponse): string => {
  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || '')
    .find((value) => value.trim().length > 0);

  if (text && text.trim()) {
    return text.trim();
  }

  const finishReason = payload.candidates?.[0]?.finishReason;
  if (finishReason) {
    throw new GeminiAutoReviewError({
      reasonCode: 'gemini_finish_reason',
      finishReason,
      retryable: finishReason.toUpperCase() !== 'SAFETY',
      message: `Gemini no devolvio texto utilizable. Finish reason: ${finishReason}.`,
      promptFeedback: payload.promptFeedback || null,
    });
  }

  throw new GeminiAutoReviewError({
    reasonCode: 'gemini_prompt_blocked',
    retryable: false,
    message: `Gemini no devolvio texto utilizable. Prompt feedback: ${JSON.stringify(payload.promptFeedback || {})}`,
    promptFeedback: payload.promptFeedback || null,
  });
};

type PhotoTask = NonNullable<ReviewRequest['photoTask']>;
type PhotoValidation = NonNullable<GeneratedImageReviewResult['photoValidation']>;
type ReportedDestination = NonNullable<GeminiReviewPayload['photoValidation']>['destinations'][number];

const REQUIRED_PRODUCT_CRITERIA = ['identity', 'colors', 'logos', 'parts', 'geometry', 'artifacts', 'scene'];

const isSameDestination = (reported: ReportedDestination, planned: PhotoTask['destinations'][number]) =>
  reported.channel === planned.channel && reported.position === planned.position;

/** Every planned destination must be reported exactly once, with a boolean `passed`. */
const hasCompletePhotoValidation = (photoTask: PhotoTask, parsed: GeminiReviewPayload): boolean => {
  const reported = parsed.photoValidation;
  if (typeof reported?.fidelity !== 'boolean' || !Array.isArray(reported.destinations)) return false;
  return photoTask.destinations.every(planned => reported.destinations
    .filter(v => isSameDestination(v, planned) && typeof v.passed === 'boolean').length === 1);
};

/** Validates and normalizes the per-destination answer for photo plans; undefined for any other job. */
export const parsePhotoValidation = (
  photoTask: PhotoTask | undefined,
  parsed: GeminiReviewPayload,
): PhotoValidation | undefined => {
  if (!photoTask) return undefined;
  if (!hasCompletePhotoValidation(photoTask, parsed)) {
    throw new GeminiAutoReviewError({
      reasonCode: 'gemini_empty_response',
      retryable: true,
      message: 'La revisión no devolvió validaciones estructuradas de todos los destinos.',
    });
  }
  const reported = parsed.photoValidation!;
  return {
    fidelity: reported.fidelity,
    destinations: photoTask.destinations.map(planned => {
      const match = reported.destinations.find(v => isSameDestination(v, planned))!;
      return {
        channel: planned.channel,
        position: planned.position,
        passed: match.passed,
        notes: sanitizeText(match.notes, 'Destino sin verificar'),
      };
    }),
  };
};

/** Non-exact product reviews also require every product criterion to be present and passing. */
const productCriteriaPass = (request: ReviewRequest, criteria: JobAutoReviewCriterion[]): boolean => {
  if (request.exactAutomationPrompt === true || request.generationKind !== 'product') return true;
  return REQUIRED_PRODUCT_CRITERIA.every(key => criteria.some(criterion => criterion.key === key && criterion.passed));
};

/** Approved-prompt reviews require at least one criterion and all of them passing. */
const approvedPromptCriteriaPass = (usesApprovedPrompt: boolean, criteria: JobAutoReviewCriterion[]): boolean =>
  !usesApprovedPrompt || (criteria.length > 0 && criteria.every(criterion => criterion.passed));

/**
 * Photo plans are judged per destination: the article must be faithful and at least one destination must pass,
 * whatever Gemini's overall verdict says (a cover can fail one channel and serve another). Every other review
 * needs Gemini's approval plus the criteria rules above.
 */
export const decideVerdict = ({
  request,
  parsed,
  criteria,
  usesApprovedPrompt,
  photoValidation,
}: {
  request: ReviewRequest;
  parsed: GeminiReviewPayload;
  criteria: JobAutoReviewCriterion[];
  usesApprovedPrompt: boolean;
  photoValidation: PhotoValidation | undefined;
}): JobAutoReviewVerdict => {
  if (photoValidation) {
    return photoValidation.fidelity && photoValidation.destinations.some(d => d.passed) ? 'approved' : 'rejected';
  }
  const approved = parsed.verdict === 'approved'
    && productCriteriaPass(request, criteria)
    && approvedPromptCriteriaPass(usesApprovedPrompt, criteria);
  return approved ? 'approved' : 'rejected';
};

const defaultSummary = (verdict: JobAutoReviewVerdict): string => (verdict === 'approved'
  ? 'La imagen cumple con los criterios solicitados.'
  : 'La imagen no cumple con los criterios solicitados.');

export const parseReviewResponse = (
  request: ReviewRequest,
  payload: GeminiGenerateContentResponse,
  { reviewPrompt, usesApprovedPrompt }: { reviewPrompt: string; usesApprovedPrompt: boolean },
): GeneratedImageReviewResult => {
  const parsed = JSON.parse(extractResponseText(payload)) as GeminiReviewPayload;
  const criteria = sanitizeCriteria(parsed.criteria);
  const photoValidation = parsePhotoValidation(request.photoTask, parsed);
  const verdict = decideVerdict({ request, parsed, criteria, usesApprovedPrompt, photoValidation });
  const revisedPrompt = sanitizeText(parsed.revisedPrompt, '');

  return {
    ...(photoValidation ? { photoValidation } : {}),
    model: request.model,
    verdict,
    summary: sanitizeText(parsed.summary, defaultSummary(verdict)),
    reviewPrompt,
    revisedPrompt: verdict === 'rejected' && revisedPrompt ? revisedPrompt : null,
    criteria,
    marketplaceData: sanitizeMarketplaceData(parsed.marketplaceData),
  };
};
