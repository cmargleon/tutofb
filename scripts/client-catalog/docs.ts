/**
 * Generates docs/client-catalog/MAPEO.md from shared/src/clientCatalog (single source of truth).
 *
 *   node --import tsx scripts/client-catalog/docs.ts
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cc = require('../../shared/src/clientCatalog/index.ts') as typeof import('../../shared/src/clientCatalog');
const { MARKETPLACES } = require('../../shared/src/marketplaces.ts') as typeof import('../../shared/src/marketplaces');

const md: string[] = [];
const row = (cells: string[]) => `| ${cells.map(c => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
const table = (headers: string[], rows: string[][]) => [row(headers), row(headers.map(() => '---')), ...rows.map(row)].join('\n');
const name = (id: string) => MARKETPLACES.find(m => m.id === id)?.name || id;

md.push('# Mapeo del catálogo universal a los marketplaces', '',
  '> Generado por `scripts/client-catalog/docs.ts` desde `shared/src/clientCatalog`. No editar a mano.', '',
  'Origen de cada columna: `campo:` lo captura el cliente · `tuto:` lo genera Tuto · `config:` configuración por cliente · `fijo:` constante · `derivado:` regla sobre campos del cliente.', '');

md.push('## Familias (pestañas del cliente)', '', table(['Pestaña', 'Tipos de producto', 'Columnas'],
  cc.CATALOG_FAMILIES.map(f => [f.tab, f.productTypes.map(t => t.label).join(', '), cc.familyFields(f).map(x => x.header).join(', ')])), '');

md.push('## Campos del cliente', '', table(['Clave', 'Columna', 'Nivel', 'Se llena', 'Destino en el producto maestro', 'Ayuda'],
  Object.values(cc.CATALOG_FIELDS).map(f => [`\`${f.key}\``, f.header, f.level, f.scope === 'spu' ? 'Primera fila del SPU' : 'Cada fila', `\`${f.canonical}\``, f.help])), '');

md.push('## Lo que genera Tuto, configuración y reglas', '',
  table(['Clave', 'Qué es'], [
    ...Object.entries(cc.TUTO_OUTPUTS).map(([k, v]) => [`tuto:${k}`, v]),
    ...Object.entries(cc.CLIENT_SETTINGS).map(([k, v]) => [`config:${k}`, v]),
    ...Object.entries(cc.DERIVED_RULES).map(([k, v]) => [`derivado:${k}`, v]),
  ]), '');

// Matrix: client field → columns of each marketplace that use it.
const ids = Object.keys(cc.MARKETPLACE_MAPPINGS) as Array<keyof typeof cc.MARKETPLACE_MAPPINGS>;
md.push('## Matriz: dato del cliente → columnas de cada marketplace', '', table(['Campo', ...ids.map(name)],
  Object.values(cc.CATALOG_FIELDS).map(f => [f.header, ...ids.map(id => cc.MARKETPLACE_MAPPINGS[id].rules
    .filter(r => cc.sourceFieldKeys([...r.sources, ...Object.values(r.byFamily ?? {}).flatMap(b => b.sources)]).includes(f.key)).map(r => r.label).join('; ') || '—')])), '');

for (const id of ids) {
  const spec = cc.MARKETPLACE_MAPPINGS[id];
  md.push(`## ${name(id)} (${spec.verified})`, '', spec.structure, '', table(['Columna', 'Etiqueta', 'Obligatoria', 'Origen', 'Transformación'],
    spec.rules.map(r => [
      [...(r.match.keys ?? []), ...(r.match.keyPattern ? [`/${r.match.keyPattern}/`] : []), ...(r.match.attributeNames ?? []).slice(0, 4)].join(', ') + ((r.match.attributeNames?.length ?? 0) > 4 ? ' …' : ''),
      r.label, r.required, r.sources.join(' → ') + (r.byFamily ? ` (${Object.entries(r.byFamily).map(([f, b]) => `${f}: ${b.sources.join(' → ')}`).join('; ')})` : ''),
      [r.list ? `Lista: ${r.list}.` : '', r.transform ?? '', ...Object.values(r.byFamily ?? {}).map(b => b.transform ?? '')].filter(Boolean).join(' '),
    ])), '');
}

md.push('## Equivalencias preferidas de valores', '',
  'Solo se usan si el valor existe en la lista real de la categoría (`mapUniversalValues`); si no, el valor queda «sin equivalente» y la cobertura lo reporta.', '');
for (const [market, lists] of Object.entries(cc.PREFERRED_VALUES)) {
  for (const [list, values] of Object.entries(lists ?? {})) {
    const rows = Object.entries(values ?? {});
    if (rows.length) md.push(`### ${name(market)} · ${list}`, '', table(['Universal', 'Candidatos en el marketplace'], rows.map(([u, c]) => [u, c.join(' · ')])), '');
  }
}

md.push('## Rutas de categorías SHEIN confirmadas', '', table(['Categoría (clave)', 'Tipos', 'Público'],
  Object.entries(cc.SHEIN_CATEGORY_ROUTES).map(([k, r]) => [`${r.reason} (${k})`, r.typeIds.join(', '), r.audience ?? 'Tuto lo infiere'])), '');

const out = fileURLToPath(new URL('../../docs/client-catalog/MAPEO.md', import.meta.url));
writeFileSync(out, md.join('\n'));
console.log('ok', out);
