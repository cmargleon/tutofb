import type { OrganizerPhoto } from './types/organizer';

/** Explicit no-code article name, independent of view and camera sequence. */
export function uncodedGroupName(name: string): string | null {
  const stem = name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  if (!/^SINCOD[_\s-]/.test(stem)) return null;
  return stem.replace(/(?:[_\s-]+(?:FRENTE|FRONTAL|FRONT|ESPALDA|DETRAS|BACK|TRASERA|LATERAL|SIDE|DETALLE|DETAIL))?(?:[_\s-]+\d+)?$/, '');
}

/** Prevent old automatic suggestions from resurfacing for explicitly uncoded articles. */
export function commercialIdentityOf<T extends OrganizerPhoto>(photo: T): T {
  if (!uncodedGroupName(photo.name) || photo.reviewedBy) return photo;
  return { ...photo, baseId: null, variantId: null, variantIds: [], candidates: [], candidateDetails: [], referenceEligibleFor: [],
    identityState: 'unresolved', method: 'sin_codigo', confidence: 0,
    baseCodeIdentity: { baseId: null, baseCode: null, variantId: null, candidates: [], method: 'sin_codigo', issue: 'Sin ficha comercial' },
    ...(photo.visualHint ? { visualHint: { ...photo.visualHint, groupId: `uncoded:${uncodedGroupName(photo.name)}` } } : {}),
    issue: 'Sin ficha comercial: el nombre no contiene un código reconocible del catálogo.' };
}
