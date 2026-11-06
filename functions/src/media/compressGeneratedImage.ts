import sharp from 'sharp';

const MAX_STORED_OUTPUT_BYTES = 3 * 1024 * 1024;
const OUTPUT_JPEG_QUALITIES = [90, 82, 74, 66, 58, 50] as const;
const OUTPUT_LONGEST_SIDES = [2200, 2000, 1800, 1600, 1400, 1200, 1000] as const;

export const compressGeneratedImageIfNeeded = async ({
  bytes,
  contentType,
}: {
  bytes: Buffer;
  contentType: string;
}): Promise<{ bytes: Buffer; contentType: string }> => {
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
