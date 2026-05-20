import {
  AccessoryDisplaySlot,
  GarmentAccessoryType,
  PoseBodyFocus,
  PoseOrientationGroup,
} from '../types';

export const GARMENT_ACCESSORY_TYPES = [
  'backpack',
  'shoulder_bag',
  'crossbody_bag',
  'handbag',
  'tote_bag',
  'duffel_bag',
  'generic_carry_accessory',
] as const satisfies readonly GarmentAccessoryType[];

export const ACCESSORY_DISPLAY_SLOTS = [
  'back',
  'shoulder',
  'crossbody',
  'handheld',
  'front_torso',
] as const satisfies readonly AccessoryDisplaySlot[];

export const isGarmentAccessoryType = (value: unknown): value is GarmentAccessoryType =>
  typeof value === 'string' && (GARMENT_ACCESSORY_TYPES as readonly string[]).includes(value);

export const isAccessoryDisplaySlot = (value: unknown): value is AccessoryDisplaySlot =>
  typeof value === 'string' && (ACCESSORY_DISPLAY_SLOTS as readonly string[]).includes(value);

export const normalizeAccessoryDisplaySlots = (
  values: readonly unknown[] | null | undefined,
): AccessoryDisplaySlot[] => {
  const seen = new Set<AccessoryDisplaySlot>();
  const normalized: AccessoryDisplaySlot[] = [];

  (values || []).forEach((value) => {
    if (isAccessoryDisplaySlot(value) && !seen.has(value)) {
      seen.add(value);
      normalized.push(value);
    }
  });

  return normalized;
};

const normalizeComparableAccessoryText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const inferGarmentAccessoryTypeFromText = (
  values: Array<string | null | undefined>,
): GarmentAccessoryType | null => {
  const normalized = values
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeComparableAccessoryText)
    .join(' ');

  if (/\b(mochila|mochilas|backpack|backpacks|morral|morrales)\b/.test(normalized)) return 'backpack';
  if (/\b(crossbody|bandolera|bandoleras|cruzada|cruzadas)\b/.test(normalized)) return 'crossbody_bag';
  if (/\b(tote|totes)\b/.test(normalized)) return 'tote_bag';
  if (/\b(duffel|duffels|maleta|maletas|bolsa de gimnasio|bolsas de gimnasio)\b/.test(normalized)) return 'duffel_bag';
  if (/\b(handbag|handbags|bolso de mano|bolsos de mano|cartera|carteras)\b/.test(normalized)) return 'handbag';
  if (/\b(shoulder bag|shoulder bags|bolsa de hombro|bolsas de hombro|bolso de hombro|bolsos de hombro)\b/.test(normalized)) return 'shoulder_bag';

  return null;
};

export const deriveAccessoryDisplaySlots = ({
  orientationGroup,
  bodyFocus,
  faceVisible,
}: {
  orientationGroup?: PoseOrientationGroup | null;
  bodyFocus?: PoseBodyFocus | null;
  faceVisible?: boolean | null;
}): AccessoryDisplaySlot[] => {
  if (bodyFocus !== 'full_body' && bodyFocus !== 'upper_body') {
    return [];
  }

  switch (orientationGroup) {
    case 'back':
      return ['back', 'shoulder'];
    case 'side':
      return ['shoulder', 'crossbody', 'handheld'];
    case 'front':
      return ['shoulder', 'crossbody', 'handheld', 'front_torso'];
    case 'ambiguous':
    default:
      return faceVisible ? ['shoulder', 'crossbody'] : [];
  }
};

export const getRequiredAccessoryDisplaySlots = (
  accessoryType: GarmentAccessoryType | null | undefined,
): AccessoryDisplaySlot[] => {
  switch (accessoryType) {
    case 'backpack':
      return ['back'];
    case 'crossbody_bag':
      return ['crossbody', 'front_torso'];
    case 'shoulder_bag':
      return ['shoulder'];
    case 'handbag':
    case 'tote_bag':
    case 'duffel_bag':
      return ['handheld', 'shoulder'];
    case 'generic_carry_accessory':
    default:
      return ['shoulder', 'crossbody', 'handheld', 'back', 'front_torso'];
  }
};

export const canPoseShowCarryAccessory = (
  accessoryType: GarmentAccessoryType | null | undefined,
  poseSlots: readonly AccessoryDisplaySlot[] | null | undefined,
): boolean => {
  const requiredSlots = getRequiredAccessoryDisplaySlots(accessoryType);
  const poseSlotSet = new Set(poseSlots || []);
  return requiredSlots.some((slot) => poseSlotSet.has(slot));
};
