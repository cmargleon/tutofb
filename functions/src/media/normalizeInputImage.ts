import sharp from 'sharp';
import { HttpsError } from 'firebase-functions/v2/https';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export const normalizeInputImage = async (bytes: Buffer): Promise<Buffer> => {
  if (!bytes.length || bytes.length >= MAX_INPUT_BYTES) throw new HttpsError('invalid-argument', 'Imagen vacía o de más de 10 MB.');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw new HttpsError('invalid-argument', 'Usa una fotografía JPEG, PNG o WebP.');
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 94 }).toBuffer();
  } catch { throw new HttpsError('invalid-argument', 'Archivo de imagen no compatible.'); }
};
