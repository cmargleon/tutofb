import { ParsedSourceSpreadsheetCell, SourceColumnRole } from './sourceSpreadsheetTypes';

export const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const normalizeCellString = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.replace(/_x000D_/g, '\n').trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

export const normalizeText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const normalizeBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

export const SOURCE_HEADER_ALIASES: Record<SourceColumnRole, RegExp[]> = {
  photo: [/^foto$/, /\bfoto\b/, /^image$/, /\bimage\b/, /imagen/, /picture/, /photo/],
  code: [
    /^spu$/,
    /\bspu\b/,
    /^sku$/,
    /\bsku\b/,
    /seller sku/,
    /supplier sku/,
    /^modelo$/,
    /\bmodelo\b/,
    /^model$/,
    /\bmodel\b/,
    /codigo/,
    /c[oó]digo/,
    /\bcode\b/,
    /referencia/,
    /^ref$/,
    /\bitem\b/,
  ],
  productName: [/nombre del producto/, /^nombre$/, /product name/, /titulo/, /title/, /^producto$/, /\bproducto\b/],
  description: [/descripcion/, /descripci[oó]n/, /detalle/, /details?/, /concepto/],
  color: [/^color$/, /\bcolor\b/, /colour/],
  size: [/^talla$/, /\bsize\b/, /medida/, /tamano/, /tamaño/],
  stock: [/^stock$/, /inventario/, /existencia/, /quantity/, /\bqty\b/, /cantidad/],
  price: [
    /precio minimo/,
    /precio mínimo/,
    /min price/,
    /^precio$/,
    /\bprecio\b/,
    /\bprice\b/,
    /costo/,
    /\bcost\b/,
    /iva incluido/,
    /importe/,
    /monto/,
  ],
  weight: [/peso/, /weight/, /peso gr/],
  length: [/largo/, /longitud/, /length/],
  width: [/ancho/, /width/],
  height: [/alto/, /height/],
  brand: [/^marca$/, /\bbrand\b/],
  origin: [/^origen$/, /\borigin\b/, /pais de origen/, /pa[ií]s de origen/, /country of origin/],
  ipCharacter: [/propiedad intelectual/, /\bip\b/, /character/, /personaje/, /licencia/],
};

export const SOURCE_ROLE_LABELS: Record<SourceColumnRole, string> = {
  photo: 'foto',
  code: 'codigo/modelo',
  productName: 'nombre',
  description: 'descripcion',
  color: 'color',
  size: 'talla',
  stock: 'stock',
  price: 'precio/costo',
  weight: 'peso',
  length: 'largo',
  width: 'ancho',
  height: 'alto',
  brand: 'marca',
  origin: 'origen',
  ipCharacter: 'propiedad intelectual',
};

export const SOURCE_ROLE_WEIGHTS: Record<SourceColumnRole, number> = {
  photo: 4,
  code: 4,
  productName: 3,
  description: 3,
  color: 2,
  size: 2,
  stock: 2,
  price: 2,
  weight: 1,
  length: 1,
  width: 1,
  height: 1,
  brand: 2,
  origin: 1,
  ipCharacter: 1,
};

export const detectSourceColumnRole = (header: string): SourceColumnRole | null => {
  const normalized = normalizeComparable(header);
  if (!normalized) {
    return null;
  }

  const orderedRoles: SourceColumnRole[] = [
    'photo',
    'code',
    'productName',
    'description',
    'color',
    'size',
    'stock',
    'price',
    'weight',
    'length',
    'width',
    'height',
    'brand',
    'origin',
    'ipCharacter',
  ];
  return orderedRoles.find((role) => SOURCE_HEADER_ALIASES[role].some((matcher) => matcher.test(normalized))) || null;
};

export const findBestCellValue = (cells: ParsedSourceSpreadsheetCell[], matchers: RegExp[]): string | null => {
  for (const matcher of matchers) {
    const match = cells.find((cell) => matcher.test(cell.normalizedHeader) && cell.value.trim());
    if (match) {
      return match.value.trim();
    }
  }
  return null;
};

export const findMatchingCellValues = (cells: ParsedSourceSpreadsheetCell[], matchers: RegExp[]): string[] => {
  const results: string[] = [];

  matchers.forEach((matcher) => {
    cells.forEach((cell) => {
      if (!matcher.test(cell.normalizedHeader) || !cell.value.trim()) {
        return;
      }

      const value = cell.value.trim();
      if (!results.includes(value)) {
        results.push(value);
      }
    });
  });

  return results;
};

export const findBestRoleValue = (cells: ParsedSourceSpreadsheetCell[], roles: SourceColumnRole[]): string | null => {
  const roleMatch = cells.find((cell) => cell.role && roles.includes(cell.role) && cell.value.trim());
  if (roleMatch) {
    return roleMatch.value.trim();
  }

  return findBestCellValue(cells, roles.flatMap((role) => SOURCE_HEADER_ALIASES[role]));
};

export const findRoleValues = (cells: ParsedSourceSpreadsheetCell[], roles: SourceColumnRole[]): string[] => {
  const results = new Set<string>();
  cells.forEach((cell) => {
    if (cell.role && roles.includes(cell.role) && cell.value.trim()) {
      results.add(cell.value.trim());
    }
  });
  findMatchingCellValues(cells, roles.flatMap((role) => SOURCE_HEADER_ALIASES[role])).forEach((value) => results.add(value));
  return [...results];
};
