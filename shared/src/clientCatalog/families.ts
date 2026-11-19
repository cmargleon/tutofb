import type { MarketplaceId } from '../marketplaces';
import { MARKETPLACES } from '../marketplaces';
import type { CatalogListId } from './vocabulary';

export type CatalogFieldLevel = 'obligatorio' | 'recomendado' | 'opcional';
export type CatalogFieldType = 'code' | 'text' | 'list' | 'decimal' | 'int' | 'percent' | 'gtin';

export interface CatalogFieldDef {
  key: string;
  header: string;
  group: string;
  level: CatalogFieldLevel;
  /** spu: written once on the first row of the SPU and copied by the importer; sku: every row. */
  scope: 'spu' | 'sku';
  type: CatalogFieldType;
  list?: CatalogListId | `tipos_${string}`;
  /** Destination in the master product (shared/src/types/marketplaceExport.ts). */
  canonical: string;
  help: string;
  example?: string;
}

const field = (def: CatalogFieldDef) => def;

/** Every field a family tab can use. Families pick and order them; they may override list/level/help. */
export const CATALOG_FIELDS: Record<string, CatalogFieldDef> = Object.fromEntries([
  field({ key: 'spu', header: 'SPU', group: 'Identificación', level: 'obligatorio', scope: 'sku', type: 'code', canonical: 'variant.spu',
    help: 'Código del producto. Agrupa todos sus colores y tallas. Es el nombre de su carpeta en FOTOS.', example: 'CAM001' }),
  field({ key: 'skc', header: 'SKC', group: 'Identificación', level: 'obligatorio', scope: 'sku', type: 'code', canonical: 'variant.skc',
    help: 'Código del color o presentación. Si el SPU tiene varios, es el nombre de su subcarpeta en FOTOS/SPU/.', example: 'CAM001-NEGRO' }),
  field({ key: 'sku', header: 'SKU', group: 'Identificación', level: 'obligatorio', scope: 'sku', type: 'code', canonical: 'variant.sku',
    help: 'Código único de lo que se vende: un color en una talla, capacidad o pack. No se repite.', example: 'CAM001-NEGRO-M' }),
  field({ key: 'tipo', header: 'Tipo de producto', group: 'Identificación', level: 'obligatorio', scope: 'spu', type: 'list', canonical: 'product.category',
    help: 'Qué es el producto. Tuto lo usa para elegir la categoría de cada marketplace.', example: 'Playera' }),
  field({ key: 'marca', header: 'Marca', group: 'Identificación', level: 'obligatorio', scope: 'spu', type: 'text', canonical: 'product.brand',
    help: 'Marca tal como aparece en la etiqueta. Si no tiene marca registrada escribe: Genérico.', example: 'Genérico' }),

  field({ key: 'color', header: 'Color', group: 'Variante', level: 'obligatorio', scope: 'sku', type: 'list', list: 'color', canonical: 'variant.color',
    help: 'Color principal de esta variante. Si tiene varios colores usa Multicolor.', example: 'Negro' }),
  field({ key: 'color_comercial', header: 'Nombre comercial del color', group: 'Variante', level: 'opcional', scope: 'sku', type: 'text', canonical: 'attribute.colorName',
    help: 'Solo si usas un nombre propio, por ejemplo Azul lavado. El campo Color sigue siendo obligatorio.' }),
  field({ key: 'talla', header: 'Talla', group: 'Variante', level: 'obligatorio', scope: 'sku', type: 'list', list: 'talla_ropa', canonical: 'variant.size',
    help: 'Talla de esta fila. Una fila por talla. Si no tiene tallas usa Unitalla.', example: 'M' }),
  field({ key: 'capacidad', header: 'Capacidad', group: 'Variante', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.capacity',
    help: 'Capacidad útil real, solo el número.', example: '500' }),
  field({ key: 'unidad_capacidad', header: 'Unidad de capacidad', group: 'Variante', level: 'recomendado', scope: 'sku', type: 'list', list: 'unidad_capacidad', canonical: 'attribute.capacityUnit',
    help: 'Unidad de la capacidad.', example: 'ml' }),
  field({ key: 'precio', header: 'Precio', group: 'Variante', level: 'obligatorio', scope: 'sku', type: 'decimal', canonical: 'variant.price',
    help: 'Precio de venta en pesos mexicanos (MXN), con IVA incluido. Solo el número.', example: '299' }),
  field({ key: 'precio_oferta', header: 'Precio de oferta', group: 'Variante', level: 'opcional', scope: 'sku', type: 'decimal', canonical: 'attribute.salePrice',
    help: 'Solo si quieres mostrar un descuento. Debe ser menor que Precio.', example: '249' }),
  field({ key: 'stock', header: 'Stock', group: 'Variante', level: 'obligatorio', scope: 'sku', type: 'int', canonical: 'variant.inventory',
    help: 'Unidades disponibles de este SKU. En packs, cuenta packs completos.', example: '10' }),
  field({ key: 'piezas', header: 'Piezas por venta', group: 'Variante', level: 'obligatorio', scope: 'sku', type: 'int', canonical: 'variant.pack',
    help: 'Piezas que recibe el comprador en una compra. Individual: 1. Pack de 3: 3.', example: '1' }),
  field({ key: 'gtin', header: 'Código de barras', group: 'Variante', level: 'opcional', scope: 'sku', type: 'gtin', canonical: 'variant.gtin',
    help: 'EAN, UPC o GTIN real de este SKU (8, 12, 13 o 14 dígitos). No lo inventes.', example: '7501234567890' }),

  ...[1, 2, 3].flatMap(n => [
    field({ key: `fibra${n}`, header: `Material ${n}`, group: 'Composición', level: n === 1 ? 'obligatorio' : 'opcional', scope: 'spu', type: 'list', list: 'fibra',
      canonical: 'product.composition', help: n === 1 ? 'Material principal según la etiqueta.' : `Material ${n} según la etiqueta, si existe.`, example: n === 1 ? 'Algodón' : n === 2 ? 'Elastano' : undefined }),
    field({ key: `pct${n}`, header: `% Material ${n}`, group: 'Composición', level: n === 1 ? 'obligatorio' : 'opcional', scope: 'spu', type: 'percent',
      canonical: 'product.composition', help: 'Porcentaje según la etiqueta, solo el número. Los porcentajes deben sumar 100.', example: n === 1 ? '95' : n === 2 ? '5' : undefined }),
  ]),
  field({ key: 'cuidado', header: 'Cuidado', group: 'Composición', level: 'recomendado', scope: 'spu', type: 'list', list: 'cuidado', canonical: 'attribute.care',
    help: 'Instrucción de lavado de la etiqueta.', example: 'Lavado a máquina' }),

  field({ key: 'material1', header: 'Material principal', group: 'Materiales', level: 'obligatorio', scope: 'spu', type: 'list', list: 'material', canonical: 'product.material',
    help: 'Material principal según el fabricante, no por apariencia.', example: 'Vidrio' }),
  field({ key: 'material2', header: 'Material secundario', group: 'Materiales', level: 'opcional', scope: 'spu', type: 'list', list: 'material', canonical: 'attribute.secondaryMaterial',
    help: 'Otro material relevante, si existe.' }),
  field({ key: 'material_suela', header: 'Material de la suela', group: 'Materiales', level: 'recomendado', scope: 'spu', type: 'list', list: 'material', canonical: 'attribute.soleMaterial',
    help: 'Material de la suela exterior.', example: 'Hule (caucho)' }),
  field({ key: 'material_alimentos', header: 'Material en contacto con alimentos', group: 'Materiales', level: 'obligatorio', scope: 'spu', type: 'list', list: 'material_alimentos', canonical: 'attribute.foodContactMaterial',
    help: 'Material que toca la comida o bebida. SHEIN lo exige en vasos, tazas y utensilios.', example: 'Vidrio' }),
  field({ key: 'pais', header: 'País de origen', group: 'Materiales', level: 'recomendado', scope: 'spu', type: 'list', list: 'pais', canonical: 'attribute.originCountry',
    help: 'País de fabricación (Hecho en …).', example: 'México' }),

  field({ key: 'microondas', header: 'Apto para microondas', group: 'Uso y seguridad', level: 'recomendado', scope: 'spu', type: 'list', list: 'si_no_na', canonical: 'attribute.microwaveSafe', help: 'Según el fabricante.' }),
  field({ key: 'lavavajillas', header: 'Apto para lavavajillas', group: 'Uso y seguridad', level: 'recomendado', scope: 'spu', type: 'list', list: 'si_no_na', canonical: 'attribute.dishwasherSafe', help: 'Según el fabricante.' }),
  field({ key: 'horno', header: 'Apto para horno', group: 'Uso y seguridad', level: 'opcional', scope: 'spu', type: 'list', list: 'si_no_na', canonical: 'attribute.ovenSafe', help: 'Según el fabricante.' }),
  field({ key: 'cortante', header: 'Incluye partes cortantes', group: 'Uso y seguridad', level: 'recomendado', scope: 'spu', type: 'list', list: 'si_no', canonical: 'attribute.containsBlade',
    help: 'Cuchillos, cuchillas u hojas, aunque sea dentro de un set.' }),
  field({ key: 'funcionamiento', header: 'Funcionamiento', group: 'Energía', level: 'obligatorio', scope: 'spu', type: 'list', list: 'funcionamiento', canonical: 'attribute.powerSource', help: 'Cómo funciona el producto.' }),
  field({ key: 'pilas', header: 'Pilas que usa', group: 'Energía', level: 'recomendado', scope: 'spu', type: 'list', list: 'pilas', canonical: 'attribute.batteryType', help: 'Tipo de pila. Si no usa: No requiere.' }),
  field({ key: 'pilas_incluidas', header: 'Pilas incluidas', group: 'Energía', level: 'recomendado', scope: 'spu', type: 'list', list: 'si_no_na', canonical: 'attribute.batteriesIncluded', help: 'Si las pilas vienen en la caja.' }),
  field({ key: 'voltaje', header: 'Voltaje (V)', group: 'Energía', level: 'recomendado', scope: 'spu', type: 'text', canonical: 'attribute.voltage', help: 'Ejemplo: 127 o 110-127.' }),
  field({ key: 'potencia', header: 'Potencia (W)', group: 'Energía', level: 'opcional', scope: 'spu', type: 'decimal', canonical: 'attribute.wattage', help: 'Potencia nominal del fabricante.' }),
  field({ key: 'carga_maxima', header: 'Carga máxima (kg)', group: 'Uso y seguridad', level: 'recomendado', scope: 'spu', type: 'decimal', canonical: 'attribute.maxLoad', help: 'Peso máximo que soporta, según fabricante.' }),
  field({ key: 'edad', header: 'Edad recomendada', group: 'Uso y seguridad', level: 'obligatorio', scope: 'spu', type: 'list', list: 'edad_recomendada', canonical: 'attribute.recommendedAge', help: 'Edad indicada en el empaque.' }),

  field({ key: 'art_largo', header: 'Largo del artículo (cm)', group: 'Medidas del artículo', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.itemLength', help: 'Medida del producto fuera de la caja.' }),
  field({ key: 'art_ancho', header: 'Ancho del artículo (cm)', group: 'Medidas del artículo', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.itemWidth', help: 'Medida del producto fuera de la caja.' }),
  field({ key: 'art_alto', header: 'Alto del artículo (cm)', group: 'Medidas del artículo', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.itemHeight', help: 'Medida del producto fuera de la caja.' }),
  field({ key: 'art_peso', header: 'Peso del artículo (g)', group: 'Medidas del artículo', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.itemWeight', help: 'Peso sin empaque, en gramos.' }),

  field({ key: 'm_pecho', header: 'Pecho (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentChest', help: 'Contorno completo. Prenda extendida: ancho × 2.' }),
  field({ key: 'm_cintura', header: 'Cintura (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentWaist', help: 'Contorno completo de cintura.' }),
  field({ key: 'm_cadera', header: 'Cadera (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentHip', help: 'Contorno completo de cadera.' }),
  field({ key: 'm_largo', header: 'Largo total (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentLength', help: 'Del punto más alto al borde inferior.' }),
  field({ key: 'm_manga', header: 'Manga (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentSleeve', help: 'Largo de manga.' }),
  field({ key: 'm_entrepierna', header: 'Entrepierna (cm)', group: 'Medidas de la prenda', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.garmentInseam', help: 'Largo interior de pierna (pantalones).' }),
  field({ key: 'm_pie', header: 'Largo de plantilla (cm)', group: 'Medidas del calzado', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'attribute.footLength', help: 'Largo interior de la plantilla.' }),

  field({ key: 'paq_peso', header: 'Peso del paquete (g)', group: 'Paquete para envío', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'variant.weight', help: 'Producto + empaque, en gramos.' }),
  field({ key: 'paq_largo', header: 'Largo del paquete (cm)', group: 'Paquete para envío', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'variant.length', help: 'Medida exterior del paquete.' }),
  field({ key: 'paq_ancho', header: 'Ancho del paquete (cm)', group: 'Paquete para envío', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'variant.width', help: 'Medida exterior del paquete.' }),
  field({ key: 'paq_alto', header: 'Alto del paquete (cm)', group: 'Paquete para envío', level: 'recomendado', scope: 'sku', type: 'decimal', canonical: 'variant.height', help: 'Medida exterior del paquete.' }),
  field({ key: 'notas', header: 'Notas', group: 'Notas', level: 'opcional', scope: 'sku', type: 'text', canonical: 'attribute.clientNotes',
    help: 'Datos útiles sin columna: certificaciones, garantía del fabricante, compatibilidad, etc.' }),
].map(def => [def.key, def]));

/** One "Publicar en X" column per approved marketplace, only when the client has two or more. Empty = Sí. */
export const marketplaceFieldKey = (marketplaceId: MarketplaceId) => `publicar_${marketplaceId}`;
export const marketplaceField = (marketplaceId: MarketplaceId): CatalogFieldDef => ({
  key: marketplaceFieldKey(marketplaceId),
  header: `Publicar en ${MARKETPLACES.find(m => m.id === marketplaceId)?.name || marketplaceId}`,
  group: 'Marketplaces', level: 'opcional', scope: 'spu', type: 'list', list: 'publicar',
  canonical: `marketplaces.${marketplaceId}.enabled`,
  help: 'Vacío o Sí: se publica. No: este producto no se publica en este marketplace.',
});

export interface CatalogProductType { id: string; label: string }
export interface CatalogFamilyFieldRef { key: string; list?: CatalogFieldDef['list']; level?: CatalogFieldLevel; help?: string; header?: string }
export interface CatalogFamily {
  id: string;
  /** Sheet title shown to the client. Stable: renaming would only change the visible title. */
  tab: string;
  description: string;
  productTypes: CatalogProductType[];
  fields: Array<string | CatalogFamilyFieldRef>;
  /** Shein `package_type` derived from the family. */
  sheinPackage: string;
}

const types = (...labels: string[]): CatalogProductType[] => labels.map(label => ({ id: catalogTypeId(label), label }));
export const catalogTypeId = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const IDENTITY = ['spu', 'skc', 'sku', 'tipo', 'marca'];
const VARIANT = ['color', 'color_comercial'];
const COMMERCE = ['precio', 'precio_oferta', 'stock', 'piezas', 'gtin'];
const ITEM = ['art_largo', 'art_ancho', 'art_alto', 'art_peso'];
const PACKAGE = ['paq_peso', 'paq_largo', 'paq_ancho', 'paq_alto'];
const CAPACITY = ['capacidad', 'unidad_capacidad'];
const SIZE = (list: CatalogFieldDef['list'], level: CatalogFieldLevel = 'obligatorio', help?: string): CatalogFamilyFieldRef =>
  ({ key: 'talla', list, level, ...(help ? { help, header: 'Tamaño' } : {}) });
const OPTIONAL_SIZE = SIZE('tamano', 'opcional', 'Solo si el producto se vende en tamaños. Si se vende en capacidades usa Capacidad.');
const OPTIONAL_COLOR: CatalogFamilyFieldRef = { key: 'color', level: 'recomendado', help: 'Color principal de esta variante, si aplica.' };
const MATERIALS = ['material1', 'material2', 'pais'];
const SOFT = '(1) Embalaje flexible + objetos blandos';
const HARD = '(3) Embalaje duro';

/**
 * Universal families = client tabs. A tab exists only when the client has at least one active marketplace
 * category routed to one of its product types (see `routing.ts`).
 */
export const CATALOG_FAMILIES: CatalogFamily[] = [
  { id: 'ropa', tab: 'ROPA', sheinPackage: SOFT, description: 'Prendas de vestir para adultos, niños y bebés.',
    productTypes: types('Playera', 'Playera polo', 'Blusa', 'Camisa', 'Top', 'Body', 'Sudadera', 'Suéter', 'Cárdigan', 'Chaleco',
      'Chamarra', 'Abrigo', 'Saco o blazer', 'Vestido', 'Falda', 'Pantalón', 'Jeans', 'Short', 'Leggings', 'Pants deportivo',
      'Overol o jumpsuit', 'Conjunto', 'Pijama', 'Ropa interior', 'Brasier', 'Calcetines', 'Traje de baño'),
    fields: [...IDENTITY, ...VARIANT, SIZE('talla_ropa'), ...COMMERCE, 'fibra1', 'pct1', 'fibra2', 'pct2', 'fibra3', 'pct3', 'cuidado',
      { key: 'pais', help: 'País de fabricación (Hecho en …), según la etiqueta.' },
      'm_pecho', 'm_cintura', 'm_cadera', 'm_largo', 'm_manga', 'm_entrepierna', ...PACKAGE, 'notas'] },
  { id: 'calzado', tab: 'CALZADO', sheinPackage: HARD, description: 'Tenis, zapatos, sandalias, botas y pantuflas.',
    productTypes: types('Tenis', 'Zapatos', 'Sandalias', 'Botas', 'Pantuflas'),
    fields: [...IDENTITY, ...VARIANT, SIZE('talla_calzado', 'obligatorio'), ...COMMERCE,
      { key: 'material1', header: 'Material exterior', list: 'material_calzado', help: 'Material del corte (exterior), según el fabricante.' },
      { key: 'material_suela', list: 'material_calzado' }, 'pais',
      'm_pie', ...PACKAGE, 'notas'] },
  { id: 'accesorios', tab: 'ACCESORIOS', sheinPackage: SOFT, description: 'Gorras, bolsas, mochilas, cinturones, lentes y joyería.',
    productTypes: types('Gorra o sombrero', 'Bolsa', 'Mochila', 'Cartera', 'Cinturón', 'Bufanda o guantes', 'Lentes', 'Joyería', 'Reloj'),
    fields: [...IDENTITY, ...VARIANT, SIZE('tamano', 'recomendado', 'Talla o tamaño, si aplica. Si es de una sola medida usa Unitalla.'), ...COMMERCE,
      ...MATERIALS, ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'cocina', tab: 'COCINA Y MESA', sheinPackage: HARD, description: 'Vasos, tazas, vajilla, utensilios, contenedores y termos.',
    productTypes: types('Vaso', 'Juego de vasos', 'Taza', 'Termo o botella', 'Plato o vajilla', 'Cubiertos', 'Batería de cocina',
      'Sartén u olla', 'Utensilio de cocina', 'Cuchillos', 'Tabla para picar', 'Contenedor de alimentos', 'Cafetera manual', 'Dispensador'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', ...CAPACITY, OPTIONAL_SIZE, ...COMMERCE, ...MATERIALS, 'material_alimentos',
      'microondas', 'lavavajillas', 'horno', 'cortante', ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'electro', tab: 'ELECTRODOMÉSTICOS', sheinPackage: HARD, description: 'Aparatos que funcionan con electricidad, pilas o batería.',
    productTypes: types('Cafetera eléctrica', 'Licuadora o procesador', 'Aparato de cocina', 'Ventilador o calentador', 'Aparato de cuidado personal', 'Accesorio electrónico'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', ...CAPACITY, ...COMMERCE, ...MATERIALS, { key: 'material_alimentos', level: 'recomendado' },
      'funcionamiento', 'voltaje', 'potencia', 'pilas', 'pilas_incluidas', ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'hogar', tab: 'HOGAR', sheinPackage: HARD, description: 'Decoración, organización, textiles para el hogar y baño.',
    productTypes: types('Organizador o estante', 'Decoración', 'Textil para el hogar', 'Accesorio de baño', 'Herramienta', 'Iluminación'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', OPTIONAL_SIZE, ...COMMERCE, ...MATERIALS, 'carga_maxima', ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'exterior', tab: 'EXTERIOR Y CAMPISMO', sheinPackage: HARD, description: 'Muebles de jardín, campismo y picnic.',
    productTypes: types('Mueble de jardín', 'Mesa o silla plegable', 'Casa de campaña', 'Estufa de campamento', 'Accesorio de campamento'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', OPTIONAL_SIZE, ...COMMERCE, ...MATERIALS, 'carga_maxima',
      { key: 'funcionamiento', level: 'recomendado' }, ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'deporte', tab: 'DEPORTE', sheinPackage: HARD, description: 'Pesas, accesorios de entrenamiento y equipo deportivo.',
    productTypes: types('Pesas o mancuernas', 'Accesorio fitness', 'Equipo deportivo'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', OPTIONAL_SIZE, ...COMMERCE, ...MATERIALS, 'carga_maxima', ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'juguetes', tab: 'JUGUETES', sheinPackage: HARD, description: 'Juguetes y juegos.',
    productTypes: types('Juguete', 'Peluche', 'Juego de mesa', 'Juguete electrónico'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', ...COMMERCE, ...MATERIALS, 'edad', { key: 'funcionamiento', level: 'recomendado' },
      'pilas', 'pilas_incluidas', ...ITEM, ...PACKAGE, 'notas'] },
  { id: 'otros', tab: 'OTROS', sheinPackage: HARD, description: 'Productos que no encajan en otra familia.',
    productTypes: types('Mascotas', 'Papelería', 'Belleza o cuidado personal', 'Otro producto'),
    fields: [...IDENTITY, OPTIONAL_COLOR, 'color_comercial', OPTIONAL_SIZE, ...CAPACITY, ...COMMERCE, ...MATERIALS,
      { key: 'funcionamiento', level: 'opcional' }, ...ITEM, ...PACKAGE, 'notas'] },
];

export const catalogFamily = (id: string) => {
  const family = CATALOG_FAMILIES.find(f => f.id === id);
  if (!family) throw new Error(`Familia de catálogo desconocida: ${id}`);
  return family;
};

export const familyOfType = (typeId: string) => CATALOG_FAMILIES.find(f => f.productTypes.some(t => t.id === typeId));

/** List actually offered for a field in a family (families may narrow a universal list). */
export const familyFieldList = (familyId: string, fieldKey: string): CatalogFieldDef['list'] | undefined =>
  familyFields(catalogFamily(familyId)).find(f => f.key === fieldKey)?.list;

/** Resolved field list of a family tab (without marketplace columns). */
export const familyFields = (family: CatalogFamily): CatalogFieldDef[] => family.fields.map(ref => {
  const r = typeof ref === 'string' ? { key: ref } : ref;
  const base = CATALOG_FIELDS[r.key];
  if (!base) throw new Error(`Campo desconocido ${r.key} en ${family.id}`);
  const list = r.key === 'tipo' ? `tipos_${family.id}` as const : r.list ?? base.list;
  // A family that rewrites the help also drops the generic example (e.g. «Tamaño» must not show «Ejemplo: M»).
  const example = r.help ? undefined : base.example;
  return { ...base, example, ...(r.header ? { header: r.header } : {}), ...(r.help ? { help: r.help } : {}), ...(r.level ? { level: r.level } : {}), ...(list ? { list } : {}) };
});
