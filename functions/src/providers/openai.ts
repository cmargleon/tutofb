// Legacy size mapping retained for historical records. Image generation uses fal.ai only.
import { AspectRatio } from '../../../shared/src/types';
import { mapLegacyAspectRatioToOpenAIImageSize } from '../../../shared/src/providerImageConfig';
export const mapAspectRatioToOpenAISize = (aspectRatio: AspectRatio): string =>
  mapLegacyAspectRatioToOpenAIImageSize(aspectRatio);
