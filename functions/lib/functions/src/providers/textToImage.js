"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.editModelPhotoWithOpenAI = exports.generateModelPhotoWithOpenAI = exports.editModelPhotoWithBananaPro = exports.editModelPhotoWithSeedreamV45 = exports.generateModelPhotoWithBanana2 = exports.generateModelPhotoWithBananaPro = exports.generateModelPhotoWithBanana = exports.generateModelPhotoWithSeedreamV45 = exports.generateModelPhotoWithSeedreamV4 = exports.generateModelPhotoWithFluxSchnell = exports.generateModelPhotoWithFluxPro = void 0;
const runtime_1 = require("../config/runtime");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchRemoteImage = async (imageUrl, fallbackContentType) => {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
        throw new Error(`No se pudo descargar la imagen generada (${imgResp.status}).`);
    }
    return {
        imageBytes: Buffer.from(await imgResp.arrayBuffer()),
        contentType: imgResp.headers.get('content-type') || fallbackContentType,
        remoteUrl: imageUrl,
    };
};
const mapAspectRatioToFluxSize = (aspectRatio) => {
    const map = {
        '9:16': 'portrait_16_9',
        '3:4': 'portrait_4_3',
        '2:3': 'portrait_4_3',
        '1:1': 'square_hd',
        '4:3': 'landscape_4_3',
        '3:2': 'landscape_4_3',
        '16:9': 'landscape_16_9',
    };
    return map[aspectRatio] ?? 'square_hd';
};
const mapAspectRatioToOpenAISize = (aspectRatio) => {
    if (aspectRatio === '1:1')
        return '1024x1024';
    const [width, height] = aspectRatio.split(':').map(Number);
    return width > height ? '1536x1024' : '1024x1536';
};
const runFalTextToImage = async (endpointId, body, falKey) => {
    const queueResp = await fetch(`https://queue.fal.run/${endpointId}`, {
        method: 'POST',
        headers: {
            Authorization: `Key ${falKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!queueResp.ok) {
        throw new Error(`fal.ai [${endpointId}]: ${await queueResp.text()}`);
    }
    const queue = (await queueResp.json());
    const requestId = queue.request_id;
    if (!requestId)
        throw new Error(`fal.ai [${endpointId}]: no devolvió request_id.`);
    const statusUrl = queue.status_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
    const responseUrl = queue.response_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}`;
    const startedAt = Date.now();
    while (true) {
        const statusResp = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
        if (!statusResp.ok)
            throw new Error(`fal.ai [${endpointId}] status: ${await statusResp.text()}`);
        const { status } = (await statusResp.json());
        if (status === 'COMPLETED' || status === 'OK') {
            const resultResp = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
            if (!resultResp.ok)
                throw new Error(`fal.ai [${endpointId}] result: ${await resultResp.text()}`);
            const payload = (await resultResp.json());
            const firstImage = payload.images?.[0];
            if (!firstImage?.url)
                throw new Error(`fal.ai [${endpointId}]: no devolvió imagen.`);
            return fetchRemoteImage(firstImage.url, firstImage.content_type ?? 'image/jpeg');
        }
        if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
            throw new Error(`fal.ai [${endpointId}] devolvió estado ${status}.`);
        }
        if (Date.now() - startedAt > (0, runtime_1.getFalPollTimeoutMs)()) {
            throw new Error(`fal.ai [${endpointId}] excedió el tiempo máximo de espera.`);
        }
        await sleep((0, runtime_1.getFalPollIntervalMs)());
    }
};
const runFalImageEdit = async (endpointId, body, falKey) => {
    const queueResp = await fetch(`https://queue.fal.run/${endpointId}`, {
        method: 'POST',
        headers: {
            Authorization: `Key ${falKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!queueResp.ok) {
        throw new Error(`fal.ai [${endpointId}]: ${await queueResp.text()}`);
    }
    const queue = (await queueResp.json());
    const requestId = queue.request_id;
    if (!requestId)
        throw new Error(`fal.ai [${endpointId}]: no devolvió request_id.`);
    const statusUrl = queue.status_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
    const responseUrl = queue.response_url ?? `https://queue.fal.run/${endpointId}/requests/${requestId}`;
    const startedAt = Date.now();
    while (true) {
        const statusResp = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } });
        if (!statusResp.ok)
            throw new Error(`fal.ai [${endpointId}] status: ${await statusResp.text()}`);
        const { status } = (await statusResp.json());
        if (status === 'COMPLETED' || status === 'OK') {
            const resultResp = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } });
            if (!resultResp.ok)
                throw new Error(`fal.ai [${endpointId}] result: ${await resultResp.text()}`);
            const payload = (await resultResp.json());
            const firstImage = payload.images?.[0];
            if (!firstImage?.url)
                throw new Error(`fal.ai [${endpointId}]: no devolvió imagen.`);
            return fetchRemoteImage(firstImage.url, firstImage.content_type ?? 'image/png');
        }
        if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
            throw new Error(`fal.ai [${endpointId}] devolvió estado ${status}.`);
        }
        if (Date.now() - startedAt > (0, runtime_1.getFalPollTimeoutMs)()) {
            throw new Error(`fal.ai [${endpointId}] excedió el tiempo máximo de espera.`);
        }
        await sleep((0, runtime_1.getFalPollIntervalMs)());
    }
};
// fal.ai Flux Pro v1.1 — alta calidad
const generateModelPhotoWithFluxPro = async (prompt, aspectRatio, falKey) => runFalTextToImage('fal-ai/flux-pro/v1.1', {
    prompt,
    image_size: mapAspectRatioToFluxSize(aspectRatio),
    num_images: 1,
    enable_safety_checker: false,
    output_format: 'jpeg',
}, falKey);
exports.generateModelPhotoWithFluxPro = generateModelPhotoWithFluxPro;
// fal.ai Flux Schnell — rápido y económico
const generateModelPhotoWithFluxSchnell = async (prompt, aspectRatio, falKey) => runFalTextToImage('fal-ai/flux/schnell', {
    prompt,
    image_size: mapAspectRatioToFluxSize(aspectRatio),
    num_images: 1,
    enable_safety_checker: false,
}, falKey);
exports.generateModelPhotoWithFluxSchnell = generateModelPhotoWithFluxSchnell;
// fal.ai Seedream v4 text-to-image
const generateModelPhotoWithSeedreamV4 = async (prompt, aspectRatio, falKey) => runFalTextToImage('fal-ai/bytedance/seedream/v4/text-to-image', {
    prompt,
    image_size: mapAspectRatioToFluxSize(aspectRatio),
    num_images: 1,
    enable_safety_checker: false,
}, falKey);
exports.generateModelPhotoWithSeedreamV4 = generateModelPhotoWithSeedreamV4;
// fal.ai Seedream v4.5 text-to-image
const generateModelPhotoWithSeedreamV45 = async (prompt, aspectRatio, falKey) => runFalTextToImage('fal-ai/bytedance/seedream/v4.5/text-to-image', {
    prompt,
    image_size: mapAspectRatioToFluxSize(aspectRatio),
    num_images: 1,
    enable_safety_checker: false,
}, falKey);
exports.generateModelPhotoWithSeedreamV45 = generateModelPhotoWithSeedreamV45;
// fal.ai Nano Banana (Gemini 2.5 Flash Image) text-to-image
const runFalBanana = (endpointId, prompt, aspectRatio, falKey) => runFalTextToImage(endpointId, {
    prompt,
    aspect_ratio: aspectRatio,
    resolution: '1K',
    num_images: 1,
    output_format: 'jpeg',
}, falKey);
const generateModelPhotoWithBanana = (prompt, aspectRatio, falKey) => runFalBanana('fal-ai/nano-banana', prompt, aspectRatio, falKey);
exports.generateModelPhotoWithBanana = generateModelPhotoWithBanana;
const generateModelPhotoWithBananaPro = (prompt, aspectRatio, falKey) => runFalBanana('fal-ai/nano-banana-pro', prompt, aspectRatio, falKey);
exports.generateModelPhotoWithBananaPro = generateModelPhotoWithBananaPro;
const generateModelPhotoWithBanana2 = (prompt, aspectRatio, falKey) => runFalBanana('fal-ai/nano-banana-2', prompt, aspectRatio, falKey);
exports.generateModelPhotoWithBanana2 = generateModelPhotoWithBanana2;
const editModelPhotoWithSeedreamV45 = (prompt, aspectRatio, referenceImageUrl, falKey) => runFalImageEdit('fal-ai/bytedance/seedream/v4.5/edit', {
    prompt,
    image_urls: [referenceImageUrl],
    num_images: 1,
    image_size: mapAspectRatioToFluxSize(aspectRatio),
    enable_safety_checker: false,
}, falKey);
exports.editModelPhotoWithSeedreamV45 = editModelPhotoWithSeedreamV45;
const editModelPhotoWithBananaPro = (prompt, aspectRatio, referenceImageUrl, falKey) => runFalImageEdit('fal-ai/nano-banana-pro/edit', {
    prompt,
    image_urls: [referenceImageUrl],
    num_images: 1,
    aspect_ratio: aspectRatio,
    resolution: '1K',
    output_format: 'png',
}, falKey);
exports.editModelPhotoWithBananaPro = editModelPhotoWithBananaPro;
// OpenAI gpt-image-1 (generations)
const generateModelPhotoWithOpenAI = async (prompt, aspectRatio, openaiApiKey) => {
    const response = await fetch(`${(0, runtime_1.getOpenAIBaseUrl)()}/images/generations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-image-1.5',
            prompt,
            n: 1,
            size: mapAspectRatioToOpenAISize(aspectRatio),
            quality: 'medium',
            output_format: 'png',
        }),
    });
    if (!response.ok)
        throw new Error(`OpenAI: ${await response.text()}`);
    const payload = (await response.json());
    const firstImage = payload.data?.[0];
    if (!firstImage)
        throw new Error('OpenAI no devolvió imagen.');
    if (firstImage.b64_json) {
        return {
            imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
            contentType: 'image/png',
            remoteUrl: null,
        };
    }
    if (!firstImage.url)
        throw new Error('OpenAI devolvió respuesta sin URL ni base64.');
    return fetchRemoteImage(firstImage.url, 'image/png');
};
exports.generateModelPhotoWithOpenAI = generateModelPhotoWithOpenAI;
const editModelPhotoWithOpenAI = async (prompt, aspectRatio, referenceImageUrl, openaiApiKey) => {
    const response = await fetch(`${(0, runtime_1.getOpenAIBaseUrl)()}/images/edits`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-image-1.5',
            prompt,
            size: mapAspectRatioToOpenAISize(aspectRatio),
            quality: 'medium',
            output_format: 'png',
            input_fidelity: 'high',
            images: [{ image_url: referenceImageUrl }],
        }),
    });
    if (!response.ok)
        throw new Error(`OpenAI: ${await response.text()}`);
    const payload = (await response.json());
    const firstImage = payload.data?.[0];
    if (!firstImage)
        throw new Error('OpenAI no devolvió imagen.');
    if (firstImage.b64_json) {
        return {
            imageBytes: Buffer.from(firstImage.b64_json, 'base64'),
            contentType: 'image/png',
            remoteUrl: null,
        };
    }
    if (!firstImage.url)
        throw new Error('OpenAI devolvió respuesta sin URL ni base64.');
    return fetchRemoteImage(firstImage.url, 'image/png');
};
exports.editModelPhotoWithOpenAI = editModelPhotoWithOpenAI;
//# sourceMappingURL=textToImage.js.map