import type { ReviewRequest } from './geminiImageReview';

// JSON schema Gemini must follow. Photo plans add a mandatory photoValidation block; approved-prompt reviews accept
// a single criterion because the approved prompt defines how many requirements there are.

export const REVIEW_RESPONSE_SCHEMA = {
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
        'If verdict is rejected, return a corrected prompt for the next image generation attempt. Otherwise return ' +
          'an empty string.',
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
          description:
            'Marketplace-style selling description in Spanish. Return null when there is not enough evidence.',
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
          description:
            'Sport or use case if it looks like sportswear, for example gym, running, ciclismo. Otherwise null.',
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

type PhotoTask = NonNullable<ReviewRequest['photoTask']>;

const buildPhotoValidationSchema = (photoTask: PhotoTask) => ({
  type: 'object',
  properties: {
    fidelity: { type: 'boolean' },
    destinations: {
      type: 'array',
      minItems: photoTask.destinations.length,
      maxItems: photoTask.destinations.length,
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: [...new Set(photoTask.destinations.map(d => d.channel))] },
          position: { type: 'integer' },
          passed: { type: 'boolean' },
          notes: { type: 'string' },
        },
        required: ['channel', 'position', 'passed', 'notes'],
      },
    },
  },
  required: ['fidelity', 'destinations'],
});

export const buildReviewResponseSchema = (request: ReviewRequest, usesApprovedPrompt: boolean) => {
  if (request.photoTask) {
    return {
      ...REVIEW_RESPONSE_SCHEMA,
      properties: {
        ...REVIEW_RESPONSE_SCHEMA.properties,
        photoValidation: buildPhotoValidationSchema(request.photoTask),
      },
      required: [...REVIEW_RESPONSE_SCHEMA.required, 'photoValidation'],
    };
  }
  if (usesApprovedPrompt) {
    return {
      ...REVIEW_RESPONSE_SCHEMA,
      properties: {
        ...REVIEW_RESPONSE_SCHEMA.properties,
        criteria: { ...REVIEW_RESPONSE_SCHEMA.properties.criteria, minItems: 1 },
      },
    };
  }
  return REVIEW_RESPONSE_SCHEMA;
};

/** Exact automation prompts and photo plans produce longer answers and get a larger output budget. */
export const buildReviewGenerationConfig = (request: ReviewRequest, usesApprovedPrompt: boolean) => ({
  ...(request.exactAutomationPrompt || request.photoTask ? { maxOutputTokens: 4096 } : {}),
  responseMimeType: 'application/json',
  responseJsonSchema: buildReviewResponseSchema(request, usesApprovedPrompt),
});
