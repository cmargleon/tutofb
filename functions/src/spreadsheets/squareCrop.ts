import * as admin from 'firebase-admin';
import sharp from 'sharp';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';

const bucket = admin.storage().bucket();

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const getGcpAccessToken = async (): Promise<string> => {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!response.ok) throw new Error(`Metadata server responded with ${response.status}`);
  const data = await response.json() as { access_token: string };
  return data.access_token;
};

const getVisionSquareCropHint = async (gcsUri: string): Promise<CropRegion | null> => {
  const accessToken = await getGcpAccessToken();
  const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      requests: [{
        image: { source: { gcsImageUri: gcsUri } },
        features: [{ type: 'CROP_HINTS' }],
        imageContext: { cropHintsParams: { aspectRatios: [1.0] } },
      }],
    }),
  });

  if (!response.ok) {
    console.error('Vision API error:', response.status, await response.text());
    return null;
  }

  const result = await response.json() as {
    responses?: Array<{
      cropHintsAnnotation?: {
        cropHints?: Array<{
          boundingPoly?: {
            vertices?: Array<{ x?: number; y?: number }>;
          };
        }>;
      };
    }>;
  };

  const vertices = result.responses?.[0]?.cropHintsAnnotation?.cropHints?.[0]?.boundingPoly?.vertices;
  if (!vertices || vertices.length < 4) return null;

  const x = vertices[0].x ?? 0;
  const y = vertices[0].y ?? 0;
  const hintW = (vertices[2].x ?? 0) - x;
  const hintH = (vertices[2].y ?? 0) - y;

  if (hintW <= 0 || hintH <= 0) return null;

  return { left: x, top: y, width: hintW, height: hintH };
};

const toSquareCrop = (hint: CropRegion, imgWidth: number, imgHeight: number): CropRegion => {
  const size = Math.min(hint.width, hint.height, imgWidth, imgHeight);
  const cx = hint.left + Math.floor(hint.width / 2);
  const cy = hint.top + Math.floor(hint.height / 2);
  const left = Math.max(0, Math.min(cx - Math.floor(size / 2), imgWidth - size));
  const top = Math.max(0, Math.min(cy - Math.floor(size / 2), imgHeight - size));
  return { left, top, width: size, height: size };
};

const fallbackSquareCrop = (imgWidth: number, imgHeight: number): CropRegion => {
  const size = Math.min(imgWidth, imgHeight);
  const skipTop = Math.floor(imgHeight * 0.15);
  const left = Math.floor((imgWidth - size) / 2);
  const top = Math.max(0, Math.min(skipTop, imgHeight - size));
  return { left, top, width: size, height: size };
};

export const generateAndStoreSquareCrop = async (
  sourceStoragePath: string,
  outputStoragePath: string,
): Promise<string> => {
  const [buffer] = await bucket.file(sourceStoragePath).download();
  const image = sharp(buffer, { failOn: 'none' });
  const { width = 0, height = 0 } = await image.metadata();

  let cropRegion: CropRegion;
  try {
    const gcsUri = `gs://${bucket.name}/${sourceStoragePath}`;
    const hint = await getVisionSquareCropHint(gcsUri);
    cropRegion = hint ? toSquareCrop(hint, width, height) : fallbackSquareCrop(width, height);
  } catch (error) {
    console.warn('Vision API crop hint failed, using fallback:', error);
    cropRegion = fallbackSquareCrop(width, height);
  }

  const croppedBuffer = await image
    .extract(cropRegion)
    .jpeg({ quality: 90 })
    .toBuffer();

  await bucket.file(outputStoragePath).save(croppedBuffer, {
    contentType: 'image/jpeg',
    resumable: false,
  });

  return ensureStorageDownloadUrl(outputStoragePath);
};
