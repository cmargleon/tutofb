"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWithOpenAI = exports.mapAspectRatioToOpenAISize = void 0;
const runtime_1 = require("../config/runtime");
const mapAspectRatioToOpenAISize = (aspectRatio) => {
    if (aspectRatio === '1:1') {
        return '1024x1024';
    }
    const [width, height] = aspectRatio.split(':').map(Number);
    return width > height ? '1536x1024' : '1024x1536';
};
exports.mapAspectRatioToOpenAISize = mapAspectRatioToOpenAISize;
const generateWithOpenAI = async (request, openaiApiKey) => {
    const response = await fetch(`${(0, runtime_1.getOpenAIBaseUrl)()}/images/edits`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-image-1.5',
            prompt: request.prompt,
            size: (0, exports.mapAspectRatioToOpenAISize)(request.aspectRatio),
            quality: 'medium',
            output_format: 'png',
            input_fidelity: 'high',
            images: [
                { image_url: request.poseImageUrl },
                { image_url: request.garmentImageUrl },
            ],
        }),
        signal: request.signal,
    });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const payload = (await response.json());
    const firstImage = payload.data?.[0];
    if (!firstImage) {
        throw new Error('OpenAI no devolvió una imagen utilizable.');
    }
    if (firstImage.b64_json) {
        return {
            provider: 'openai-gpt-image-1.5',
            contentType: 'image/png',
            imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
            remoteUrl: null,
            requestId: null,
            responseSummary: {
                remoteUrl: null,
            },
        };
    }
    if (!firstImage.url) {
        throw new Error('OpenAI devolvió una respuesta sin URL ni base64.');
    }
    const imageResponse = await fetch(firstImage.url, { signal: request.signal });
    if (!imageResponse.ok) {
        throw new Error(`No se pudo descargar la imagen de OpenAI (${imageResponse.status}).`);
    }
    const arrayBuffer = await imageResponse.arrayBuffer();
    return {
        provider: 'openai-gpt-image-1.5',
        contentType: imageResponse.headers.get('content-type') || 'image/png',
        imageBytes: Buffer.from(arrayBuffer),
        remoteUrl: firstImage.url,
        requestId: null,
        responseSummary: {
            remoteUrl: firstImage.url,
        },
    };
};
exports.generateWithOpenAI = generateWithOpenAI;
//# sourceMappingURL=openai.js.map