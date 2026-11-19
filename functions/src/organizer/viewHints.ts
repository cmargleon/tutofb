/**
 * Operators name views explicitly (AT-R01-TER-DETRAS, FRENTE, BACK...). An explicit, unambiguous file-name view
 * outranks the visual guess, which often calls a flat-lay back "front" because both look like a full garment.
 */
const VIEW_WORDS: Record<'front' | 'back' | 'side' | 'detail', RegExp> = {
  back: /(?:^|[^A-Z])(?:DETRAS|DETR[AÁ]S|ESPALDA|TRASERA|TRASERO|REVERSO|POSTERIOR|BACK|REAR)(?:[^A-Z]|$)/,
  front: /(?:^|[^A-Z])(?:FRENTE|FRONTAL|DELANTERA|DELANTERO|FRONT)(?:[^A-Z]|$)/,
  side: /(?:^|[^A-Z])(?:LATERAL|LADO|PERFIL|SIDE)(?:[^A-Z]|$)/,
  detail: /(?:^|[^A-Z])(?:DETALLE|ACERCAMIENTO|DETAIL|CLOSE ?UP|ZOOM)(?:[^A-Z]|$)/,
};
export function viewFromFileName(name: string): 'front' | 'back' | 'side' | 'detail' | null {
  const text = name.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[_]+/g, ' ');
  const matches = (Object.keys(VIEW_WORDS) as Array<keyof typeof VIEW_WORDS>).filter(view => VIEW_WORDS[view].test(text));
  return matches.length === 1 ? matches[0] : null;
}

/** Whole-word view markers, normalized (no accents, upper case). Never part of a catalog code. */
export const VIEW_TOKENS = new Set(['DETRAS', 'ESPALDA', 'TRASERA', 'TRASERO', 'REVERSO', 'POSTERIOR', 'BACK', 'REAR',
  'FRENTE', 'FRONTAL', 'DELANTERA', 'DELANTERO', 'FRONT', 'LATERAL', 'LADO', 'PERFIL', 'SIDE',
  'DETALLE', 'ACERCAMIENTO', 'DETAIL', 'CLOSEUP', 'ZOOM']);

/** File stem without extension and view words: "SR-02-AZR-FRENTE.jpg" and "sr 02 azr detras.png" share "SR 02 AZR". */
export function viewlessStem(name: string): string {
  return name.replace(/\.[^.]{2,5}$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(part => part && !VIEW_TOKENS.has(part)).join(' ');
}
