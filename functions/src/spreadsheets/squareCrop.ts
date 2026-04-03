import * as admin from 'firebase-admin';
import sharp from 'sharp';
import { PoseFraming } from '../../../shared/src/types';
import { ensureStorageDownloadUrl } from '../firebase/storageDownloadUrl';

const bucket = admin.storage().bucket();

interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SquareCropTuning {
  skipTopRatio: number;
  zoomFactor: number;
  verticalBias: number;
}

const SQUARE_CROP_TUNING_BY_FRAMING: Record<PoseFraming, SquareCropTuning> = {
  full_body: {
    skipTopRatio: 0.22,
    zoomFactor: 0.92,
    verticalBias: 0.82,
  },
  three_quarter_body: {
    skipTopRatio: 0.16,
    zoomFactor: 0.94,
    verticalBias: 0.68,
  },
  medium_body: {
    skipTopRatio: 0.1,
    zoomFactor: 0.97,
    verticalBias: 0.52,
  },
  lower_body: {
    skipTopRatio: 0.06,
    zoomFactor: 0.96,
    verticalBias: 0.88,
  },
  feet_closeup: {
    skipTopRatio: 0.04,
    zoomFactor: 0.96,
    verticalBias: 0.9,
  },
  unknown: {
    skipTopRatio: 0.14,
    zoomFactor: 0.95,
    verticalBias: 0.62,
  },
};

interface SquareCropLocation {
  clientId: string;
  batchId: string;
  jobId: string;
}

/**
 * Builds a square crop focused on the garment area of a fashion photo.
 *
 * The crop is tuned by pose framing. Tighter torso shots keep more of the top
 * of the garment, while wider poses bias the square lower so hems and lower
 * silhouettes do not get chopped off.
 */
const garmentSquareCrop = (
  imgWidth: number,
  imgHeight: number,
  poseFraming?: PoseFraming | null,
): CropRegion => {
  const tuning = SQUARE_CROP_TUNING_BY_FRAMING[poseFraming || 'unknown']
    || SQUARE_CROP_TUNING_BY_FRAMING.unknown;
  const skipTop = Math.floor(imgHeight * tuning.skipTopRatio);
  const baseSize = Math.min(imgWidth, imgHeight - skipTop);
  const baseLeft = Math.floor((imgWidth - baseSize) / 2);
  const baseTop = Math.max(0, Math.min(skipTop, imgHeight - baseSize));

  const size = Math.max(1, Math.floor(baseSize * tuning.zoomFactor));
  const availableInset = Math.max(0, baseSize - size);
  const left = Math.max(0, Math.min(baseLeft + Math.round(availableInset / 2), imgWidth - size));
  const top = Math.max(
    0,
    Math.min(baseTop + Math.round(availableInset * tuning.verticalBias), imgHeight - size),
  );

  return { left, top, width: size, height: size };
};

export const buildLegacySquareCropStoragePath = ({
  clientId,
  batchId,
  jobId,
}: SquareCropLocation): string => `generated/${clientId}/${batchId}/${jobId}/square_crop.jpg`;

export const buildSquareCropStoragePath = ({
  clientId,
  batchId,
  jobId,
  outputId,
}: SquareCropLocation & { outputId: string }): string =>
  `generated/${clientId}/${batchId}/${jobId}/square_crops/${outputId}.jpg`;

export const isSquareCropValueForJob = (
  value: string | null | undefined,
  location: SquareCropLocation,
): boolean => {
  if (!value?.trim()) {
    return false;
  }

  const normalizedValue = value.trim();
  const legacyPath = buildLegacySquareCropStoragePath(location);
  const currentPrefix = `generated/${location.clientId}/${location.batchId}/${location.jobId}/square_crops/`;

  return [
    legacyPath,
    encodeURIComponent(legacyPath),
    currentPrefix,
    encodeURIComponent(currentPrefix),
  ].some((candidate) => normalizedValue.includes(candidate));
};

export const generateAndStoreSquareCrop = async (
  sourceStoragePath: string,
  outputStoragePath: string,
  options: { poseFraming?: PoseFraming | null } = {},
): Promise<string> => {
  const [buffer] = await bucket.file(sourceStoragePath).download();
  const image = sharp(buffer, { failOn: 'none' });
  const { width = 0, height = 0 } = await image.metadata();

  const cropRegion: CropRegion = garmentSquareCrop(width, height, options.poseFraming);

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
