import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import type { MasterProduct, SpreadsheetTemplateCategoryColumn } from '../../../shared/src/types';
import { marketplaceSquareCandidates } from '../../../shared/src/marketplaceExport/adapters';
import { callGeminiGenerateContent } from '../analytics/geminiUsage';
import { getAppFirestore } from '../firebase/appFirestore';
import { prepareMarketplaceSquare } from '../media/marketplaceSquare';
import { assertCurrentImage, marketplaceImageBucketName, marketplaceImageClientPrefix } from './marketplaceImages';
import { buildSquareCropStoragePath } from './squareCrop';

type Candidate = MasterProduct['approvedImages'][number];

export interface MarketplaceSquareRequest {
  product: MasterProduct;
  variantId: string;
  column: SpreadsheetTemplateCategoryColumn;
}

const SEGMENTATION_MODEL = 'gemini-3.8-flash';
const hash = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const allowsPadding = (column: SpreadsheetTemplateCategoryColumn) => {
  const guidance = [column.guidance, column.validation].join(' ').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return !/\b(?:sin|no (?:se permite[n]?|usar|agregar|anadir)|prohibid[oa]s?|without|no|do not add)\s+(?:(?:ningun[oa]?|white|blank|blanc[oa]s?)\s+)?(?:marco|bordes?|margenes?|relleno|borders?|frames?|padding|margins?)\b/i.test(guidance);
};

async function segmentProduct(sample: Buffer, product: MasterProduct, image: Candidate, uid: string, apiKey: string) {
  const { payload } = await callGeminiGenerateContent<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  }>({
    apiKey, model: SEGMENTATION_MODEL, signal: AbortSignal.timeout(15_000),
    context: { feature: 'product_draft_enrichment', clientId: product.clientId, jobId: image.jobId, garmentId: product.garmentId, userUid: uid },
    body: {
      systemInstruction: { parts: [{ text: 'Segment the product for sale in the photo. Return complete=true only when you can confidently identify the entire visible outline, including thin parts, handles, stems and bases, and the product is fully visible and unoccluded. If there are multiple instances of the same product, include all of them in the box and use their combined outer outline. Exclude props and background. Use [top,left,bottom,right] and a polygon of [x,y] points in coordinates normalized to 0–1000. If uncertain, return complete=false with empty arrays.' }] },
      contents: [{ role: 'user', parts: [
        { text: JSON.stringify({ product: product.values.name || product.garmentId }) },
        { inlineData: { mimeType: 'image/jpeg', data: sample.toString('base64') } },
      ] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'low' }, temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 4096,
        responseJsonSchema: {
          type: 'object', required: ['complete', 'box', 'outline'], properties: {
            complete: { type: 'boolean' },
            box: { type: 'array', items: { type: 'integer' } },
            outline: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
          },
        },
      },
    },
  });
  const answer = payload.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
  return answer ? JSON.parse(answer) as unknown : null;
}

async function generateSquare(candidates: Candidate[], product: MasterProduct, uid: string, apiKey: string, pad: boolean, deadline: number) {
  const bucket = admin.storage().bucket();
  let fallback: { bytes: Buffer; image: Candidate } | undefined;
  let segmentationFailed = false;
  for (const image of candidates) {
    if (Date.now() >= deadline) throw new Error('Se agotó el tiempo para preparar la foto cuadrada.');
    try {
      const file = bucket.file(image.storagePath);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) > 32 * 1024 * 1024) continue;
      const [bytes] = await bucket.file(image.storagePath, { generation: metadata.generation }).download();
      const prepared = await prepareMarketplaceSquare(bytes, async sample => {
        fallback ??= { bytes, image };
        try { return await segmentProduct(sample, product, image, uid, apiKey); }
        catch (error) {
          segmentationFailed = true;
          console.warn('Marketplace square segmentation failed', { jobId: image.jobId, error });
          return null;
        }
      });
      if (prepared) return { prepared, image };
    } catch (error) {
      console.warn('Marketplace square source could not be processed', { jobId: image.jobId, error });
    }
  }
  if (!pad || !fallback || segmentationFailed) throw new Error('No se pudo verificar un encuadre cuadrado para las fotos aprobadas.');
  // The first usable photo is the main photo whenever it meets the image profile.
  const prepared = await prepareMarketplaceSquare(fallback.bytes, null);
  if (!prepared) throw new Error('No se pudo preparar la foto cuadrada.');
  return { prepared, image: fallback.image };
}

async function prepareSquare(
  product: MasterProduct, main: Candidate, candidates: Candidate[], digest: string,
  pad: boolean, uid: string, apiKey: string | undefined, deadline: number, publish: boolean,
) {
  const batchId = main.storagePath.split('/')[2];
  const storagePath = buildSquareCropStoragePath({ clientId: product.clientId, batchId, jobId: main.jobId, outputId: digest });
  const file = admin.storage().bucket().file(storagePath);
  let metadata = await file.getMetadata().then(([value]) => value).catch(error => {
    if (error.code !== 404) throw error;
    return null;
  });
  if (!metadata && apiKey) {
    const { prepared, image } = await generateSquare(candidates, product, uid, apiKey, pad, deadline);
    await file.save(prepared.bytes, {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: prepared.contentType, metadata: { outputId: image.outputId, contentHash: hash(prepared.bytes) } },
    }).catch(error => { if (error.code !== 412) throw error; });
    [metadata] = await file.getMetadata();
  }
  if (!metadata) {
    if (publish) throw new Error('La foto cuadrada todavía no está preparada.');
    return null;
  }
  const image = candidates.find(candidate => candidate.outputId === metadata.metadata?.outputId);
  const contentHash = metadata.metadata?.contentHash;
  if (!image || typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('Foto cuadrada guardada inválida.');

  const publicBucket = admin.storage().bucket(marketplaceImageBucketName());
  const publicPath = `${marketplaceImageClientPrefix(product.clientId)}${digest}/${contentHash}.jpg`;
  const publicFile = publicBucket.file(publicPath);
  if (publish) {
    const db = getAppFirestore();
    const [client, job] = await db.getAll(db.doc(`clients/${product.clientId}`), db.doc(`jobs/${image.jobId}`));
    assertCurrentImage(product, image, 'shein', client, job);
    if (!(await publicFile.exists())[0]) {
      const [bytes] = await admin.storage().bucket().file(storagePath, { generation: metadata.generation }).download();
      if (hash(bytes) !== contentHash) throw new Error('La foto cuadrada guardada cambió.');
      await publicFile.save(bytes, {
        resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400, immutable', contentDisposition: 'inline' },
      }).catch(error => { if (error.code !== 412) throw error; });
    }
  }
  const url = publish || (await publicFile.exists())[0] ? `https://storage.googleapis.com/${publicBucket.name}/${publicPath}` : undefined;
  return { storagePath, ...(url ? { url } : {}) };
}

export async function prepareMarketplaceSquares(
  requests: MarketplaceSquareRequest[], uid: string,
  options: { apiKey?: string; publish?: boolean },
) {
  const deadline = Date.now() + 240_000;
  const cache = new Map<string, ReturnType<typeof prepareSquare>>();
  let pending = false;
  let incomplete = false;
  for (let offset = 0; offset < requests.length; offset += 4) {
    const results = await Promise.allSettled(requests.slice(offset, offset + 4).map(async ({ product, variantId, column }) => {
      const candidates = marketplaceSquareCandidates(product, variantId);
      const [main] = candidates;
      if (!main) return;
      const pad = allowsPadding(column);
      const digest = hash(JSON.stringify(['shein-square-v2', product.clientId, product.id, pad, candidates]));
      try {
        let work = cache.get(digest);
        if (!work) {
          work = prepareSquare(product, main, candidates, digest, pad, uid, options.apiKey, deadline, !!options.publish);
          cache.set(digest, work);
        }
        const square = await work;
        if (square) (product.marketplaceSquares ??= {})[variantId] = square;
        else pending = true;
      } catch (error) {
        if (options.publish) throw new Error(`${product.values.name || product.garmentId}: no se pudo preparar ${column.label}. ${error instanceof Error ? error.message : ''}`);
        console.warn('Marketplace square preview failed', { productId: product.id, error });
        incomplete = true;
      }
    }));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  return { pending, incomplete };
}
