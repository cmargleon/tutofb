import sharp from 'sharp';
import type { MarketplaceId } from '../../../shared/src/marketplaces';

// A changed transform must use a new version: published URLs never change their bytes.
export const MARKETPLACE_IMAGE_PROFILE_VERSION = 'jpeg-v1';
export const MARKETPLACE_IMAGE_MAX_BYTES = 2_900_000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export async function prepareMarketplaceImage(bytes: Buffer, marketplaceId: MarketplaceId) {
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('La imagen supera 32 MB; prepara una versión más pequeña.');
  const inputOptions = { limitInputPixels: 40_000_000 };
  const source = sharp(bytes, inputOptions);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('Se requiere una imagen estática válida.');
  const rotated = metadata.orientation && metadata.orientation >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const minSide = marketplaceId === 'shein' ? 900 : marketplaceId === 'tiktok-shop' ? 600 : 500;
  if (Math.min(width, height) < minSide) throw new Error(`La imagen debe tener al menos ${minSide} px en su lado más corto para este destino.`);
  const maxSide = marketplaceId === 'mercado-libre' ? 1920 : 2200;
  const square = marketplaceId === 'shein' || (marketplaceId === 'tiktok-shop' && (width / height < 3 / 4 || width / height > 4 / 3))
    || Math.min(width, height) * Math.min(1, maxSide / Math.max(width, height)) < minSide;
  const squareSide = Math.min(maxSide, Math.max(width, height));
  for (const quality of [90, 85, 80, 75, 70, 60]) {
    let pipeline = sharp(bytes, inputOptions).rotate().flatten({ background: '#ffffff' }).toColourspace('srgb');
    pipeline = square
      ? pipeline.resize(squareSide, squareSide, { fit: 'contain', background: '#ffffff' })
      : pipeline.resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (data.length <= MARKETPLACE_IMAGE_MAX_BYTES) return { bytes: data, width: info.width, height: info.height, contentType: 'image/jpeg' as const };
  }
  throw new Error('No se pudo preparar una imagen de menos de 2,9 MB conservando la resolución requerida.');
}
