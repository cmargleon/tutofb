import sharp from 'sharp';

export const GENERATED_THUMBNAIL_MAX_SIDE = 480;
export const GENERATED_THUMBNAIL_JPEG_QUALITY = 80;
export const GENERATED_THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

/** Minimal slice of a GCS bucket so this module stays testable without firebase-admin. */
export interface ThumbnailBucket {
  file(path: string): {
    save(data: Buffer, options: { resumable: boolean; metadata: { contentType: string; cacheControl: string } }): Promise<unknown>;
  };
}

/**
 * Thumbnail lives next to the full image: generated/{c}/{b}/{j}/{outputId}.png -> {outputId}_thumb.jpg.
 * The `_thumb` suffix keeps it from colliding with an original that is already a .jpg.
 */
export const buildGeneratedThumbnailPath = (resultImagePath: string): string => {
  const slash = resultImagePath.lastIndexOf('/');
  const fileName = resultImagePath.slice(slash + 1);
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${resultImagePath.slice(0, slash + 1)}${stem}_thumb.jpg`;
};

export const renderGeneratedThumbnail = async (bytes: Buffer): Promise<Buffer> =>
  sharp(bytes, { failOn: 'none', limitInputPixels: 60_000_000 })
    .rotate()
    .resize({
      width: GENERATED_THUMBNAIL_MAX_SIDE,
      height: GENERATED_THUMBNAIL_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // JPEG has no alpha: flatten transparent PNG/WebP onto white instead of black.
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: GENERATED_THUMBNAIL_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

/**
 * Best effort: renders and uploads the thumbnail and returns its path, or null on any failure.
 * Never throws, so a thumbnail problem can never fail the job.
 */
export const createGeneratedThumbnail = async ({
  bucket,
  bytes,
  resultImagePath,
}: {
  bucket: ThumbnailBucket;
  bytes: Buffer;
  resultImagePath: string;
}): Promise<string | null> => {
  const thumbnailPath = buildGeneratedThumbnailPath(resultImagePath);
  try {
    const thumbnail = await renderGeneratedThumbnail(bytes);
    await bucket.file(thumbnailPath).save(thumbnail, {
      resumable: false,
      metadata: {
        contentType: GENERATED_THUMBNAIL_CONTENT_TYPE,
        cacheControl: 'private, max-age=31536000',
      },
    });
    return thumbnailPath;
  } catch (error) {
    console.error(`[generatedThumbnail] Could not create thumbnail for ${resultImagePath}:`, error);
    return null;
  }
};
