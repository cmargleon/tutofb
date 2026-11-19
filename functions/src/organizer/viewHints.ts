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
