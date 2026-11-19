import type { MarketplaceId } from '../marketplaces';
import type { CatalogListId } from './vocabulary';

/**
 * Where a marketplace column takes its value from.
 *   campo:<key>     client column of the catalog sheet
 *   tuto:<key>      produced by Tuto (Gemini, photos, rules) — see TUTO_OUTPUTS
 *   config:<key>    per-client setting — see CLIENT_SETTINGS
 *   fijo:<value>    constant
 *   derivado:<key>  deterministic rule over client fields — see DERIVED_RULES
 */
export type CatalogSource = `${'campo' | 'tuto' | 'config' | 'fijo' | 'derivado'}:${string}`;
export type MappingVerification = 'plantilla real' | 'documentación';

export interface MarketplaceColumnRule {
  id: string;
  /** How to find the column in an uploaded template: exact keys, key regex, or SHEIN attribute name. */
  match: { keys?: string[]; keyPattern?: string; attributeNames?: string[] };
  label: string;
  required: 'sí' | 'no' | 'condicional';
  /** Alternatives in priority order; the first with a value wins. */
  sources: CatalogSource[];
  /** Universal list whose values must exist in the column's dropdown (value coverage). */
  list?: CatalogListId;
  transform?: string;
  verified: MappingVerification;
  /** Family-specific sources/list (e.g. SHEIN «Material» is the fabric type for clothing, a material for objects). */
  byFamily?: Record<string, { sources: CatalogSource[]; list?: CatalogListId | null; transform?: string }>;
}

export interface MarketplaceMappingSpec {
  marketplaceId: MarketplaceId;
  verified: MappingVerification;
  structure: string;
  rules: MarketplaceColumnRule[];
}

export const TUTO_OUTPUTS: Record<string, string> = {
  nombre: 'Título de venta por marketplace (Gemini con fotos, tipo, marca, color y composición; respeta el largo máximo de cada canal).',
  descripcion: 'Descripción comercial (Gemini; usa Notas del cliente).',
  publico: 'Mujer, Hombre, Unisex, Niña, Niño, Infantil o Bebé. La categoría del marketplace lo fija cuando la ruta lo declara; si no, Gemini con fotos y tallas.',
  categoria: 'Categoría final del marketplace: la ruta de la categoría habilitada (Tipo de producto + Público).',
  atributos_estilo: 'Manga, escote, ajuste, estampado, estilo, temporada, cierre, largo… Gemini sobre fotos, solo con valores válidos de la hoja.',
  fotos: 'Portada, galería, foto por SKC y cuadrada (generación Tuto + aprobación).',
  bullets_keywords: 'Viñetas y palabras clave (Amazon, TikTok Shop).',
};
export const CLIENT_SETTINGS: Record<string, string> = {
  moneda: 'MXN (fijo para todos los clientes).',
  condicion: 'Nuevo.',
  unidad_peso: 'g (la plantilla captura gramos).',
  unidad_medida: 'cm (la plantilla captura centímetros).',
  ml_tipo_publicacion: 'Clásica o Premium.',
  ml_garantia: 'Tipo y tiempo de garantía.',
  ml_envio: 'Mercado Envíos / Full.',
  dias_preparacion: 'Días hábiles de preparación del envío.',
  amazon_exencion_gtin: 'Exención de GTIN aprobada por Amazon para la marca, si existe.',
};
export const DERIVED_RULES: Record<string, string> = {
  composicion: 'Pares Material N + % Material N del SPU (suman 100). SHEIN: «Algodón*Elastano=95*5»; texto: «95% Algodón, 5% Elastano».',
  capacidad: 'Capacidad + Unidad de capacidad → «500ml».',
  piezas_tipo: 'Piezas por venta = 1 → artículo único; > 1 → varios artículos del mismo estilo.',
  empaque: 'Familia del producto → tipo de embalaje (familia.sheinPackage).',
  variacion: 'SPU = producto padre; SKU = hijo; tema según ejes con valor (Color, Talla, Capacidad).',
  tabla_tallas: 'Medidas de la prenda o del calzado por SKU → tabla de tallas del SPU en el formato de cada canal.',
  publicar: 'Columna «Publicar en …»; vacía o Sí = se publica. Si el cliente tiene un solo marketplace no hay columna y todo se publica ahí.',
};

const r = (id: string, match: MarketplaceColumnRule['match'], label: string, required: MarketplaceColumnRule['required'], sources: CatalogSource[],
  extra: Partial<Pick<MarketplaceColumnRule, 'list' | 'transform' | 'byFamily'>> & { verified?: MappingVerification } = {}): MarketplaceColumnRule =>
  ({ id, match, label, required, sources, verified: extra.verified ?? 'plantilla real', ...(extra.list ? { list: extra.list } : {}),
    ...(extra.transform ? { transform: extra.transform } : {}), ...(extra.byFamily ? { byFamily: extra.byFamily } : {}) });

export const SHEIN_MAPPING: MarketplaceMappingSpec = {
  marketplaceId: 'shein', verified: 'plantilla real',
  structure: 'Libro «Agregar plantillas de productos en lotes» (MX): una hoja por categoría final, una fila por SKU; filas contiguas con el mismo supplier_code forman el SPU. Columnas attr_* dependen de la categoría.',
  rules: [
    r('spu', { keys: ['supplier_code'] }, 'Número del artículo', 'sí', ['campo:spu']),
    r('sku', { keys: ['supplier_sku'] }, 'SKU del vendedor', 'no', ['campo:sku']),
    r('nombre', { keyPattern: '^default_product_name' }, 'Nombre del producto', 'sí', ['tuto:nombre']),
    r('descripcion', { keyPattern: '^default_product_desc' }, 'Descripción', 'no', ['tuto:descripcion']),
    r('marca', { keys: ['brand_code'] }, 'Marca', 'no', ['campo:marca'], { transform: 'Solo si existe en la lista de marcas de la cuenta; Genérico → vacío.' }),
    r('origen', { keys: ['origin_code'] }, 'Origen', 'no', ['campo:pais'], { list: 'pais' }),
    r('ip', { keys: ['ip_character'] }, 'Propiedad intelectual', 'no', ['fijo:']),
    r('portada', { keys: ['main_img'] }, 'Imagen principal', 'condicional', ['tuto:fotos']),
    r('cuadrada', { keys: ['square_img'] }, 'Diagrama cuadrado', 'no', ['tuto:fotos']),
    r('bloque_color', { keys: ['piece_img'] }, 'Diagrama de bloques de colores', 'no', ['tuto:fotos']),
    r('detalle', { keyPattern: '^detail_img_\\d+$' }, 'Imágenes de detalle', 'no', ['tuto:fotos']),
    r('foto_sku', { keys: ['sku_image'] }, 'Imagen de SKU', 'condicional', ['tuto:fotos'], { transform: 'Foto del SKC (FOTOS/SPU/SKC).' }),
    r('stock', { keyPattern: '^stock\\[' }, 'En stock', 'no', ['campo:stock']),
    r('peso', { keys: ['weight'] }, 'Peso del paquete', 'no', ['campo:paq_peso']),
    r('unidad_peso', { keys: ['weight_unit'] }, 'Unidad de peso', 'condicional', ['config:unidad_peso']),
    r('largo', { keys: ['length'] }, 'Largo del paquete', 'no', ['campo:paq_largo']),
    r('ancho', { keys: ['width'] }, 'Ancho del paquete', 'no', ['campo:paq_ancho']),
    r('alto', { keys: ['height'] }, 'Alto del paquete', 'no', ['campo:paq_alto']),
    r('unidad_medida', { keys: ['length_unit'] }, 'Unidad de medidas', 'condicional', ['config:unidad_medida']),
    r('embalaje', { keys: ['package_type'] }, 'Tipo de embalaje', 'no', ['derivado:empaque']),
    r('piezas_tipo', { keys: ['quantity_type'] }, 'Número de piezas - tipo', 'no', ['derivado:piezas_tipo']),
    r('piezas', { keys: ['quantity_number'] }, 'Número de piezas - cantidad', 'no', ['campo:piezas']),
    r('piezas_unidad', { keys: ['quantity_unit'] }, 'Número de piezas - unidades', 'no', ['fijo:Pieza'], { transform: 'Ajustar a la lista de la hoja.' }),
    r('precio', { keyPattern: '^original_price\\[' }, 'Precio', 'condicional', ['campo:precio']),
    r('oferta', { keyPattern: '^special_price\\[' }, 'Oferta especial', 'no', ['campo:precio_oferta']),
    r('espec1', { keys: ['main_attribute'] }, 'Especificación 1', 'sí', ['fijo:Color'], { transform: 'La especificación principal que ofrezca la hoja (normalmente Color).' }),
    r('espec1_valor', { keys: ['main_attribute_value'] }, 'Especificación 1 contenido', 'sí', ['campo:color'], { list: 'color' }),
    r('espec2', { keys: ['secondary_attribute_1'] }, 'Especificación 2', 'condicional', ['derivado:variacion'], { transform: 'Talla o Capacidad según la hoja y los datos.' }),
    r('espec2_valor', { keys: ['secondary_attribute_1_value'] }, 'Especificación 2 contenido', 'condicional', ['campo:talla', 'derivado:capacidad'], { list: 'talla_ropa',
      transform: 'La lista de tallas de SHEIN depende de la especificación elegida y no viene resuelta en el Excel: se valida con la lista que entregue la plantilla o en la carga.' }),
    r('espec3', { keys: ['secondary_attribute_2', 'secondary_attribute_2_value'] }, 'Especificación 3', 'no', ['derivado:variacion']),
    r('composicion', { attributeNames: ['Composición'] }, 'Composición', 'condicional', ['derivado:composicion'], { list: 'fibra' }),
    r('material', { attributeNames: ['Material', 'Material Exterior'] }, 'Material', 'condicional', ['campo:material1'], { list: 'material',
      byFamily: { ropa: { sources: ['tuto:atributos_estilo'], list: null, transform: 'En ropa es el tipo de tejido (Chifón, Mezclilla, Satén…): Gemini con fotos y composición.' } } }),
    r('material_suela', { attributeNames: ['Material De Suela Exterior'] }, 'Material de suela', 'no', ['campo:material_suela'], { list: 'material' }),
    r('otro_material', { attributeNames: ['Otro Material'] }, 'Otro material', 'no', ['campo:material2'], { list: 'material',
      byFamily: { ropa: { sources: ['campo:fibra2'], list: 'fibra' } } }),
    r('alimentos', { attributeNames: ['Materiales en contacto con alimentos'] }, 'Materiales en contacto con alimentos', 'condicional', ['campo:material_alimentos'], { list: 'material_alimentos' }),
    r('cuidado', { attributeNames: ['Instrucciones de Cuidado'] }, 'Instrucciones de cuidado', 'no', ['campo:cuidado'], { list: 'cuidado' }),
    r('capacidad', { attributeNames: ['Capacidad', 'Volumen'] }, 'Capacidad', 'condicional', ['derivado:capacidad']),
    r('cantidad', { attributeNames: ['Cantidad', 'Número de piezas'] }, 'Cantidad', 'no', ['campo:piezas']),
    r('microondas', { attributeNames: ['Seguro para el Microondas'] }, 'Apto microondas', 'no', ['campo:microondas']),
    r('lavavajillas', { attributeNames: ['Apto para el lavavajillas'] }, 'Apto lavavajillas', 'no', ['campo:lavavajillas']),
    r('horno', { attributeNames: ['Apto para horno (-4 ~ 220 grados centígrado)'] }, 'Apto horno', 'no', ['campo:horno']),
    r('cuchilla', { attributeNames: ['¿Contiene cuchillo o cuchilla?'] }, 'Contiene cuchilla', 'condicional', ['campo:cortante']),
    r('energia', { attributeNames: ['Fuente de alimentación'] }, 'Fuente de alimentación', 'no', ['campo:funcionamiento']),
    r('pilas', { attributeNames: ['Se Requieren Pilas'] }, 'Pilas requeridas', 'no', ['campo:pilas']),
    r('pilas_incluidas', { attributeNames: ['Pilas Incluidas'] }, 'Pilas incluidas', 'no', ['campo:pilas_incluidas']),
    r('edad', { attributeNames: ['Edad', 'Usuarios'] }, 'Edad / usuarios', 'no', ['tuto:publico', 'campo:edad']),
    r('genero', { attributeNames: ['Género'] }, 'Género', 'no', ['tuto:publico']),
    r('estilo', { attributeNames: ['Detalles', 'Elasticidad de la tela', 'Tipo de ajuste', 'Longitud', 'Forro', 'Escote', 'Abertura', 'Temporada',
      'Longitud de la Manga', 'Tipos de Manga', 'Estilo', 'Tipo', 'Corte del bajo', 'Tipo de Cierre-Botonadura', 'Ubicación', 'Transparente',
      'Características', 'Tipo funcional', 'Forrado Para Aportar Calidez', 'Bolsillo', 'Temperatura', 'Materiales auxiliares especiales',
      'Patrón', 'Tipo de Estilo', 'Línea del Talle de la Cintura', 'Tipo de cierre', 'Actividad', 'Espesor', 'Forma', 'Recubrimiento',
      'Composición de Lino', 'Relleno', 'Tela de forro', 'Espere un tiempo de Aislamiento Térmico', 'serie', 'Características del Producto',
      'Función de la lente', '¿Contiene lentes tintados?', 'Tecnología de lentes', 'Material de marco', 'Material de Lentes', 'Material De La Plantilla Interior',
      'Ajuste de tamaño', 'Modelo de producto'] },
      'Atributos de estilo y detalle', 'no', ['tuto:atributos_estilo'], { transform: 'Gemini elige solo valores válidos de la hoja.' }),
    r('video', { keyPattern: '^video_' }, 'Video', 'no', ['fijo:']),
  ],
};

const doc = { verified: 'documentación' as const };
export const MERCADO_LIBRE_MAPPING: MarketplaceMappingSpec = {
  marketplaceId: 'mercado-libre', verified: 'documentación',
  structure: 'Excel de publicación masiva por categoría (Publicar en cantidad). Variaciones como filas del mismo producto. Atributos y obligatoriedad dependen de la categoría: reemplazar los patrones al cargar la plantilla oficial.',
  rules: [
    r('nombre', { keyPattern: '^(titulo|title)$' }, 'Título (máx. 60)', 'sí', ['tuto:nombre'], doc),
    r('categoria', { keyPattern: '^(categoria|category)' }, 'Categoría', 'sí', ['tuto:categoria'], doc),
    r('condicion', { keyPattern: '^(condicion|condition)$' }, 'Condición', 'sí', ['config:condicion'], doc),
    r('precio', { keyPattern: '^(precio|price)$' }, 'Precio', 'sí', ['campo:precio'], doc),
    r('moneda', { keyPattern: '^(moneda|currency)' }, 'Moneda', 'sí', ['config:moneda'], doc),
    r('stock', { keyPattern: '^(cantidad|stock|available_quantity)' }, 'Stock', 'sí', ['campo:stock'], doc),
    r('sku', { keyPattern: '^(sku|seller_sku|sku_del_vendedor|seller_custom_field)$' }, 'SKU', 'no', ['campo:sku'], doc),
    r('gtin', { keyPattern: '^(codigo_universal|gtin)' }, 'Código universal', 'condicional', ['campo:gtin'], { ...doc, transform: 'Vacío: motivo «no tiene código registrado» si la categoría lo permite.' }),
    r('marca', { keyPattern: '^(marca|brand)$' }, 'Marca', 'sí', ['campo:marca'], doc),
    r('modelo', { keyPattern: '^(modelo|model)$' }, 'Modelo', 'condicional', ['campo:spu'], doc),
    r('color', { keyPattern: '^color' }, 'Color', 'condicional', ['campo:color'], { ...doc, list: 'color' }),
    r('talla', { keyPattern: '^(talla|size)' }, 'Talla', 'condicional', ['campo:talla'], { ...doc, list: 'talla_ropa' }),
    r('guia_talles', { keyPattern: 'guia_de_talles|size_grid' }, 'Guía de talles (ID)', 'condicional', ['derivado:tabla_tallas'], doc),
    r('genero', { keyPattern: '^(genero|gender)' }, 'Género', 'condicional', ['tuto:publico'], doc),
    r('edad', { keyPattern: '^(edad|age_group)' }, 'Edad', 'condicional', ['tuto:publico'], doc),
    r('composicion', { keyPattern: 'composicion|material' }, 'Composición / material', 'condicional', ['derivado:composicion', 'campo:material1'], doc),
    r('piezas', { keyPattern: 'unidades_por_pack|units_per_pack' }, 'Unidades por pack', 'condicional', ['campo:piezas'], doc),
    r('carga', { keyPattern: 'peso_maximo_soportado|carga_maxima|capacidad_de_carga' }, 'Peso máximo soportado', 'condicional', ['campo:carga_maxima'], doc),
    r('capacidad', { keyPattern: 'capacidad|capacity' }, 'Capacidad', 'condicional', ['derivado:capacidad'], doc),
    r('fotos', { keyPattern: '^(fotos|imagenes|pictures?)' }, 'Fotos (URLs)', 'sí', ['tuto:fotos'], doc),
    r('descripcion', { keyPattern: '^(descripcion|description)$' }, 'Descripción', 'no', ['tuto:descripcion'], doc),
    r('tipo_publicacion', { keyPattern: 'tipo_de_publicacion|listing_type' }, 'Tipo de publicación', 'sí', ['config:ml_tipo_publicacion'], doc),
    r('envio', { keyPattern: 'envio|shipping' }, 'Forma de envío', 'sí', ['config:ml_envio'], doc),
    r('garantia', { keyPattern: 'garantia|warranty' }, 'Garantía', 'sí', ['config:ml_garantia'], doc),
    r('paquete', { keyPattern: 'peso|alto|ancho|largo|weight|height|width|length' }, 'Paquete', 'condicional', ['campo:paq_peso', 'campo:paq_largo', 'campo:paq_ancho', 'campo:paq_alto'], doc),
    r('estilo', { keyPattern: 'tipo_de_manga|tipo_de_cuello|estilo|patron|temporada' }, 'Atributos de prenda', 'no', ['tuto:atributos_estilo'], doc),
  ],
};

export const AMAZON_MAPPING: MarketplaceMappingSpec = {
  marketplaceId: 'amazon', verified: 'documentación',
  structure: 'Plantilla de inventario por tipo de producto (Amazon.com.mx). Fila padre por SPU + filas hijo por SKU. Atributos obligatorios dependen del product_type.',
  rules: [
    r('tipo', { keys: ['feed_product_type', 'product_type'] }, 'Tipo de producto', 'sí', ['tuto:categoria'], doc),
    r('sku', { keys: ['item_sku'] }, 'SKU', 'sí', ['campo:sku', 'campo:spu'], { ...doc, transform: 'Fila padre: SPU. Hijos: SKU.' }),
    r('marca', { keys: ['brand_name', 'brand'] }, 'Marca', 'sí', ['campo:marca'], doc),
    r('nombre', { keys: ['item_name'] }, 'Nombre', 'sí', ['tuto:nombre'], doc),
    r('gtin', { keys: ['external_product_id', 'external_product_id_type'] }, 'GTIN', 'condicional', ['campo:gtin', 'config:amazon_exencion_gtin'], doc),
    r('padre_hijo', { keys: ['parent_child', 'parent_sku', 'relationship_type', 'variation_theme'] }, 'Variaciones', 'condicional', ['derivado:variacion'], doc),
    r('color', { keys: ['color_name'] }, 'Color', 'condicional', ['campo:color_comercial', 'campo:color'], doc),
    r('color_map', { keys: ['color_map'] }, 'Familia de color', 'condicional', ['campo:color'], { ...doc, list: 'color' }),
    r('talla', { keys: ['size_name', 'apparel_size'] }, 'Talla', 'condicional', ['campo:talla'], { ...doc, list: 'talla_ropa' }),
    r('sistema_talla', { keys: ['apparel_size_system', 'apparel_size_class', 'apparel_body_type', 'apparel_height_type', 'footwear_size_system'] }, 'Sistema de tallas', 'condicional', ['derivado:variacion'], doc),
    r('publico', { keys: ['department_name', 'target_gender', 'age_range_description'] }, 'Departamento / público', 'condicional', ['tuto:publico'], doc),
    r('composicion', { keys: ['fabric_type', 'material_type', 'material_composition'] }, 'Composición / material', 'condicional', ['derivado:composicion', 'campo:material1'], doc),
    r('cuidado', { keys: ['care_instructions'] }, 'Cuidado', 'no', ['campo:cuidado'], doc),
    r('origen', { keys: ['country_of_origin'] }, 'País de origen', 'sí', ['campo:pais'], doc),
    r('precio', { keys: ['standard_price', 'list_price'] }, 'Precio', 'sí', ['campo:precio'], doc),
    r('oferta', { keys: ['sale_price'] }, 'Precio de oferta', 'no', ['campo:precio_oferta'], doc),
    r('stock', { keys: ['quantity'] }, 'Cantidad', 'sí', ['campo:stock'], doc),
    r('preparacion', { keys: ['fulfillment_latency'] }, 'Días de preparación', 'no', ['config:dias_preparacion'], doc),
    r('piezas', { keys: ['number_of_items', 'item_package_quantity'] }, 'Piezas', 'condicional', ['campo:piezas'], doc),
    r('paquete', { keyPattern: '^item_package_(weight|length|width|height)' }, 'Paquete', 'condicional', ['campo:paq_peso', 'campo:paq_largo', 'campo:paq_ancho', 'campo:paq_alto'], doc),
    r('articulo', { keyPattern: '^item_(weight|length|width|height)$' }, 'Artículo', 'condicional', ['campo:art_peso', 'campo:art_largo', 'campo:art_ancho', 'campo:art_alto'], doc),
    r('capacidad', { keys: ['capacity', 'capacity_unit_of_measure'] }, 'Capacidad', 'condicional', ['derivado:capacidad'], doc),
    r('uso', { keys: ['is_dishwasher_safe', 'microwave_safe', 'oven_safe'] }, 'Uso', 'no', ['campo:lavavajillas', 'campo:microondas', 'campo:horno'], doc),
    r('energia', { keys: ['batteries_required', 'batteries_included', 'battery_type', 'power_source_type', 'voltage', 'wattage'] }, 'Energía', 'condicional',
      ['campo:funcionamiento', 'campo:pilas', 'campo:pilas_incluidas', 'campo:voltaje', 'campo:potencia'], doc),
    r('bullets', { keyPattern: '^bullet_point' }, 'Viñetas', 'no', ['tuto:bullets_keywords'], doc),
    r('descripcion', { keys: ['product_description'] }, 'Descripción', 'no', ['tuto:descripcion'], doc),
    r('keywords', { keys: ['generic_keywords'] }, 'Palabras clave', 'no', ['tuto:bullets_keywords'], doc),
    r('imagenes', { keyPattern: '^(main|other)_image_url' }, 'Imágenes', 'sí', ['tuto:fotos'], doc),
    r('condicion', { keys: ['condition_type'] }, 'Condición', 'sí', ['config:condicion'], doc),
    r('edad', { keys: ['target_audience_keywords', 'manufacturer_minimum_age'] }, 'Edad recomendada', 'condicional', ['campo:edad'], doc),
    r('carga', { keys: ['maximum_weight_recommendation', 'weight_capacity'] }, 'Carga máxima', 'condicional', ['campo:carga_maxima'], { ...doc, transform: 'kg.' }),
  ],
};

export const TIKTOK_MAPPING: MarketplaceMappingSpec = {
  marketplaceId: 'tiktok-shop', verified: 'documentación',
  structure: 'Plantilla de carga masiva por categoría (Seller Center MX). Un producto con hasta 3 variaciones. Confirmar nombres de columna con la plantilla oficial.',
  rules: [
    r('categoria', { keyPattern: '^category' }, 'Categoría', 'sí', ['tuto:categoria'], doc),
    r('marca', { keyPattern: '^brand' }, 'Marca', 'no', ['campo:marca'], { ...doc, transform: 'Debe estar autorizada; si no, «No brand».' }),
    r('nombre', { keyPattern: '^product_name' }, 'Nombre (25–255)', 'sí', ['tuto:nombre'], doc),
    r('descripcion', { keyPattern: '^product_description' }, 'Descripción', 'sí', ['tuto:descripcion'], doc),
    r('imagenes', { keyPattern: '(main_image|product_image)' }, 'Imágenes', 'sí', ['tuto:fotos'], doc),
    r('tabla_tallas', { keyPattern: 'size_chart' }, 'Tabla de tallas', 'condicional', ['derivado:tabla_tallas'], doc),
    r('variacion1', { keyPattern: '^variation_1|^sales_attribute_1|^color' }, 'Variación 1 (Color)', 'condicional', ['campo:color'], { ...doc, list: 'color' }),
    r('variacion2', { keyPattern: '^variation_2|^sales_attribute_2|^size' }, 'Variación 2 (Talla / Capacidad)', 'condicional', ['campo:talla', 'derivado:capacidad'], { ...doc, list: 'talla_ropa' }),
    r('precio', { keyPattern: '^retail_price|^price' }, 'Precio', 'sí', ['campo:precio'], doc),
    r('stock', { keyPattern: '^quantity|^stock' }, 'Inventario', 'sí', ['campo:stock'], doc),
    r('sku', { keyPattern: '^seller_sku' }, 'SKU', 'no', ['campo:sku'], doc),
    r('gtin', { keyPattern: 'identifier_code|gtin' }, 'GTIN', 'no', ['campo:gtin'], doc),
    r('paquete', { keyPattern: '^parcel_|^package_' }, 'Paquete', 'sí', ['campo:paq_peso', 'campo:paq_largo', 'campo:paq_ancho', 'campo:paq_alto'], doc),
    r('material', { keyPattern: 'material|composition' }, 'Material', 'condicional', ['derivado:composicion', 'campo:material1'], doc),
    r('carga', { keyPattern: 'load_capacity|max_load|weight_capacity' }, 'Carga máxima', 'condicional', ['campo:carga_maxima'], doc),
    r('publico', { keyPattern: 'gender|age' }, 'Género / edad', 'condicional', ['tuto:publico'], doc),
    r('origen', { keyPattern: 'country_of_origin|origin' }, 'País de origen', 'condicional', ['campo:pais'], doc),
    r('estilo', { keyPattern: 'style|pattern|season|neckline|sleeve' }, 'Atributos', 'no', ['tuto:atributos_estilo'], doc),
    r('envio', { keyPattern: 'delivery|handling' }, 'Envío', 'no', ['config:dias_preparacion'], doc),
  ],
};

export const MARKETPLACE_MAPPINGS: Record<MarketplaceId, MarketplaceMappingSpec> = {
  shein: SHEIN_MAPPING, 'mercado-libre': MERCADO_LIBRE_MAPPING, amazon: AMAZON_MAPPING, 'tiktok-shop': TIKTOK_MAPPING,
};

/** Client field keys a source list references (for the matrix and for "is this field used?"). */
export const sourceFieldKeys = (sources: readonly CatalogSource[]) => sources.flatMap(source => {
  const [kind, key] = source.split(':') as [string, string];
  if (kind === 'campo') return [key];
  if (source === 'derivado:composicion') return ['fibra1', 'pct1', 'fibra2', 'pct2', 'fibra3', 'pct3'];
  if (source === 'derivado:capacidad') return ['capacidad', 'unidad_capacidad'];
  if (source === 'derivado:piezas_tipo') return ['piezas'];
  if (source === 'derivado:empaque') return ['tipo'];
  if (source === 'derivado:variacion') return ['spu', 'skc', 'color', 'talla', 'capacidad'];
  if (source === 'derivado:tabla_tallas') return ['m_pecho', 'm_cintura', 'm_cadera', 'm_largo', 'm_manga', 'm_entrepierna', 'm_pie'];
  if (source === 'tuto:descripcion') return ['notas'];
  return [];
});
