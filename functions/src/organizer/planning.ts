import { type OrganizerPhoto, type OrganizerPlanItem, type OrganizerVariant } from '../../../shared/src/types';
import { digest, versionOf, type DriveEntry } from './drive';
import { contentVersionOf } from './baseCode';

/** `pathless` (base-code mode) keys a human decision to content and name only: moving a file keeps it valid. */
export const photoDecisionKey = (file: DriveEntry, variants: OrganizerVariant[], pathless = false) => digest(pathless
  ? ['pathless-1', contentVersionOf(file), file.name, variants.map(variant => [variant.id, variant.catalogFingerprint || '']).sort()]
  : [versionOf(file), file.name, file.path, variants.map(variant => [variant.id, variant.catalogFingerprint || '']).sort()]);
export function planFile(file: DriveEntry, photo: OrganizerPhoto | undefined, variants: OrganizerVariant[]): OrganizerPlanItem {
  const ids = photo?.variantIds || (photo?.variantId ? [photo.variantId] : []);
  const selected = variants.filter(variant => ids.includes(variant.id));
  return { id: file.id, name: file.name, sourcePath: file.path,
    destination: selected.map(variant => `${variant.name} · ${variant.visual}`), action: 'read',
    reason: selected.length ? 'Leer el original y actualizar sus relaciones en el catálogo de Tuto.' : 'Leer el original; identidad pendiente de revisión en Tuto.' };
}
