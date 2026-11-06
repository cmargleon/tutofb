import { ORGANIZER_CATALOG_DIRECTORY, type OrganizerPhoto, type OrganizerPlanItem, type OrganizerVariant } from '../../../shared/src/types';
import { digest, versionOf, type DriveEntry } from './drive';

const safe = (text: string) => text.replace(/[\\/\u0000-\u001f]/g, ' ').trim().slice(0, 100);
export const stableDestination = (photo: OrganizerPhoto | undefined, variants: OrganizerVariant[], sources: string): string[] => {
  const ids = photo?.variantIds || (photo?.variantId ? [photo.variantId] : []);
  const variant = ids.length === 1 ? variants.find(value => value.id === ids[0]) : undefined;
  return variant ? [ORGANIZER_CATALOG_DIRECTORY, safe(variant.base),
    `${safe([variant.visual, variant.color, variant.capacity, variant.pack].filter(Boolean).join(' · '))} · ${variant.id.slice(0, 12)}`] : [sources];
};
export const photoDecisionKey = (file: DriveEntry, variants: OrganizerVariant[]) => digest([
  versionOf(file), file.name, file.path, variants.map(variant => [variant.id, variant.catalogFingerprint || '']).sort(),
]);
export function planFile(file: DriveEntry, photo: OrganizerPhoto | undefined, variants: OrganizerVariant[], sources: string,
  prior?: { copiedId?: string; stableLayout?: boolean; parentId?: string }): OrganizerPlanItem {
  return { id: file.id, name: file.name, sourcePath: file.path, destination: stableDestination(photo, variants, sources),
    currentFolderUrl: prior?.parentId ? `https://drive.google.com/drive/folders/${prior.parentId}` : null,
    action: !prior?.copiedId ? 'copy' : prior.stableLayout ? 'reuse' : 'retain_legacy',
    reason: prior?.copiedId && !prior.stableLayout ? 'Conservar ubicación existente. Una migración necesita una simulación y aprobación propias.' :
      (photo?.variantIds?.length || 0) > 1 ? 'Archivo canónico compartido; relaciones múltiples en el catálogo, sin duplicar la copia.' :
        photo?.variantId ? 'Carpeta estable por producto y variante; el estado es un filtro.' : 'Conservar copia canónica sin identidad confirmada.' };
}
