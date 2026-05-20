import { applyGlobalTryOnPromptGuards, DEFAULT_TRY_ON_PROMPT } from '../../../shared/src/domain';
import {
  JobAutoReviewCriterion,
  JobAutoReviewMarketplaceData,
  JobAutoReviewVerdict,
  ModelIdentityTraits,
} from '../../../shared/src/types';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { GeminiAutoReviewError, serializeError } from '../errors/jobFailure';

interface ReviewImageAsset {
  bytes: Buffer;
  mimeType: string;
}

interface ReviewRequest {
  apiKey: string;
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
  userUid?: string | null;
  requestedPromptBase: string;
  promptBase: string;
  finalPrompt: string;
  modelIdentityTraitsSnapshot?: ModelIdentityTraits | null;
  attemptNumber: number;
  maxAttempts: number;
  poseReference: ReviewImageAsset;
  garmentReference: ReviewImageAsset;
  generatedImage: ReviewImageAsset;
  signal: AbortSignal;
}

interface GeminiResponsePart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiResponsePart[];
  };
  finishReason?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: Record<string, unknown>;
}

interface GeminiReviewPayload {
  verdict?: unknown;
  summary?: unknown;
  revisedPrompt?: unknown;
  criteria?: unknown;
  marketplaceData?: unknown;
}

export interface GeneratedImageReviewResult {
  model: string;
  verdict: JobAutoReviewVerdict;
  summary: string;
  reviewPrompt: string;
  revisedPrompt: string | null;
  criteria: JobAutoReviewCriterion[];
  marketplaceData: JobAutoReviewMarketplaceData;
}

const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['approved', 'rejected'],
      description: 'Use approved only when the image truly satisfies the requested result.',
    },
    summary: {
      type: 'string',
      description: 'Short explanation in Spanish of the overall decision.',
    },
    revisedPrompt: {
      type: 'string',
      description:
        'If verdict is rejected, return a corrected prompt for the next image generation attempt. Otherwise return an empty string.',
    },
    criteria: {
      type: 'array',
      minItems: 5,
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Short machine-friendly id like identity, background, pose, garment, logo, composition.',
          },
          label: {
            type: 'string',
            description: 'Human-readable criterion label in Spanish.',
          },
          passed: {
            type: 'boolean',
            description: 'Whether the criterion passed.',
          },
          notes: {
            type: 'string',
            description: 'Short explanation in Spanish.',
          },
        },
        required: ['key', 'label', 'passed', 'notes'],
      },
    },
    marketplaceData: {
      type: 'object',
      properties: {
        title: {
          type: ['string', 'null'],
          description: 'Marketplace title in Spanish. Return null when there is not enough evidence.',
        },
        description: {
          type: ['string', 'null'],
          description: 'Marketplace-style selling description in Spanish. Return null when there is not enough evidence.',
        },
        brand: {
          type: ['string', 'null'],
          description: 'Visible brand only. Return null if not clearly visible.',
        },
        gender: {
          type: ['string', 'null'],
          description: 'Target gender such as hombre, mujer or unisex. Return null if uncertain.',
        },
        garmentType: {
          type: ['string', 'null'],
          description: 'Specific garment type, for example camiseta, short, top deportivo, leggings.',
        },
        primaryColor: {
          type: ['string', 'null'],
          description: 'Primary visible color of the garment.',
        },
        sport: {
          type: ['string', 'null'],
          description: 'Sport or use case if it looks like sportswear, for example gym, running, ciclismo. Otherwise null.',
        },
        isSportswear: {
          type: ['boolean', 'null'],
          description: 'True if the garment is sportswear, false if it is not, null if unclear.',
        },
      },
      required: ['title', 'description', 'brand', 'gender', 'garmentType', 'primaryColor', 'sport', 'isSportswear'],
    },
  },
  required: ['verdict', 'summary', 'revisedPrompt', 'criteria', 'marketplaceData'],
};

const sanitizeText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const sanitizeCriteria = (value: unknown): JobAutoReviewCriterion[] => {
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

const sanitizeMarketplaceData = (value: unknown): JobAutoReviewMarketplaceData => {
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

const REVIEW_IDENTITY_TRAIT_LABELS: Record<keyof ModelIdentityTraits, string> = {
  sex: 'Biological sex / presentation anchor',
  age: 'Apparent age anchor',
  skin: 'Skin tone anchor',
  hairColor: 'Hair color anchor',
  hairLength: 'Hair length anchor',
  build: 'Body build anchor',
};

const buildIdentityAnchorLines = (identityTraits?: ModelIdentityTraits | null): string[] => {
  if (!identityTraits) {
    return [];
  }

  return (Object.entries(REVIEW_IDENTITY_TRAIT_LABELS) as Array<[keyof ModelIdentityTraits, string]>)
    .map(([key, label]) => {
      const value = identityTraits[key];
      return typeof value === 'string' && value.trim()
        ? `- ${label}: ${value.trim()}`
        : null;
    })
    .filter((entry): entry is string => Boolean(entry));
};

const buildReviewPrompt = ({
  requestedPromptBase,
  promptBase,
  finalPrompt,
  modelIdentityTraitsSnapshot,
  attemptNumber,
  maxAttempts,
}: Pick<
  ReviewRequest,
  'requestedPromptBase' | 'promptBase' | 'finalPrompt' | 'modelIdentityTraitsSnapshot' | 'attemptNumber' | 'maxAttempts'
>): string => {
  const originalPrompt = applyGlobalTryOnPromptGuards(requestedPromptBase.trim() || DEFAULT_TRY_ON_PROMPT);
  const currentPrompt = applyGlobalTryOnPromptGuards(promptBase.trim() || DEFAULT_TRY_ON_PROMPT);
  const reviewedFinalPrompt = applyGlobalTryOnPromptGuards(finalPrompt.trim() || DEFAULT_TRY_ON_PROMPT);
  const identityAnchorLines = buildIdentityAnchorLines(modelIdentityTraitsSnapshot);

  return [
    'You are an expert evaluator of AI-generated fashion catalog images for marketplaces such as Shein and TikTok Shop.',
    'You will receive three images in this order:',
    '1) Model/base pose image',
    '2) Garment reference image',
    '3) Generated result image',
    'Your task is to evaluate whether the generated result correctly follows the original intent and accurately represents the garment.',
    '--------------------------------',
    'EVALUATION CRITERIA (PRIORITY ORDER)',
    '--------------------------------',
    '1. GARMENT FIDELITY (CRITICAL — HIGHEST PRIORITY)',
    'Strictly verify:',
    '- Garment type (e.g., polo, t-shirt, dress, etc.)',
    '- Primary color (MUST match the reference)',
    '- Secondary colors and color distribution',
    '- Patterns (stripes, prints, graphics, etc.)',
    '❗ HARD FAILURE CONDITIONS:',
    '- If the primary color is incorrect → FAIL',
    '- If the color distribution is significantly altered → FAIL',
    '- If patterns (e.g., stripes) are missing, misaligned, or incorrect → FAIL',
    '--------------------------------',
    '2. BRANDING / LOGOS / GRAPHICS (CRITICAL — HIGHEST PRIORITY)',
    '- Check if logos, text, or graphics visible in the reference are present in the result',
    '- Verify correct placement, size, and orientation',
    '- Distinguish true exterior branding from internal construction details such as neck labels, inside tags, care labels, or size labels',
    '- Internal labels or tags must stay hidden unless the reference clearly shows they are intentionally visible on the outside',
    '❗ HARD FAILURE CONDITIONS:',
    '- Missing logo when visible in reference → FAIL',
    '- Logo placed in incorrect position → FAIL',
    '- Distorted, warped, or altered logo → FAIL',
    '- Logo added where it does NOT exist in the reference → FAIL',
    '- Logo generated on areas not visible in the reference (e.g., back when only front is shown) → FAIL',
    '- Internal label or inner tag rendered as an exterior patch, badge, or visible front branding → FAIL',
    '- Inner collar or neckline label moved to the outside of the garment → FAIL',
    '--------------------------------',
    '3. MODEL IDENTITY (CRITICAL — HIGHEST PRIORITY)',
    '- The generated person must remain the exact same individual shown in the base pose image',
    '- Verify identity consistency across face, skin tone, apparent age, body proportions, and visible hair identity',
    '- Hair color, hair length, and hair silhouette must stay consistent with the selected model unless the pose image clearly hides them',
    '- Do NOT approve if the result looks like a different person even if the garment is correct',
    '❗ HARD FAILURE CONDITIONS:',
    '- Different face or facial structure → FAIL',
    '- Different apparent age group → FAIL',
    '- Different skin tone without a lighting-only explanation → FAIL',
    '- Different hair color, hair length, or visible hair identity → FAIL',
    '- Any clear identity drift toward another model/person → FAIL',
    '--------------------------------',
    '4. POSE / BODY ORIENTATION (MODERATELY STRICT)',
    '- The general orientation must match:',
    '  • If front-facing → result must be front-facing',
    '  • If back-facing → result must be back-facing',
    '  • If looking at camera → must maintain gaze direction',
    '- Small variations in posture, framing, or zoom are acceptable',
    '❗ FAILURE CONDITIONS:',
    '- Incorrect facing direction (e.g., back → front) → FAIL',
    '- Incorrect gaze direction (e.g., looking away instead of at camera) → FAIL',
    '--------------------------------',
    '5. BACKGROUND (RELAXED)',
    '- Background does NOT need to be identical',
    '- Must maintain similar tone, lighting style, or general environment',
    '- Approximate similarity (~70%) is acceptable',
    '--------------------------------',
    '6. OVERALL CONSISTENCY',
    '- Image should be photorealistic',
    '- No major artifacts, distortions, or inconsistencies',
    '--------------------------------',
    'FINAL DECISION RULE',
    '--------------------------------',
    '- If ANY critical failure occurs in:',
    '  • Garment fidelity',
    '  • Branding / logos',
    '  • Model identity',
    '→ The result MUST be marked as NOT APPROVED',
    '--------------------------------',
    'REVISED PROMPT (ONLY IF FAILED)',
    '--------------------------------',
    'If the result FAILS:',
    '- Generate a corrected prompt in English',
    '- The prompt must:',
    '  • Be self-contained',
    '  • Focus ONLY on fixing the detected issues',
    '  • Explicitly preserve the exact same person from the base pose image',
    '  • Reinforce the same face, skin tone, apparent age, body proportions, hair color, and hair length',
    '  • Reinforce color accuracy and exact logo placement',
    '  • Explicitly forbid logo hallucination',
    '  • Explicitly keep internal labels, care tags, and inside neck labels hidden unless they are clearly exterior in the reference',
    '  • Preserve pose, identity, lighting, and background',
    '  • Keep any non-conflicting brand or commercial styling from the original prompt',
    'If the result PASSES:',
    '- revisedPrompt must be an empty string ""',
    '--------------------------------',
    'COMMERCIAL DATA EXTRACTION',
    '--------------------------------',
    'Extract structured product data from the garment reference image:',
    '- title (Spanish, commercial, clear)',
    '- description (Spanish, persuasive but accurate)',
    '- brand (ONLY if clearly visible, otherwise null)',
    '- gender (ONLY if clearly inferable, otherwise null)',
    '- garmentType (e.g., polo, t-shirt, dress)',
    '- primaryColor',
    '- isSportswear (true/false)',
    '- sport (ONLY if clearly sportswear, otherwise null)',
    '❗ DO NOT GUESS:',
    'If information is not clearly visible → return null',
    '--------------------------------',
    ...(identityAnchorLines.length > 0
      ? [
          'IDENTITY ANCHORS FROM THE SELECTED MODEL',
          ...identityAnchorLines,
          '--------------------------------',
        ]
      : []),
    'Use the pose image as the primary identity source of truth even if some traits above are missing.',
    '--------------------------------',
    'ATTEMPT CONTEXT',
    '--------------------------------',
    `Current attempt: ${attemptNumber} of ${maxAttempts}`,
    'Original user prompt:',
    originalPrompt,
    'Prompt used in this attempt:',
    currentPrompt,
    'Final prompt sent to provider:',
    reviewedFinalPrompt,
    '--------------------------------',
    'OUTPUT FORMAT',
    '--------------------------------',
    'Return ONLY valid JSON following the required schema.',
    'Do not include explanations outside the JSON.',
  ].join('\n\n');
};

const extractResponseText = (payload: GeminiGenerateContentResponse): string => {
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

export const reviewGeneratedImageWithGemini = async (request: ReviewRequest): Promise<GeneratedImageReviewResult> => {
  const reviewPrompt = buildReviewPrompt(request);
  try {
    const { payload } = await callGeminiGenerateContent<GeminiGenerateContentResponse>({
      apiKey: request.apiKey,
      model: request.model,
      signal: request.signal,
      context: {
        feature: 'image_review',
        batchId: request.batchId,
        jobId: request.jobId,
        clientId: request.clientId,
        clientNameSnapshot: request.clientNameSnapshot,
        modelId: request.modelId,
        modelNameSnapshot: request.modelNameSnapshot,
        garmentId: request.garmentId,
        garmentName: request.garmentName,
        poseId: request.poseId,
        userUid: request.userUid,
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: reviewPrompt },
              {
                inline_data: {
                  mime_type: request.poseReference.mimeType,
                  data: request.poseReference.bytes.toString('base64'),
                },
              },
              {
                inline_data: {
                  mime_type: request.garmentReference.mimeType,
                  data: request.garmentReference.bytes.toString('base64'),
                },
              },
              {
                inline_data: {
                  mime_type: request.generatedImage.mimeType,
                  data: request.generatedImage.bytes.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: REVIEW_RESPONSE_SCHEMA,
        },
      },
    });
    const reviewText = extractResponseText(payload);
    const parsed = JSON.parse(reviewText) as GeminiReviewPayload;
    const criteria = sanitizeCriteria(parsed.criteria);
    const verdict: JobAutoReviewVerdict = parsed.verdict === 'approved' ? 'approved' : 'rejected';
    const summary = sanitizeText(
      parsed.summary,
      verdict === 'approved'
        ? 'La imagen cumple con los criterios solicitados.'
        : 'La imagen no cumple con los criterios solicitados.',
    );
    const revisedPrompt = sanitizeText(parsed.revisedPrompt, '');
    const marketplaceData = sanitizeMarketplaceData(parsed.marketplaceData);

    return {
      model: request.model,
      verdict,
      summary,
      reviewPrompt,
      revisedPrompt: verdict === 'rejected' && revisedPrompt ? revisedPrompt : null,
      criteria,
      marketplaceData,
    };
  } catch (error) {
    if (error instanceof GeminiAutoReviewError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new GeminiAutoReviewError({
        reasonCode: 'gemini_empty_response',
        retryable: true,
        message: 'Gemini devolvió una respuesta no parseable como JSON.',
        raw: serializeError(error),
      });
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new GeminiAutoReviewError({
        reasonCode: 'gemini_timeout',
        retryable: true,
        message: 'La validación con Gemini excedió el tiempo máximo.',
        raw: serializeError(error),
      });
    }

    throw new GeminiAutoReviewError({
      reasonCode: 'gemini_api_error',
      retryable: true,
      message: error instanceof Error ? error.message : 'Gemini falló durante la validación.',
      raw: serializeError(error),
    });
  }
};
