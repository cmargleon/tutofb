import sharp from 'sharp';

/** Technical evidence complements visual segmentation. Four white corners alone are insufficient. */
export async function verifyWhiteBackground(bytes: Buffer): Promise<boolean> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 16 || info.height < 16) return false;
  const pixelWhite = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
  };
  // Require a continuous pure-white border plus a substantial white background area.
  let white = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const pure = pixelWhite(x, y);
    if ((x < 3 || y < 3 || x >= info.width - 3 || y >= info.height - 3) && !pure) return false;
    if (pure) white++;
  }
  return white / (info.width * info.height) >= .15;
}
