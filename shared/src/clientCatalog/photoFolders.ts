/**
 * Photo folder convention of the client catalog:
 *
 *   FOTOS/<SPU>/<archivo>          the SPU has a single SKC: photos straight in the SPU folder
 *   FOTOS/<SPU>/<SKC>/<archivo>    the SPU has several SKC: one subfolder per SKC (exact code)
 *
 * A subfolder may also be named after the color when that color identifies a single SKC of the SPU
 * (FOTOS/CAM001/Negro/). File names are free.
 */
import { normalizeCatalogValue } from './vocabulary';

export interface CatalogVariantRef { spu: string; skc: string; color?: string }
export interface PhotoFile { path: string[] /* folders below FOTOS, then the file name */ }
export type PhotoIssueCode = 'spu_desconocido' | 'skc_ambiguo' | 'subcarpeta_desconocida' | 'demasiado_profundo' | 'fuera_de_spu' | 'carpeta_spu_sin_sku';
export interface PhotoResolution {
  file: PhotoFile;
  skc: string | null;
  spu: string | null;
  issue?: { code: PhotoIssueCode; message: string };
}

const code = (value: string) => normalizeCatalogValue(value).replace(/\s*-\s*/g, '-');

export function resolvePhotoFolders(variants: readonly CatalogVariantRef[], files: readonly PhotoFile[]): PhotoResolution[] {
  const bySpu = new Map<string, CatalogVariantRef[]>();
  for (const v of variants) {
    const key = code(v.spu);
    const list = bySpu.get(key) ?? [];
    if (!list.some(x => code(x.skc) === code(v.skc))) list.push(v);
    bySpu.set(key, list);
  }
  return files.map(file => {
    const fail = (codeId: PhotoIssueCode, message: string, spu: string | null = null): PhotoResolution => ({ file, skc: null, spu, issue: { code: codeId, message } });
    const [spuFolder, second, ...rest] = file.path;
    if (file.path.length < 2) return fail('fuera_de_spu', 'La foto está directamente en FOTOS: debe ir dentro de la carpeta de su SPU.');
    const skcs = bySpu.get(code(spuFolder));
    if (!skcs) {
      // Tolerate the older flat convention FOTOS/<SKC>/ when the folder name is an exact SKC.
      const flat = variants.find(v => code(v.skc) === code(spuFolder));
      if (flat && file.path.length === 2) return { file, skc: flat.skc, spu: flat.spu };
      return fail('spu_desconocido', `La carpeta «${spuFolder}» no coincide con ningún SPU del catálogo.`);
    }
    const spu = skcs[0].spu;
    if (file.path.length === 2) {
      if (skcs.length === 1) return { file, skc: skcs[0].skc, spu };
      return fail('skc_ambiguo', `El SPU ${spu} tiene ${skcs.length} SKC: la foto debe ir en la subcarpeta de su SKC.`, spu);
    }
    if (rest.length > 1) return fail('demasiado_profundo', 'Hay más de un nivel de subcarpetas dentro del SPU.', spu);
    const byCode = skcs.find(v => code(v.skc) === code(second));
    if (byCode) return { file, skc: byCode.skc, spu };
    const byColor = skcs.filter(v => v.color && normalizeCatalogValue(v.color) === normalizeCatalogValue(second));
    if (byColor.length === 1) return { file, skc: byColor[0].skc, spu };
    if (byColor.length > 1) return fail('skc_ambiguo', `«${second}» corresponde a ${byColor.length} SKC del SPU ${spu}: usa el código SKC como nombre de carpeta.`, spu);
    return fail('subcarpeta_desconocida', `La subcarpeta «${second}» no coincide con ningún SKC ni color del SPU ${spu}.`, spu);
  });
}

/** Folders to create for a catalog: one per SPU, plus one per SKC when the SPU has several. */
export function expectedPhotoFolders(variants: readonly CatalogVariantRef[]): string[][] {
  const bySpu = new Map<string, Set<string>>();
  for (const v of variants) bySpu.set(v.spu, (bySpu.get(v.spu) ?? new Set()).add(v.skc));
  return [...bySpu].flatMap(([spu, skcs]) => skcs.size > 1 ? [[spu], ...[...skcs].map(skc => [spu, skc])] : [[spu]]);
}
