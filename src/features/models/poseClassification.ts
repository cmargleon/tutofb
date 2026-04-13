import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import { PoseAiClassification, PoseFraming, PoseOrientationDetail } from '../../../shared/src/types';
import { PosePromptCategory, PosePromptOrientation, PoseRecipe } from './types';

const toOrientationDetail = (orientation: PosePromptOrientation): PoseOrientationDetail => {
  switch (orientation) {
    case 'front':
      return 'front';
    case 'front_three_quarter':
      return 'front_three_quarter';
    case 'profile_left':
      return 'left_profile';
    case 'profile_right':
      return 'right_profile';
    case 'back':
      return 'back';
    case 'back_three_quarter':
      return 'back_three_quarter';
    default:
      return 'ambiguous';
  }
};

const toFraming = (category: PosePromptCategory): PoseFraming => {
  switch (category) {
    case 'full_body':
      return 'full_body';
    case 'half_body':
      return 'medium_body';
    case 'lower_body':
      return 'lower_body';
    case 'footwear_closeup':
      return 'feet_closeup';
    case 'portrait':
      return 'medium_body';
    default:
      return 'unknown';
  }
};

const recipeShowsFace = (category: PosePromptCategory): boolean =>
  category !== 'lower_body' && category !== 'footwear_closeup';

export const buildManualPoseClassification = (recipe: PoseRecipe): PoseAiClassification =>
  buildPoseAiClassification({
    orientationDetail: toOrientationDetail(recipe.promptProfile.orientation),
    framing: toFraming(recipe.promptProfile.category),
    faceVisible: recipe.manualFaceVisible ?? recipeShowsFace(recipe.promptProfile.category),
    confidence: null,
    displayLabel: recipe.label,
    taggedBy: 'manual',
    taggedAt: new Date().toISOString(),
  });
