import type { MarketplaceId } from '../marketplaces';
import type { CatalogListId } from './vocabulary';
import { normalizeCatalogValue, WILDCARD_VALUES } from './vocabulary';

/**
 * Preferred spelling of a universal value in each marketplace when it differs from the universal one.
 * They are *candidates*: a candidate is used only if the category's real list contains it
 * (see `mapUniversalValues`). SHEIN entries come from the official MX templates; the others from public
 * documentation and must be confirmed with the official template of each category.
 */
export const PREFERRED_VALUES: Partial<Record<MarketplaceId, Partial<Record<CatalogListId, Record<string, string[]>>>>> = {
  shein: {
    color: {
      'Gris claro': ['Gris Claro'], 'Gris oscuro': ['Gris Oscuro', 'Gris carbón'], Beige: ['Beis'], Crema: ['Crema', 'Blanco Crema', 'Beis'],
      Café: ['Marrón', 'Café', 'Marrón Chocolate'], 'Azul marino': ['Azul Marino', 'azul oscuro'], 'Azul claro': ['Azul cielo', 'Celeste'],
      'Azul rey': ['azul real'], 'Mezclilla claro': ['Lavado ligero', 'Azul lavado medio'], 'Mezclilla oscuro': ['Azul lavado oscuro'],
      Turquesa: ['Azul Agua', 'Agua verde azul'], 'Verde oscuro': ['Verde Oscuro'], 'Verde olivo': ['Verde Oliva'], 'Verde menta': ['verde menta'],
      Mostaza: ['Amarillo Mostaza', 'Mostaza Amarilla'], Coral: ['Rosa coral', 'Naranja Coral', 'Rojo Coral'], Vino: ['Burdeos', 'Granate'],
      'Rosa claro': ['Rosa Pálido'], Fucsia: ['Rosa Fucsia'], Lila: ['Lila Púrpura', 'Morado Violeta'], Transparente: ['transparente'],
    },
    fibra: { Nailon: ['Nailon', 'Poliamida'], Rayón: ['Viscosa'], Elastano: ['Elastano', 'spandex'] },
    material: {
      'Acero inoxidable': ['Acero Inoxidable'], 'Metal (otro)': ['Metal'], Cerámica: ['cerámica', 'porcelana china'], Porcelana: ['porcelana china'],
      Melamina: ['Melamina', 'MF'], 'Plástico PP': ['PP'], 'Plástico PET': ['PET'], 'Plástico ABS': ['ABS'], 'Plástico PC': ['PC'],
      'Plástico (otro)': ['plástico'], 'Hule (caucho)': ['Caucho'], Madera: ['madera'], Bambú: ['bamboo'], 'Papel o cartón': ['Papel'],
      'Piel genuina': ['Piel Genuina'], 'Piel sintética': ['Poliuretano'], Gamuza: ['Ante'], 'Teflón (antiadherente)': ['teflón'], Piedra: ['piedra'],
    },
    material_calzado: {
      'Piel genuina': ['Piel Genuina', 'Piel Bovina'], 'Piel sintética': ['Poliuretano', 'Cuero sintético'], Gamuza: ['Ante'], Malla: ['Malla', 'Esponja de Malla', 'Rejilla'],
      'Tejido de punto': ['Tela tricotada', 'Prendas de punto', 'Jersey de Punto'], 'Hule (caucho)': ['Caucho', 'Caucho Sintético'], Espuma: ['Espuma', 'EVA'],
      'Plástico (otro)': ['plástico', 'PVC', 'Policloruro de vinilo'],
    },
    material_alimentos: {
      'Acero inoxidable': ['Acero Inoxidable'], Cerámica: ['porcelana china'], Porcelana: ['porcelana china'], Melamina: ['MF'],
      'Plástico PP': ['PP'], 'Plástico PET': ['PET'], 'Plástico PC': ['PC'], Madera: ['madera'], Bambú: ['bamboo'], 'Teflón (antiadherente)': ['teflón'],
    },
    pais: {
      México: ['Mexico(MX)'], China: ['China(CN)'], 'Estados Unidos': ['United States(US)'], Vietnam: ['Vietnam(VN)'], Bangladesh: ['Bangladesh(BD)'],
      India: ['India(IN)'], Pakistán: ['Pakistan(PK)'], Indonesia: ['Indonesia(ID)'], Camboya: ['Cambodia(KH)'], Tailandia: ['Thailand(TH)'],
      Turquía: ['Turkey(TR)'], Guatemala: ['Guatemala(GT)'], Colombia: ['Colombia(CO)'], Perú: ['Peru(PE)'], Brasil: ['Brazil(BR)'],
      España: ['Spain(ES)'], Italia: ['Italy(IT)'], Portugal: ['Portugal(PT)'], 'Corea del Sur': ['South Korea(KR)'], Taiwán: ['Taiwan China(TW)'],
    },
    cuidado: {
      'Lavado a máquina': ['Lavadora, no limpiar en seco', 'lavadora o limpieza en seco profesional'],
      'Lavado a máquina, no usar secadora': ['Lavado a máquina, no limpiar en seco, lavar con un detergente suave'],
      'Lavado a mano': ['Lavar a mano, no limpiar en seco'], 'Lavado en seco': ['(Alto contenido de lana) Solo limpieza en seco.'],
      'Lavado a mano o en seco': ['Lavado a mano o limpieza en seco profesional', 'Lavado en seco o a mano'], 'No lavar (limpiar con paño)': ['No lavar', 'Solo toallita húmeda'],
    },
    tamano: { Unitalla: ['one-size', 'Talla única', 'Unitalla'] },
    talla_ropa: { Unitalla: ['one-size', 'Talla única', 'Unitalla'], '2XL': ['XXL', '2XL'], '3XL': ['XXXL', '3XL'] },
  },
  amazon: {
    // color_map family (Amazon fixed list); color_name keeps the universal or commercial name.
    color: {
      'Gris claro': ['Gris'], 'Gris oscuro': ['Gris'], Crema: ['Beige'], Café: ['Marrón'], Camel: ['Marrón'], Caqui: ['Beige'],
      'Azul marino': ['Azul'], 'Azul claro': ['Azul'], 'Azul rey': ['Azul'], 'Mezclilla claro': ['Azul'], 'Mezclilla oscuro': ['Azul'],
      Turquesa: ['Azul'], 'Verde oscuro': ['Verde'], 'Verde olivo': ['Verde'], 'Verde militar': ['Verde'], 'Verde menta': ['Verde'],
      Mostaza: ['Amarillo'], Coral: ['Naranja'], Vino: ['Rojo'], 'Rosa claro': ['Rosa'], Fucsia: ['Rosa'], Lila: ['Morado'],
    },
  },
  'mercado-libre': { color: { Café: ['Marrón', 'Café'], Vino: ['Bordó', 'Vino'], Morado: ['Violeta', 'Morado'], 'Verde olivo': ['Verde oliva'] } },
  'tiktok-shop': {},
};

export type ValueMatchKind = 'exacto' | 'equivalente' | 'regla' | 'comodin' | 'sin_equivalente';
export interface ValueMatch { universal: string; target: string | null; kind: ValueMatchKind }

/** Size rules: universal size → candidates in marketplace notation (SHEIN uses 8Y / 0-3M / EUR sizes). */
const sizeCandidates = (value: string): string[] => {
  const years = value.match(/^(\d+) años?$/);
  if (years) { const n = Number(years[1]); return [`${n}Y`, `${n}-${n + 1}Y`, `${n - 1}-${n}Y`, String(n), `${n} años`]; }
  const months = value.match(/^(\d+)-(\d+) meses$/);
  if (months) return [`${months[1]}-${months[2]}M`, value];
  return [];
};
/** Mexican shoe size → EUR (SHEIN lists footwear in EUR). Standard MX conversion table. */
const MX_TO_EUR: Record<string, string> = {
  '12': '20', '13': '21', '14': '22', '15': '23.5', '16': '25', '17': '27', '18': '29', '19': '30.5', '20': '32', '21': '33.5', '22': '35',
  '22.5': '35.5', '23': '36', '23.5': '37', '24': '37.5', '24.5': '38', '25': '39', '25.5': '40', '26': '40.5', '26.5': '41', '27': '42',
  '27.5': '42.5', '28': '43', '28.5': '44', '29': '44.5', '29.5': '45', '30': '46', '31': '47',
};
const shoeCandidates = (value: string) => {
  const eur = MX_TO_EUR[value];
  return eur ? [`EUR${eur}`, eur, `EUR${Math.round(Number(eur))}`] : [];
};

/**
 * Map every value of a universal list to the allowed values of one marketplace column.
 * Order: exact (accent/case-insensitive) → preferred equivalent present in the list → size rule → none.
 * Never invents a value: `target` is always one of `allowed`.
 */
export function mapUniversalValues(marketplaceId: MarketplaceId, listId: CatalogListId, universal: readonly string[], allowed: readonly string[],
  overrides: Record<string, string> = {}): ValueMatch[] {
  const byNorm = new Map(allowed.map(v => [normalizeCatalogValue(v), v]));
  const preferred = PREFERRED_VALUES[marketplaceId]?.[listId] || {};
  return universal.map(value => {
    if (overrides[value] !== undefined && allowed.includes(overrides[value])) return { universal: value, target: overrides[value], kind: 'equivalente' };
    if (WILDCARD_VALUES.has(value)) return { universal: value, target: null, kind: 'comodin' };
    const exact = byNorm.get(normalizeCatalogValue(value));
    if (exact) return { universal: value, target: exact, kind: 'exacto' };
    const synonym = (preferred[value] || []).map(c => byNorm.get(normalizeCatalogValue(c))).find(Boolean);
    if (synonym) return { universal: value, target: synonym, kind: 'equivalente' };
    const rule = listId === 'talla_ropa' ? sizeCandidates(value) : listId === 'talla_calzado' ? shoeCandidates(value) : [];
    const ruled = rule.map(c => byNorm.get(normalizeCatalogValue(c))).find(Boolean);
    if (ruled) return { universal: value, target: ruled, kind: 'regla' };
    return { universal: value, target: null, kind: 'sin_equivalente' };
  });
}

/** SHEIN composition format: "Algodón*Elastano=95*5". */
export const sheinComposition = (parts: Array<{ fiber: string; pct: number }>) =>
  `${parts.map(p => p.fiber).join('*')}=${parts.map(p => p.pct).join('*')}`;
/** Text composition used by Amazon, Mercado Libre and TikTok Shop: "95% Algodón, 5% Elastano". */
export const textComposition = (parts: Array<{ fiber: string; pct: number }>) => parts.map(p => `${p.pct}% ${p.fiber}`).join(', ');
