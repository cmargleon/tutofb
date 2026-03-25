import {
  GarmentView,
  PoseAiClassification,
  PoseFraming,
  PoseOrientationDetail,
  PoseOrientationGroup,
  TimestampLike,
} from '../types';

export const POSE_AI_CLASSIFICATION_VERSION = 1;

export const POSE_ORIENTATION_DETAILS = [
  'front',
  'front_three_quarter',
  'back',
  'back_three_quarter',
  'left_profile',
  'right_profile',
  'ambiguous',
] as const satisfies readonly PoseOrientationDetail[];

export const POSE_FRAMINGS = [
  'full_body',
  'three_quarter_body',
  'medium_body',
  'unknown',
] as const satisfies readonly PoseFraming[];

export const isPoseOrientationDetail = (value: unknown): value is PoseOrientationDetail =>
  typeof value === 'string' && (POSE_ORIENTATION_DETAILS as readonly string[]).includes(value);

export const isPoseFraming = (value: unknown): value is PoseFraming =>
  typeof value === 'string' && (POSE_FRAMINGS as readonly string[]).includes(value);

export const derivePoseOrientationGroup = (
  orientationDetail: PoseOrientationDetail,
): PoseOrientationGroup => {
  switch (orientationDetail) {
    case 'front':
    case 'front_three_quarter':
      return 'front';
    case 'back':
    case 'back_three_quarter':
      return 'back';
    case 'left_profile':
    case 'right_profile':
      return 'side';
    case 'ambiguous':
    default:
      return 'ambiguous';
  }
};

export const derivePoseUsableForGarmentViews = (
  orientationDetail: PoseOrientationDetail,
): GarmentView[] => {
  switch (orientationDetail) {
    case 'front':
      return ['front'];
    case 'front_three_quarter':
      return ['front', 'side'];
    case 'back':
      return ['back'];
    case 'back_three_quarter':
      return ['back', 'side'];
    case 'left_profile':
    case 'right_profile':
      return ['side'];
    case 'ambiguous':
    default:
      return [];
  }
};

const AUTO_CATEGORY_DETAIL_LABELS: Record<PoseOrientationDetail, string> = {
  front: 'frente',
  front_three_quarter: 'frente_3_4',
  back: 'espalda',
  back_three_quarter: 'espalda_3_4',
  left_profile: 'perfil_izquierdo',
  right_profile: 'perfil_derecho',
  ambiguous: 'ambigua',
};

const AUTO_CATEGORY_FRAMING_LABELS: Record<PoseFraming, string> = {
  full_body: 'cuerpo_completo',
  three_quarter_body: 'tres_cuartos',
  medium_body: 'medio_cuerpo',
  unknown: 'encuadre_desconocido',
};

export const buildPoseAutoCategory = (
  orientationDetail: PoseOrientationDetail,
  framing: PoseFraming,
): string => `${AUTO_CATEGORY_DETAIL_LABELS[orientationDetail]}_${AUTO_CATEGORY_FRAMING_LABELS[framing]}`;

export const formatPoseAutoCategoryLabel = (autoCategory: string | null | undefined): string => {
  if (!autoCategory) {
    return 'Sin tag IA';
  }

  return autoCategory
    .split('_')
    .join(' ')
    .replace(/\b3 4\b/g, '3/4')
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const buildPoseAiClassification = ({
  orientationDetail,
  framing,
  confidence,
  taggedAt,
  reasoning = null,
}: {
  orientationDetail: PoseOrientationDetail;
  framing: PoseFraming;
  confidence: number | null;
  taggedAt: TimestampLike;
  reasoning?: string | null;
}): PoseAiClassification => ({
  orientationGroup: derivePoseOrientationGroup(orientationDetail),
  orientationDetail,
  framing,
  autoCategory: buildPoseAutoCategory(orientationDetail, framing),
  usableForGarmentViews: derivePoseUsableForGarmentViews(orientationDetail),
  confidence,
  taggedBy: 'gemini',
  taggedAt,
  version: POSE_AI_CLASSIFICATION_VERSION,
  reasoning,
});
