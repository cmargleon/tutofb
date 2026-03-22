"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewGeneratedImageWithGemini = void 0;
const domain_1 = require("../../../shared/src/domain");
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
            description: 'If verdict is rejected, return a corrected prompt for the next image generation attempt. Otherwise return an empty string.',
        },
        criteria: {
            type: 'array',
            minItems: 4,
            items: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Short machine-friendly id like background, pose, garment, logo, composition.',
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
const sanitizeText = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const sanitizeCriteria = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const item = entry;
        const key = sanitizeText(item.key, `criterion_${index + 1}`);
        const label = sanitizeText(item.label, `Criterio ${index + 1}`);
        const passed = typeof item.passed === 'boolean' ? item.passed : false;
        const notes = sanitizeText(item.notes, 'Sin detalle adicional.');
        return { key, label, passed, notes };
    })
        .filter((entry) => Boolean(entry));
};
const sanitizeNullableText = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const sanitizeMarketplaceData = (value) => {
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
    const record = value;
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
const buildReviewPrompt = ({ requestedPromptBase, promptBase, finalPrompt, backgroundConfig, attemptNumber, maxAttempts, }) => {
    const originalPrompt = requestedPromptBase.trim() || domain_1.DEFAULT_TRY_ON_PROMPT;
    const currentPrompt = promptBase.trim() || domain_1.DEFAULT_TRY_ON_PROMPT;
    const backgroundPrompt = (0, domain_1.buildBackgroundPrompt)(backgroundConfig);
    return [
        'Eres un evaluador experto de resultados de edicion de imagen para catalogo de moda y marketplaces.',
        'Recibiras tres imagenes en este orden: 1) pose/base de la modelo, 2) prenda de referencia, 3) resultado generado.',
        'Debes revisar si el resultado generado cumple con la intencion original y con los detalles visibles de las referencias.',
        'Evalua de forma obligatoria: fondo, pose/cuerpo, fidelidad de la prenda, logos o graficos visibles, y cumplimiento general.',
        'No seas excesivamente estricto con el fondo. El fondo no necesita ser identico. Si conserva el mismo tono, ambiente o intencion visual general, y se parece aproximadamente en un 70%, puede aprobarse si los otros criterios importantes tambien se cumplen.',
        'No seas excesivamente estricto con la pose. La pose no necesita ser identica. Debe conservar un angulo general similar: si la persona esta de espalda, debe salir de espalda; si mira a camara, debe mirar a camara; si esta en tres cuartos, debe mantenerse un tres cuartos similar. Se aceptan pequenos cambios de postura, encuadre y zoom in o zoom out moderado.',
        'Se mas estricto con la prenda: tipo de prenda, color principal, branding visible, logos, graficos y ubicacion de esos elementos si aparecen en la referencia.',
        'Si hay logos, estampados, textos o graficos en la prenda, comprueba que sigan presentes, bien colocados y sin deformaciones evidentes.',
        'Si el resultado no cumple, devuelve un revisedPrompt listo para reenviar a una API de generacion de imagen. Ese prompt debe ser autocontenido, en ingles, especifico y orientado a corregir solo lo que fallo sin perder la pose, la identidad ni la prenda.',
        'Si el resultado si cumple, revisedPrompt debe ser una cadena vacia.',
        'Ademas, extrae informacion comercial sistematizada de la prenda para usar en marketplaces tipo Shein o TikTok Shop.',
        'Genera un title y una description en espanol con tono comercial, claros y utiles para venta.',
        'Identifica brand solo si es visible. Identifica gender solo si hay evidencia suficiente, y si no la hay devuelve null.',
        'Identifica garmentType, primaryColor y, si es ropa deportiva, indica el sport o uso principal. Si no es deportiva, sport debe ser null e isSportswear debe ser false.',
        'Cuando no tengas evidencia suficiente para algun campo comercial, devuelve null en vez de inventar datos.',
        `Intento actual: ${attemptNumber} de ${maxAttempts}.`,
        `Prompt original del usuario: ${originalPrompt}`,
        `Prompt usado en este intento: ${currentPrompt}`,
        `Prompt final enviado al proveedor: ${finalPrompt}`,
        `Instrucciones de fondo normalizadas: ${backgroundPrompt}`,
        'Responde solo con JSON valido que siga exactamente el schema solicitado.',
    ].join('\n\n');
};
const extractResponseText = (payload) => {
    const text = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts || [])
        .map((part) => part.text || '')
        .find((value) => value.trim().length > 0);
    if (text && text.trim()) {
        return text.trim();
    }
    const finishReason = payload.candidates?.[0]?.finishReason;
    throw new Error(finishReason
        ? `Gemini no devolvio texto utilizable. Finish reason: ${finishReason}.`
        : `Gemini no devolvio texto utilizable. Prompt feedback: ${JSON.stringify(payload.promptFeedback || {})}`);
};
const reviewGeneratedImageWithGemini = async (request) => {
    const reviewPrompt = buildReviewPrompt(request);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': request.apiKey,
        },
        body: JSON.stringify({
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
        }),
        signal: request.signal,
    });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const payload = (await response.json());
    const reviewText = extractResponseText(payload);
    const parsed = JSON.parse(reviewText);
    const criteria = sanitizeCriteria(parsed.criteria);
    const verdict = parsed.verdict === 'approved' ? 'approved' : 'rejected';
    const summary = sanitizeText(parsed.summary, verdict === 'approved'
        ? 'La imagen cumple con los criterios solicitados.'
        : 'La imagen no cumple con los criterios solicitados.');
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
};
exports.reviewGeneratedImageWithGemini = reviewGeneratedImageWithGemini;
//# sourceMappingURL=geminiImageReview.js.map