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

/**
 * Builds a square crop focused on the garment area of a fashion photo.
 *
 * For a 3:4 portrait (standard fashion output), skipping the top 28% of the
 * image height clears the model's head and leaves the chin/jaw barely visible
 * — satisfying the "at most a quarter of the face" requirement.
 *
 * The square size equals the full image width so the garment fills the frame.
 * For a perfect 3:4 image: H=4W/3, skip=0.28H≈0.373W, remaining≈0.96W ≈ W.
 */
const garmentSquareCrop = (imgWidth: number, imgHeight: number): CropRegion => {
  const skipTop = Math.floor(imgHeight * 0.28);
  const size = Math.min(imgWidth, imgHeight - skipTop);
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

  const cropRegion: CropRegion = garmentSquareCrop(width, height);

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
