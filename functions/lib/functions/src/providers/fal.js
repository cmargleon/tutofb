"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWithFalBananaPro = exports.generateWithFalSeedream = exports.mapAspectRatioToSeedreamSize = void 0;
const runtime_1 = require("../config/runtime");
const sleep = async (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const mapAspectRatioToSeedreamSize = (aspectRatio) => {
    if (aspectRatio === '1:1') {
        return 'square_hd';
    }
    const [width, height] = aspectRatio.split(':').map(Number);
    return width > height ? 'landscape_16_9' : 'portrait_16_9';
};
exports.mapAspectRatioToSeedreamSize = mapAspectRatioToSeedreamSize;
const fetchImageBytes = async (url, signal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`No se pudo descargar la imagen generada (${response.status}).`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
        bytes: Buffer.from(arrayBuffer),
        contentType: response.headers.get('content-type') || 'image/png',
    };
};
const extractImage = (payload) => {
    const firstImage = payload.images?.[0];
    if (firstImage?.url) {
        return {
            url: firstImage.url,
            contentType: firstImage.content_type || 'image/png',
        };
    }
    if (payload.image?.url) {
        return {
            url: payload.image.url,
            contentType: payload.image.content_type || 'image/png',
        };
    }
    if (payload.url) {
        return {
            url: payload.url,
            contentType: 'image/png',
        };
    }
    return null;
};
const submitFalRequest = async (endpointId, body, falKey, signal) => {
    const response = await fetch(`https://queue.fal.run/${endpointId}`, {
        method: 'POST',
        headers: {
            Authorization: `Key ${falKey}`,
            'Content-Type': 'application/json',
            'X-Fal-Object-Lifecycle-Preference': '21600',
        },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    return (await response.json());
};
const pollFalResponse = async (endpointId, queue, falKey, signal) => {
    const requestId = queue.request_id;
    if (!requestId) {
        throw new Error('fal.ai no devolvió request_id.');
    }
    const statusUrl = queue.status_url || `https://queue.fal.run/${endpointId}/requests/${requestId}/status`;
    const responseUrl = queue.response_url || `https://queue.fal.run/${endpointId}/requests/${requestId}`;
    const startedAt = Date.now();
    while (true) {
        const statusResponse = await fetch(statusUrl, {
            headers: { Authorization: `Key ${falKey}` },
            signal,
        });
        if (!statusResponse.ok) {
            throw new Error(await statusResponse.text());
        }
        const statusPayload = (await statusResponse.json());
        const status = statusPayload.status;
        if (status === 'COMPLETED' || status === 'OK') {
            const resultResponse = await fetch(responseUrl, {
                headers: { Authorization: `Key ${falKey}` },
                signal,
            });
            if (!resultResponse.ok) {
                throw new Error(await resultResponse.text());
            }
            return (await resultResponse.json());
        }
        if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED') {
            throw new Error(`fal.ai devolvió estado ${status}.`);
        }
        if (Date.now() - startedAt > (0, runtime_1.getFalPollTimeoutMs)()) {
            throw new Error('La solicitud a fal.ai excedió el tiempo máximo de espera.');
        }
        await sleep((0, runtime_1.getFalPollIntervalMs)());
    }
};
const generateWithFalSeedream = async (request, falKey) => {
    const endpointId = 'fal-ai/bytedance/seedream/v4/edit';
    const queue = await submitFalRequest(endpointId, {
        prompt: request.prompt,
        image_urls: [request.poseImageUrl, request.garmentImageUrl],
        num_images: 1,
        image_size: (0, exports.mapAspectRatioToSeedreamSize)(request.aspectRatio),
        enable_safety_checker: true,
    }, falKey, request.signal);
    const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
    const image = extractImage(payload);
    if (!image) {
        throw new Error('fal.ai seedream no devolvió una imagen utilizable.');
    }
    const downloaded = await fetchImageBytes(image.url, request.signal);
    return {
        provider: 'fal-seedream',
        contentType: image.contentType || downloaded.contentType,
        imageBytes: downloaded.bytes,
        remoteUrl: image.url,
        requestId: queue.request_id || null,
        responseSummary: {
            endpointId,
            requestId: queue.request_id || null,
            remoteUrl: image.url,
        },
    };
};
exports.generateWithFalSeedream = generateWithFalSeedream;
const generateWithFalBananaPro = async (request, falKey) => {
    const endpointId = 'fal-ai/nano-banana-pro/edit';
    const queue = await submitFalRequest(endpointId, {
        prompt: request.prompt,
        image_urls: [request.poseImageUrl, request.garmentImageUrl],
        num_images: 1,
        aspect_ratio: request.aspectRatio,
        resolution: '1K',
        output_format: 'png',
    }, falKey, request.signal);
    const payload = await pollFalResponse(endpointId, queue, falKey, request.signal);
    const image = extractImage(payload);
    if (!image) {
        throw new Error('fal.ai banana-pro no devolvió una imagen utilizable.');
    }
    const downloaded = await fetchImageBytes(image.url, request.signal);
    return {
        provider: 'fal-banana-pro',
        contentType: image.contentType || downloaded.contentType,
        imageBytes: downloaded.bytes,
        remoteUrl: image.url,
        requestId: queue.request_id || null,
        responseSummary: {
            endpointId,
            requestId: queue.request_id || null,
            remoteUrl: image.url,
        },
    };
};
exports.generateWithFalBananaPro = generateWithFalBananaPro;
//# sourceMappingURL=fal.js.map