import sharp from 'sharp';
import { addSyntheticPerformerXmp, hasSyntheticPerformerXmp } from './photoPlanFile';
import { prepareMarketplaceImage } from './prepareMarketplaceImage';

type Point = [number, number];
interface Segmentation {
  complete: boolean;
  box: number[];
  outline: Point[];
}

const imageOptions = { limitInputPixels: 40_000_000 };

export function squareProductCrop(width: number, height: number, segmentation: unknown) {
  const result = segmentation as Partial<Segmentation> | null;
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000;
  if (result?.complete !== true || !Array.isArray(result.box) || result.box.length !== 4 ||
      !result.box.every(valid) || !Array.isArray(result.outline) || result.outline.length < 3 || result.outline.length > 256 ||
      !result.outline.every(point => Array.isArray(point) && point.length === 2 && point.every(valid))) return null;

  const [top, left, bottom, right] = result.box;
  if (top >= bottom || left >= right) return null;
  // Use the union so a thin part reported by either the box or the outline is preserved.
  const minX = Math.floor(Math.min(left, ...result.outline.map(([x]) => x)) * width / 1000);
  const maxX = Math.ceil(Math.max(right, ...result.outline.map(([x]) => x)) * width / 1000);
  const minY = Math.floor(Math.min(top, ...result.outline.map(([, y]) => y)) * height / 1000);
  const maxY = Math.ceil(Math.max(bottom, ...result.outline.map(([, y]) => y)) * height / 1000);
  const size = Math.min(width, height);
  const margin = Math.ceil(size * .05);
  const x = Math.max(0, Math.min(width - size, Math.round((minX + maxX - size) / 2)));
  const y = Math.max(0, Math.min(height - size, Math.round((minY + maxY - size) / 2)));
  if (minX - x < margin || minY - y < margin || x + size - maxX < margin || y + size - maxY < margin) return null;
  return { left: x, top: y, width: size, height: size };
}

export async function prepareMarketplaceSquare(
  bytes: Buffer,
  segment: ((sample: Buffer) => Promise<unknown>) | null,
) {
  const metadata = await sharp(bytes, imageOptions).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('Se requiere una imagen estática válida.');
  const { width, height } = metadata.autoOrient;
  if (Math.min(width, height) < 900) throw new Error('La foto para SHEIN debe tener al menos 900 px en su lado corto.');
  const oriented = sharp(bytes, imageOptions).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb');
  let square: Buffer;
  if (segment) {
    const sample = await oriented.clone().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
    const crop = squareProductCrop(width, height, await segment(sample));
    if (!crop) return null;
    // Materialize rotation before applying coordinates from the oriented sample.
    const image = await oriented.raw().toBuffer({ resolveWithObject: true });
    square = await sharp(image.data, { raw: { width, height, channels: image.info.channels } })
      .extract(crop).resize(2200, 2200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  } else {
    const side = Math.min(2200, Math.max(width, height));
    square = await oriented.resize(side, side, { fit: 'contain', background: '#ffffff' })
      .jpeg({ quality: 92 }).toBuffer();
  }
  return prepareMarketplaceImage(hasSyntheticPerformerXmp(bytes) ? addSyntheticPerformerXmp(square) : square, 'shein');
}
