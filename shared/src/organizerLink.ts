import type { OrganizerLinkCandidate, OrganizerLinkCandidates, OrganizerPhoto, OrganizerVariant } from './types/organizer';
import { commercialIdentityOf, uncodedGroupName } from './organizerIdentity';

export const NO_COMMERCIAL_ROW = 'No se pudo vincular: no hay ninguna fila del Excel para esta prenda. Agrega una fila al Excel y sincroniza.';
export const NO_COMMERCIAL_MATCH = 'No se pudo vincular (sin coincidencia)';

/** A visual variant covers all its commercial size rows. Reference approval is independent. */
export function freeCommercialVariants(variants: OrganizerVariant[], photos: OrganizerPhoto[]) {
  const occupied = new Set(photos.flatMap(raw => {
    const photo = commercialIdentityOf(raw);
    return photo.variantIds?.length ? photo.variantIds : photo.variantId ? [photo.variantId] : [];
  }));
  return variants.filter(variant => !occupied.has(variant.id) && (variant.skcs.length || variant.skus.length));
}

export function pendingCommercialGroup(groupId: string, photos: OrganizerPhoto[], candidates: OrganizerLinkCandidate[]): OrganizerLinkCandidates {
  return { groupId, name: uncodedGroupName(photos[0].name) || photos[0].name, photoIds: photos.map(photo => photo.id).sort(),
    state: 'pending_link', severity: candidates.length ? 'warning' : 'error',
    message: candidates.length ? NO_COMMERCIAL_MATCH : NO_COMMERCIAL_ROW, candidates };
}
