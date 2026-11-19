/**
 * Universal vocabulary of the client catalog (Spanish, Mexico).
 *
 * These are the only values a client can pick. They never change spelling per marketplace:
 * translation to each marketplace list lives in `valueMaps.ts` and, per category, in the
 * value coverage computed from the real template (`valueCoverage.ts`).
 * Removing a value is a breaking change for existing rows: deprecate it instead.
 */
export const CATALOG_LISTS = {
  color: [
    'Negro', 'Blanco', 'Gris', 'Gris claro', 'Gris oscuro', 'Beige', 'Crema', 'Café', 'Camel', 'Caqui',
    'Azul', 'Azul marino', 'Azul claro', 'Azul rey', 'Mezclilla claro', 'Mezclilla oscuro', 'Turquesa',
    'Verde', 'Verde oscuro', 'Verde olivo', 'Verde militar', 'Verde menta', 'Amarillo', 'Mostaza', 'Naranja',
    'Coral', 'Rojo', 'Vino', 'Rosa', 'Rosa claro', 'Fucsia', 'Morado', 'Lila', 'Dorado', 'Plateado',
    'Transparente', 'Multicolor',
  ],
  talla_ropa: [
    'Unitalla', 'XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL',
    '0', '1', '3', '5', '7', '9', '11', '13', '15',
    '24', '26', '28', '30', '32', '34', '36', '38', '40', '42', '44', '46',
    '0-3 meses', '3-6 meses', '6-9 meses', '9-12 meses', '12-18 meses', '18-24 meses',
    '2 años', '3 años', '4 años', '5 años', '6 años', '7 años', '8 años', '9 años', '10 años', '11 años',
    '12 años', '13 años', '14 años', '16 años',
  ],
  talla_calzado: [
    '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '22.5', '23', '23.5', '24', '24.5',
    '25', '25.5', '26', '26.5', '27', '27.5', '28', '28.5', '29', '29.5', '30', '31',
  ],
  tamano: ['Unitalla', 'Único', 'Chico', 'Mediano', 'Grande', 'Extra grande', 'Individual', 'Matrimonial', 'Queen', 'King'],
  fibra: [
    'Algodón', 'Poliéster', 'Elastano', 'Nailon', 'Viscosa', 'Rayón', 'Lino', 'Lana', 'Seda', 'Acrílico', 'Modal',
    'Lyocell', 'Cachemira', 'Acetato', 'Poliuretano', 'Mohair', 'Alpaca', 'Cáñamo', 'Bambú', 'Otro',
  ],
  material: [
    'Acero inoxidable', 'Acero al carbono', 'Aluminio', 'Hierro', 'Cobre', 'Metal (otro)', 'Vidrio', 'Cerámica',
    'Porcelana', 'Melamina', 'Tritán', 'Plástico PP', 'Plástico PET', 'Plástico ABS', 'Plástico PC', 'Acrílico',
    'Plástico (otro)', 'Silicona', 'Hule (caucho)', 'Madera', 'Bambú', 'MDF', 'Papel o cartón', 'Tela', 'Algodón',
    'Poliéster', 'Nailon', 'Lona', 'Piel genuina', 'Piel sintética', 'Gamuza', 'EVA', 'Espuma', 'Piedra',
    'Teflón (antiadherente)', 'Otro',
  ],
  material_calzado: [
    'Piel genuina', 'Piel sintética', 'Gamuza', 'Tela', 'Malla', 'Lona', 'Tejido de punto', 'Hule (caucho)', 'EVA', 'Espuma',
    'Poliuretano', 'Plástico (otro)', 'Otro',
  ],
  material_alimentos: [
    'No aplica', 'Acero inoxidable', 'Aluminio', 'Vidrio', 'Cerámica', 'Porcelana', 'Melamina', 'Tritán',
    'Plástico PP', 'Plástico PET', 'Plástico PC', 'Silicona', 'Madera', 'Bambú', 'Teflón (antiadherente)', 'Papel', 'Otro',
  ],
  pais: [
    'México', 'China', 'Estados Unidos', 'Vietnam', 'Bangladesh', 'India', 'Pakistán', 'Indonesia', 'Camboya',
    'Tailandia', 'Turquía', 'Guatemala', 'Colombia', 'Perú', 'Brasil', 'España', 'Italia', 'Portugal',
    'Corea del Sur', 'Taiwán', 'Otro',
  ],
  cuidado: [
    'Lavado a máquina', 'Lavado a máquina, no usar secadora', 'Lavado a mano', 'Lavado en seco',
    'Lavado a mano o en seco', 'No lavar (limpiar con paño)',
  ],
  unidad_capacidad: ['ml', 'l', 'oz', 'g', 'kg', 'piezas'],
  si_no: ['Sí', 'No'],
  si_no_na: ['Sí', 'No', 'No aplica'],
  funcionamiento: ['No requiere energía', 'Pilas', 'Batería recargable', 'USB', 'Corriente eléctrica', 'Gas o combustible'],
  pilas: ['No requiere', 'AA', 'AAA', 'C', 'D', '9V', 'Botón (CR2032)', 'Botón (otra)', 'Batería integrada'],
  edad_recomendada: ['0-12 meses', '1-2 años', '3-5 años', '6-8 años', '9-12 años', '13 años o más', 'Adultos'],
  publicar: ['Sí', 'No'],
} as const satisfies Record<string, readonly string[]>;

export type CatalogListId = keyof typeof CATALOG_LISTS;

/** Values that mean "none / other": never mapped, never counted as a coverage gap. */
export const WILDCARD_VALUES = new Set(['Otro', 'No aplica', 'No requiere']);

/** Accent/case/space-insensitive key used everywhere values are compared. */
export const normalizeCatalogValue = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();
