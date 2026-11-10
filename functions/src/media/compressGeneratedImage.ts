import { addSyntheticPerformerXmp } from './photoPlanFile';
import sharp from 'sharp';
import { COMMERCIAL_PHOTO_PROFILE, COMMERCIAL_PHOTO_STORAGE } from '../../../shared/src/commercialPhoto';
import { resolveAspectRatioForImageConfig } from '../../../shared/src/providerImageConfig';
import type { CommercialPhotoProfile, ProviderImageConfig, StoredPhotoMetadata } from '../../../shared/src/types';

const MAX_STORED_OUTPUT_BYTES = 3 * 1024 * 1024;
const OUTPUT_JPEG_QUALITIES = [90, 82, 74, 66, 58, 50] as const;
const OUTPUT_LONGEST_SIDES = [2200, 2000, 1800, 1600, 1400, 1200, 1000] as const;

export const compressGeneratedImageIfNeeded = async ({
  bytes,
  contentType, photoProfile, imageConfig, syntheticPerformer, plannedPhoto,
}: {
  bytes: Buffer;
  contentType: string;
  syntheticPerformer?: boolean;
  plannedPhoto?: boolean;
  photoProfile?: CommercialPhotoProfile;
  imageConfig?: ProviderImageConfig | null;
}): Promise<{ bytes: Buffer; contentType: string; storedImage?: StoredPhotoMetadata }> => {
  if (photoProfile === COMMERCIAL_PHOTO_PROFILE) return normalizeCommercialPhoto(bytes, imageConfig, syntheticPerformer, plannedPhoto);
  if (bytes.length <= MAX_STORED_OUTPUT_BYTES) {
    return { bytes, contentType };
  }

  const source = sharp(bytes, { failOn: 'none' }).rotate();
  const metadata = await source.metadata();
  const sourceWidth = metadata.width || null;
  const sourceHeight = metadata.height || null;
  const longestSide = Math.max(sourceWidth || 0, sourceHeight || 0);
  let bestCandidate: Buffer | null = null;

  for (const targetLongestSide of OUTPUT_LONGEST_SIDES) {
    const shouldResize = longestSide > 0 && longestSide > targetLongestSide;

    for (const quality of OUTPUT_JPEG_QUALITIES) {
      let pipeline = sharp(bytes, { failOn: 'none' }).rotate();
      if (shouldResize) {
        pipeline = pipeline.resize({
          width: sourceWidth && sourceWidth >= (sourceHeight || 0) ? targetLongestSide : undefined,
          height: sourceHeight && sourceHeight > (sourceWidth || 0) ? targetLongestSide : undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const candidate = await pipeline.jpeg({
        quality,
        mozjpeg: true,
      }).toBuffer();

      if (!bestCandidate || candidate.length < bestCandidate.length) {
        bestCandidate = candidate;
      }

      if (candidate.length <= MAX_STORED_OUTPUT_BYTES) {
        return {
          bytes: candidate,
          contentType: 'image/jpeg',
        };
      }
    }
  }

  if (bestCandidate && bestCandidate.length < bytes.length) {
    return {
      bytes: bestCandidate,
      contentType: 'image/jpeg',
    };
  }

  return { bytes, contentType };
};


// Resolution first, then quality: all qualities at a size precede a 10% reduction.
// Every candidate decodes the original; no candidate JPEG is ever recompressed.
const normalizeCommercialPhoto = async (bytes: Buffer, imageConfig?: ProviderImageConfig | null, syntheticPerformer = false, plannedPhoto = false) => {
  const policy = plannedPhoto ? { ...COMMERCIAL_PHOTO_STORAGE, maxSide: 1920 } : COMMERCIAL_PHOTO_STORAGE;
  const original = await sharp(bytes, { failOn: 'warning' }).metadata();
  if (!original.width || !original.height || (original.pages || 1) > 1) throw new Error('Imagen generada inválida o animada.');
  const swapped = [5, 6, 7, 8].includes(original.orientation || 1);
  const sourceWidth = swapped ? original.height : original.width;
  const sourceHeight = swapped ? original.width : original.height;
  const requested = imageConfig && 'imageSize' in imageConfig && typeof imageConfig.imageSize !== 'string' ? imageConfig.imageSize : null;
  const automatic = imageConfig && (('aspectRatio' in imageConfig && imageConfig.aspectRatio === 'auto')
    || ('imageSize' in imageConfig && typeof imageConfig.imageSize === 'string' && imageConfig.imageSize.startsWith('auto')));
  const requestedRatio = imageConfig && !automatic ? resolveAspectRatioForImageConfig(imageConfig).split(':').map(Number) : null;
  let side = Math.min(policy.maxSide, Math.max(sourceWidth, sourceHeight));
  const attempted = new Set<string>();
  while (side >= 1) {
    const key = `${Math.max(1, Math.round(sourceWidth * Math.min(1, side / Math.max(sourceWidth, sourceHeight))))}x${Math.max(1, Math.round(sourceHeight * Math.min(1, side / Math.max(sourceWidth, sourceHeight))))}`;
    if (!attempted.has(key)) {
      attempted.add(key);
      for (const quality of policy.qualities) {
        let candidate = await sharp(bytes, { failOn: 'warning' }).rotate()
          .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
          .toColourspace('srgb').flatten({ background: '#ffffff' })
          .withIccProfile('srgb')
          .jpeg({ quality, mozjpeg: true }).toBuffer();
        if (syntheticPerformer) candidate = addSyntheticPerformerXmp(candidate);
        if (candidate.length > policy.maxBytes) continue;
        const actual = await sharp(candidate, { failOn: 'warning' }).metadata();
        if (actual.format !== 'jpeg' || actual.depth !== 'uchar' || actual.space !== 'srgb'
          || actual.hasAlpha || !actual.icc || !actual.width || !actual.height
          || Math.max(actual.width, actual.height) > policy.maxSide) throw new Error('La normalización fotográfica no cumple el perfil.');
        const storedImage: StoredPhotoMetadata = {
          width: actual.width, height: actual.height, sizeBytes: candidate.length,
          format: 'jpeg', space: 'srgb', depth: 'uchar', hasAlpha: false, hasSrgbIcc: true,
          sourceWidth, sourceHeight, sourceFormat: original.format || 'unknown',
          requestedGeometryDiffers: Boolean(requested && (requested.width !== sourceWidth || requested.height !== sourceHeight)
            || requestedRatio && sourceWidth * requestedRatio[1] !== sourceHeight * requestedRatio[0]),
        };
        return { bytes: candidate, contentType: policy.contentType, storedImage };
      }
    }
    if (side === 1) break;
    side = Math.max(1, Math.floor(side * 0.9));
  }
  throw new Error('La imagen generada excede el máximo absoluto del perfil comercial.');
};
