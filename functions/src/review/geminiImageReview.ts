import { AutomationBudgetError } from '../automation/budget';
import type { GeminiUsageContext } from '../analytics/geminiUsage';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import {
  JobAutoReviewCriterion,
  JobAutoReviewMarketplaceData,
  JobAutoReviewVerdict,
  ModelIdentityTraits,
} from '../../../shared/src/types';
import { GeminiAutoReviewError, serializeError } from '../errors/jobFailure';
import { GeminiGenerateContentResponse, parseReviewResponse } from './geminiImageReview.parse';
import { selectReviewPrompt, usesApprovedReviewPrompt } from './geminiImageReview.prompts';
import { buildReviewGenerationConfig } from './geminiImageReview.schema';

// Gemini review of a generated image: prompt (geminiImageReview.prompts.ts) -> Gemini call with the response schema
// (geminiImageReview.schema.ts) -> parsing and verdict (geminiImageReview.parse.ts).
export { buildApprovedTryOnReviewPrompt } from './geminiImageReview.prompts';

interface ReviewImageAsset {
  bytes: Buffer;
  mimeType: string;
}

export interface ReviewRequest {
  imageEditInstructions?: string;
  photoTask?: import('../../../shared/src/types').PhotoTask;
  automation?: GeminiUsageContext['automation'];
  exactAutomationPrompt?: boolean;
  promptFormat?: 'approved-try-on-v1';
  generationKind?: 'garment' | 'product';
  productQuantity?: import('../../../shared/src/types/productGeneration').ProductQuantity;
  productReferences?: ReviewImageAsset[];
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

export interface GeneratedImageReviewResult {
  photoValidation?: import('../../../shared/src/types').JobOutput['photoValidation'];
  model: string;
  verdict: JobAutoReviewVerdict;
  summary: string;
  reviewPrompt: string;
  revisedPrompt: string | null;
  criteria: JobAutoReviewCriterion[];
  marketplaceData: JobAutoReviewMarketplaceData;
}

const toInlineImage = (image: ReviewImageAsset) => ({
  inline_data: { mime_type: image.mimeType, data: image.bytes.toString('base64') },
});

/** Reference images first (product/automation references, or pose + garment), the generated image last. */
const buildReviewParts = (request: ReviewRequest, reviewPrompt: string) => [
  { text: reviewPrompt },
  ...(request.productReferences || [request.poseReference, request.garmentReference]).map(toInlineImage),
  toInlineImage(request.generatedImage),
];

const buildUsageContext = (request: ReviewRequest): Omit<GeminiUsageContext, 'model'> => ({
  ...(request.automation ? { automation: request.automation } : {}),
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
});

/** Budget and review errors pass through; anything else becomes a classified GeminiAutoReviewError. */
const toGeminiReviewError = (error: unknown): unknown => {
  if (error instanceof AutomationBudgetError || error instanceof GeminiAutoReviewError) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return new GeminiAutoReviewError({
      reasonCode: 'gemini_empty_response',
      retryable: true,
      message: 'Gemini devolvió una respuesta no parseable como JSON.',
      raw: serializeError(error),
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new GeminiAutoReviewError({
      reasonCode: 'gemini_timeout',
      retryable: true,
      message: 'La validación con Gemini excedió el tiempo máximo.',
      raw: serializeError(error),
    });
  }

  return new GeminiAutoReviewError({
    reasonCode: 'gemini_api_error',
    retryable: true,
    message: error instanceof Error ? error.message : 'Gemini falló durante la validación.',
    raw: serializeError(error),
  });
};

export const reviewGeneratedImageWithGemini = async (request: ReviewRequest): Promise<GeneratedImageReviewResult> => {
  const usesApprovedPrompt = usesApprovedReviewPrompt(request);
  const reviewPrompt = selectReviewPrompt(request);
  try {
    const { payload } = await callGeminiGenerateContent<GeminiGenerateContentResponse>({
      apiKey: request.apiKey,
      model: request.model,
      signal: request.signal,
      context: buildUsageContext(request),
      body: {
        contents: [{ role: 'user', parts: buildReviewParts(request, reviewPrompt) }],
        generationConfig: buildReviewGenerationConfig(request, usesApprovedPrompt),
      },
    });
    return parseReviewResponse(request, payload, { reviewPrompt, usesApprovedPrompt });
  } catch (error) {
    throw toGeminiReviewError(error);
  }
};
