import type { MarketplaceId } from '../marketplaces';
import { catalogTypeId, familyOfType } from './families';
import { normalizeCatalogValue } from './vocabulary';

export type CatalogAudience = 'mujer' | 'hombre' | 'unisex' | 'nina' | 'nino' | 'infantil' | 'bebe';

/** Which universal product types (and audience) a marketplace category represents. */
export interface CategoryRoute {
  typeIds: string[];
  audience: CatalogAudience | null;
  /** known: confirmed table below or by an operator; suggested: keyword guess that needs confirmation. */
  confidence: 'known' | 'suggested' | 'unresolved';
  reason: string;
}

/** SHEIN sheet names end with "(groupId-categoryId)"; the pair is stable even when the label is truncated. */
export const sheinCategoryKey = (sheetName: string) => sheetName.match(/\((\d+-\d+)\)\s*$/)?.[1] ?? null;

const t = (...labels: string[]) => labels.map(catalogTypeId);
const known = (typeIds: string[], audience: CatalogAudience | null, reason: string): CategoryRoute => ({ typeIds, audience, confidence: 'known', reason });

/**
 * Confirmed routes for SHEIN MX categories seen in real client templates (Barbie, Messi, VANS, JISHOP and
 * the categories used in the first catalog draft). Key: sheinCategoryKey(sheetName).
 */
export const SHEIN_CATEGORY_ROUTES: Record<string, CategoryRoute> = {
  '7401-2002': known(t('Blusa', 'Top'), 'nina', 'Blusas Niñas (8-12)'),
  '5925-2003': known(t('Vestido'), 'nina', 'Vestidos Niñas (8-12)'),
  '9601-2007': known(t('Pantalón', 'Jeans', 'Leggings'), 'nina', 'Pantalones Niñas (8-12)'),
  '1503-2008': known(t('Short'), 'nina', 'Shorts Niñas (8-12)'),
  '9837-2009': known(t('Falda'), 'nina', 'Faldas Niñas (8-12)'),
  '9335-2011': known(t('Sudadera'), 'nina', 'Sudaderas Niñas (8-12)'),
  '777-2836': known(t('Abrigo', 'Chamarra'), null, 'Abrigos de invierno'),
  '10945-15263': known(t('Conjunto'), null, 'Conjuntos de ropa'),
  '1494-1995': known(t('Short'), 'nino', 'Shorts Niños (8-12)'),
  '9334-1996': known(t('Sudadera'), 'nino', 'Sudaderas Niños (8-12)'),
  '9736-1997': known(t('Playera'), 'nino', 'Camisetas Niños (8-12)'),
  '252-2183': known(t('Playera'), null, 'Camisetas deportivas'),
  '253-2184': known(t('Sudadera'), null, 'Sudadera deportiva'),
  '255-2186': known(t('Short'), null, 'Pantalones cortos deportivos'),
  '257-2187': known(t('Pants deportivo'), null, 'Pantalones deportivos'),
  '426-2423': known(t('Short'), null, 'Shorts deportivos'),
  '1281-3706': known(t('Lentes'), null, 'Gafas deportivas'),
  '1852-4455': known(t('Tenis'), null, 'Zapatos deportivos'),
  '2510-5455': known(t('Gorra o sombrero'), null, 'Gorra deportiva'),
  '4545-7737': known(t('Tenis'), 'hombre', 'Zapatos Tenis Hombre'),
  '11138-15486': known(t('Playera'), null, 'Camisetas deportivas'),
  '2443-5320': known(t('Playera polo'), null, 'Polos deportivos'),
  '9734-1978': known(t('Playera'), 'hombre', 'Camisetas de hombre'),
  '72-1732': known(t('Falda'), 'mujer', 'Faldas de mujer'),
  '68-1734': known(t('Suéter', 'Cárdigan'), 'mujer', 'Jerséis de mujer'),
  '75-1740': known(t('Pantalón', 'Jeans'), 'mujer', 'Pantalones de mujer'),
  '1346-1976': known(t('Pantalón', 'Jeans'), 'hombre', 'Pantalones para hombre'),
  '67-1727': known(t('Vestido'), 'mujer', 'Vestidos cortos de mujer'),
  '1083-3218': known(t('Vaso'), null, 'Vaso'),
  '8541-11816': known(t('Juego de vasos'), null, 'Juego de vasos'),
  '204-1948': known(t('Taza'), null, 'Tazas'),
  '1404-3808': known(t('Utensilio de cocina'), null, 'Otros utensilios de cocina'),
  '1434-3844': known(t('Utensilio de cocina'), null, 'Otros utensilios'),
  '1438-3849': known(t('Utensilio de cocina'), null, 'Otros utensilios'),
  '1432-3842': known(t('Utensilio de cocina'), null, 'Cucharones'),
  '1098-3254': known(t('Utensilio de cocina'), null, 'Juegos de utensilios'),
  '3958-7071': known(t('Utensilio de cocina'), null, 'Herramientas de pastelería'),
  '3613-6878': known(t('Tabla para picar'), null, 'Juegos de tablas para cortar'),
  '3978-7088': known(t('Batería de cocina'), null, 'Batería de cocina'),
  '1926-4582': known(t('Dispensador'), null, 'Dispensadores'),
  '3336-6331': known(t('Cafetera manual', 'Cafetera eléctrica'), null, 'Cafeteras (manuales y eléctricas)'),
  '1383-2127': known(t('Bolsa'), null, 'Bolsos bandolera'),
  '4884-8097': known(t('Organizador o estante'), null, 'Estantes de almacenamiento'),
  '9199-12484': known(t('Herramienta'), null, 'Herramientas y accesorios'),
  '1927-4585': known(t('Accesorio de baño'), null, 'Sets de accesorios de baño'),
  '5136-8397': known(t('Casa de campaña'), null, 'Carpas'),
  '5142-8403': known(t('Estufa de campamento'), null, 'Estufa de picnic'),
  '5144-8405': known(t('Mesa o silla plegable'), null, 'Mesa y sillas plegables'),
  '3267-6284': known(t('Mueble de jardín'), null, 'Muebles de jardín'),
  '2525-5460': known(t('Pesas o mancuernas'), null, 'Pesa'),
  '1781-4370': known(t('Accesorio fitness'), null, 'Ruedas abdominales'),
  '2528-5463': known(t('Accesorio fitness'), null, 'Asistentes para abdominales'),
};

const AUDIENCE_WORDS: Array<[RegExp, CatalogAudience]> = [
  [/\bbebe/, 'bebe'], [/\bninas?\b/, 'nina'], [/\bninos?\b/, 'nino'], [/\binfantil|\bkids\b/, 'infantil'],
  [/\bmujer|\bdama/, 'mujer'], [/\bhombre|\bcaballero/, 'hombre'], [/\bunisex/, 'unisex'],
];

/** Word stems per product type for categories without a confirmed route. Order matters: specific first. */
const TYPE_WORDS: Array<[RegExp, string]> = [
  [/juego de vasos|set de vasos/, 'Juego de vasos'], [/\bvaso/, 'Vaso'], [/\btaza/, 'Taza'], [/termo|botella/, 'Termo o botella'],
  [/sarten|olla/, 'Sartén u olla'], [/bateria de cocina/, 'Batería de cocina'], [/cuchill/, 'Cuchillos'], [/tabla/, 'Tabla para picar'],
  [/cafetera/, 'Cafetera manual'], [/utensilio|cucharon|espatula/, 'Utensilio de cocina'], [/plato|vajilla/, 'Plato o vajilla'],
  [/contenedor|tupper|recipiente/, 'Contenedor de alimentos'], [/dispensador/, 'Dispensador'],
  [/polo/, 'Playera polo'], [/camiseta|playera/, 'Playera'], [/blusa/, 'Blusa'], [/camisa/, 'Camisa'], [/sudadera/, 'Sudadera'],
  [/jersei|jersey|sueter/, 'Suéter'], [/cardigan/, 'Cárdigan'], [/chaleco/, 'Chaleco'], [/chamarra|chaqueta/, 'Chamarra'],
  [/abrigo/, 'Abrigo'], [/vestido/, 'Vestido'], [/falda/, 'Falda'], [/jeans|vaquero/, 'Jeans'], [/legging/, 'Leggings'],
  [/short|pantalones cortos|bermuda/, 'Short'], [/pantalon/, 'Pantalón'], [/conjunto/, 'Conjunto'], [/pijama/, 'Pijama'],
  [/sujetador|brasier/, 'Brasier'], [/calcetin/, 'Calcetines'], [/bano|bikini/, 'Traje de baño'], [/body/, 'Body'],
  [/tenis|zapatilla|deportivo.*zapato|zapatos deportivo/, 'Tenis'], [/sandalia/, 'Sandalias'], [/bota/, 'Botas'],
  [/pantufla/, 'Pantuflas'], [/zapato/, 'Zapatos'], [/gorra|sombrero/, 'Gorra o sombrero'], [/bolso|bolsa/, 'Bolsa'],
  [/mochila/, 'Mochila'], [/cartera/, 'Cartera'], [/cinturon/, 'Cinturón'], [/gafas|lentes/, 'Lentes'],
  [/collar|arete|pulsera|joyeria/, 'Joyería'], [/reloj/, 'Reloj'], [/estante|organizador/, 'Organizador o estante'],
  [/carpa|campana/, 'Casa de campaña'], [/estufa/, 'Estufa de campamento'], [/jardin/, 'Mueble de jardín'],
  [/plegable/, 'Mesa o silla plegable'], [/pesa|mancuerna/, 'Pesas o mancuernas'], [/abdominal|fitness|yoga/, 'Accesorio fitness'],
  [/juguete/, 'Juguete'], [/peluche/, 'Peluche'], [/mascota|perro|gato/, 'Mascotas'],
];

/**
 * Route a marketplace category to universal product types. Confirmed SHEIN routes win; otherwise a keyword
 * suggestion that an operator must confirm before the category enables a tab (`confidence: 'suggested'`).
 */
export function routeMarketplaceCategory(marketplaceId: MarketplaceId, label: string, overrides: Record<string, CategoryRoute> = {}): CategoryRoute {
  const key = marketplaceId === 'shein' ? sheinCategoryKey(label) : null;
  const override = overrides[`${marketplaceId}:${key ?? label}`];
  if (override) return override;
  if (key && SHEIN_CATEGORY_ROUTES[key]) return SHEIN_CATEGORY_ROUTES[key];
  const text = normalizeCatalogValue(label.replace(/\(\d+-\d+\)\s*$/, ''));
  const type = TYPE_WORDS.find(([pattern]) => pattern.test(text))?.[1];
  const audience = AUDIENCE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  if (!type) return { typeIds: [], audience, confidence: 'unresolved', reason: `Sin coincidencia para «${label}».` };
  return { typeIds: [catalogTypeId(type)], audience, confidence: 'suggested', reason: `Sugerido por palabras de «${label}».` };
}

export const familiesOfRoute = (route: CategoryRoute) =>
  [...new Set(route.typeIds.map(id => familyOfType(id)?.id).filter((id): id is string => !!id))];

// Guard: every confirmed route points to existing product types.
for (const [key, route] of Object.entries(SHEIN_CATEGORY_ROUTES)) {
  for (const id of route.typeIds) if (!familyOfType(id)) throw new Error(`Ruta SHEIN ${key}: tipo inexistente ${id}`);
}
