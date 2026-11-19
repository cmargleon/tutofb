# Organizador por código base

Implementación del 18 de noviembre de 2026. Propuesta y análisis previo: `docs/reports/ORGANIZER_BASE_CODE_PROPOSAL_2026-11-18.md`.

## Activación por cliente

`organizers/{clientId}.identityMode` (Organizador → Configuración → «Identificación de fotos»):

| Modo | Efecto |
|---|---|
| `legacy` (por defecto) | Comportamiento anterior sin cambios: carpetas, nombres, fotos vecinas y asociación visual por palabras. |
| `shadow` | Igual que `legacy`, pero cada foto guarda `baseCodeIdentity` con lo que habría decidido el código base. No cambia asociaciones, referencias ni generación. |
| `baseCode` | El nombre del archivo determina el producto. La IA elige la variante solo dentro de ese producto. Las referencias se aprueban por política y la generación se vincula al catálogo maestro. |

Secuencia recomendada: `shadow` → comparar `baseCodeIdentity` con las asociaciones actuales y con una muestra etiquetada → `baseCode`.

## Reglas para el cliente

1. El Excel tiene una columna **Código base** (también se aceptan `SPU`, `Producto base`, `Modelo base`, `Código padre`) con el mismo valor para todas las variantes de un producto.
2. Cada foto empieza por ese código, seguido de un separador (`-`, `_`, espacio, `(` o `.`): `CAM001-01.jpg`, `CAM001_2.png`, `CAM001 (3).jpg`.
3. Si dos variantes del producto tienen el mismo color (estampado, material, capacidad, pack), las fotos llevan el código de variante: `CAM002-EST-01.jpg`. El organizador marca esos productos con la incidencia «Otra variante del mismo producto tiene el mismo color».
4. Una foto, un producto. Las fotos de conjunto usan ambos códigos: `CAM001 Y PAN002.jpg`.
5. Las carpetas son libres. Moverlas o reorganizarlas no invalida análisis ni aprobaciones.

## Flujo (`functions/src/organizer`)

1. **Catálogo** (`worker.ts` → `baseCode.ts`). `buildBaseCodeIndex` reúne los códigos base declarados, los códigos de variante (SKC/SKU/visual), los códigos base usados para productos distintos (categorías distintas o nombres sin palabras en común: caso D) y las variantes indistinguibles por color (caso G). `resolveBaseCode` busca el código conocido **más largo** seguido de un separador o del final del nombre. Nunca corta por guion y nunca usa carpetas ni fotos vecinas.
   - SKC/SKU en el nombre → `codigo_variante`.
   - Base con una sola variante visual → `codigo_base_unico`.
   - Base con varias variantes → `identityState: 'base'`, la variante queda pendiente de visión.
   - Sin código o código en conflicto → excepción.
2. **Visión** (`worker.ts` → `baseCodeVision.ts`). La pasada de píxeles existente se mantiene: una por foto, con caché por contenido, 4 en paralelo. Además se guardan `visualColor` y `visualLabel`. Después, `resolveBaseVariants` hace **una llamada de elección cerrada por producto base**, en bloques de 5 fotos: el modelo elige entre las variantes que el Excel declara para ese producto y comprueba si cada foto muestra ese producto. `decideVariant` acepta la respuesta solo si:
   - la confianza supera el umbral del cliente;
   - el color visto es compatible (`canonicalColors`, sinónimos ES/EN y abreviaturas);
   - la variante no comparte color con otra del mismo producto.

   Si la foto no muestra el producto declarado, pierde la identidad aunque el nombre sea válido (caso F). Si el color visto y el modelo contradicen el SKC del nombre, la foto queda como excepción.
3. **Referencias** (`selectVariantReferences`). Se usan perfiles por tipo (`requiredViews`): prenda = frontal + trasera; accesorio = frontal; producto = principal. Una selección completa cuyas fotos tienen identidad verificada (código o elección cerrada **con concordancia visual confirmada**, o revisión humana) se aprueba por política. Queda registrada en `referenceDecisions` y `reviewHistory` con `uid: 'policy'`. Las aprobadas y rechazadas no se tocan (caso M).
4. **Generación** (`automation.ts`). Solo se genera para variantes con referencias aprobadas. La entrada son esas referencias, no las fotos nuevas sin verificar. Una foto nueva de la variante dispara la generación, y la clave de `generationSources` sobre las referencias evita regenerar si no cambiaron.
5. **Catálogo maestro** (`functions/src/catalog/organizerBinding.ts`). Antes de crear la automatización, `bindOrganizerBase` resuelve la ficha canónica del código base:
   - Si existe `clients/{c}/productAliases/organizer-base-{hash}` → se usa esa ficha (siguiendo `redirectTo`).
   - Si exactamente una ficha tiene el código como SPU/SKU, o comparte un SKU/SKC exacto del Excel, sin contradicción de color → vínculo automático.
   - Si no hay ninguna → se crea una ficha `draft` (UUID) con procedencia `drive`, y el alias se escribe en la misma transacción.
   - Si hay varias o hay contradicciones → no se vincula, y la incidencia queda en `baseProducts.catalogIssue`.

   `createAutomation` escribe en su transacción los alias de las identidades heredadas de la generación (`masterProductId` y `jobMasterProductId` de plan de fotos), **solo si no existen ni el alias ni una ficha materializada con ese ID**. `syncCatalogSource` incorpora esas generaciones a la ficha vinculada, mapea variantes por SKU/SKC exacto y agrega las demás sin fusionar.
6. **Escala**. `organizerContinuation` corre cada 5 min solo para clientes `baseCode`: vigila Drive y avanza la ejecución activa. El límite de llamadas escala con el inventario (`2 × fotos + 50`, máx. 5000); el tope real sigue siendo el presupuesto en USD.

Las decisiones humanas en modo `baseCode` usan `photoDecisionKey(..., pathless)` (contenido + nombre), y las referencias aprobadas se comparan por `contentVersion`. Mover archivos no caduca nada; editar el contenido o renombrar sí.

## Qué no cambia

Modo `legacy`, `masterProductId`/`jobMasterProductId`, paths de Storage, copias y manifest, ledger y presupuesto, caché de píxeles, publicaciones y precedencia manual > comercial > importado > IA. No hay colecciones nuevas: el vínculo usa `productAliases`.

## Límites conocidos

- La precisión visual (color, vista, elección cerrada) no está medida con fotos reales. Por eso `shadow` existe y es el paso previo obligatorio. El conjunto de referencia (`tests/fixtures/organizer-base-code-gold.json`) solo prueba el resolver determinista, y se escribió junto con el código.
- Las fichas heredadas sin metadato `catalog` (no guardadas desde el editor) no tienen `searchKeys`, así que la búsqueda de vínculo no las encuentra y se crea una ficha nueva. La incidencia de duplicado por SKU del catálogo maestro sigue apareciendo.
- Una variante generada antes de activar el modo, con ficha heredada ya materializada, sigue generando en esa ficha hasta que se incorpore manualmente.
- Un cambio de SKC o color en el Excel cambia el ID de la variante del organizador (caso J). Las referencias se reinician con incidencia y el vínculo base → ficha se mantiene. La continuidad de IDs de variante no se implementó: cambiaría el contrato de decisiones humanas existente.
- El encabezado `Código base` se agregó a los alias del lector. Un Excel en modo `legacy` con esa columna ahora toma la base declarada en lugar de cortar por guion cuando se vuelve a leer.

## Evaluación

```bash
npm --prefix functions run build
```

```bash
node --import tsx scripts/organizer/evaluate-base-code.ts tests/fixtures/organizer-base-code-gold.json
```

```bash
node --import tsx --test tests/organizerBaseCode.test.ts
```

Para un cliente real: copiar el gold con su Excel y una muestra de nombres etiquetados; el script sale con código 1 si alguna foto se asigna a un producto o variante incorrectos.
