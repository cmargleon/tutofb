import type { JobOutput } from '../../../shared/src/types';
import { useStorageAssetUrl } from '../storage/useStorageAssetUrl';
import { selectCatalogPreviewPath } from './catalogPreviewPath';

/** Resolves the thumbnail URL, retrying with the full image if the thumbnail cannot be loaded. */
export const useCatalogPreviewUrl = (output: Pick<JobOutput, 'resultImagePath' | 'thumbnailPath'> | null | undefined) => {
  const thumbnail = useStorageAssetUrl(output?.thumbnailPath || null);
  const thumbnailFailed = Boolean(thumbnail.error);
  const path = selectCatalogPreviewPath(output, thumbnailFailed);
  const full = useStorageAssetUrl(path && path !== output?.thumbnailPath ? path : null);
  return path && path === output?.thumbnailPath ? thumbnail : full;
};
