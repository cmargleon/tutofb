import type { JobOutput } from '../../../shared/src/types';

/**
 * Grid previews prefer the small thumbnail. When the output has none (jobs created before
 * thumbnails existed) or the thumbnail fails to load, fall back to the full image.
 */
export const selectCatalogPreviewPath = (
  output: Pick<JobOutput, 'resultImagePath' | 'thumbnailPath'> | null | undefined,
  thumbnailFailed = false,
): string | null => {
  if (!output) return null;
  if (output.thumbnailPath && !thumbnailFailed) return output.thumbnailPath;
  return output.resultImagePath || null;
};
