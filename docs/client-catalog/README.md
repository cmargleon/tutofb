# Catálogo universal del cliente

Cada cliente recibe una carpeta en Drive con un **Google Sheet CATALOGO** y una carpeta **FOTOS**. El cliente sube sus productos ahí. Tuto usa esos datos y las fotos para preparar las fotos de venta y, después, el Excel de carga masiva de cada marketplace.

Esta fase deja listos el modelo, el mapeo y el generador del Sheet. El menú «Crear/actualizar carpeta del cliente» y el importador se desarrollan después, sobre estas piezas.

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `shared/src/clientCatalog/vocabulary.ts` | Listas universales en español de México: colores, tallas, fibras, materiales, países, etc. |
| `families.ts` | Campos y familias, que son las pestañas: ROPA, CALZADO, ACCESORIOS, COCINA Y MESA, ELECTRODOMÉSTICOS, HOGAR, EXTERIOR Y CAMPISMO, DEPORTE, JUGUETES y OTROS. Cada familia pide solo sus columnas. |
| `routing.ts` | Categoría del marketplace → tipos de producto + público. Incluye 52 rutas SHEIN confirmadas de plantillas reales y una sugerencia por palabras clave para el resto. |
| `mappings.ts` | Columna del marketplace → origen (`campo:`, `tuto:`, `config:`, `fijo:`, `derivado:`). SHEIN está verificado contra plantillas reales. Mercado Libre, Amazon y TikTok Shop siguen la documentación pública. |
| `valueMaps.ts` | Valor universal → valor del marketplace (exacto, equivalencia o regla de talla). Nunca inventa un valor que no esté en la lista de la categoría. |
| `coverage.ts` | Cobertura de una categoría real: columnas obligatorias sin origen y valores sin equivalente. |
| `layout.ts` | Layout del Sheet de un cliente a partir de sus marketplaces aprobados y sus categorías activas, fusionado con el layout anterior. |
| `sheetRequests.ts` | Peticiones `spreadsheets.batchUpdate` para crear el Sheet o actualizarlo. Incluye el estado guardado en `_TUTO`. |
| `photoFolders.ts` | Resolución de `FOTOS/<SPU>/` y `FOTOS/<SPU>/<SKC>/` a SKC, con incidencias explícitas. |
| `scripts/client-catalog/plan.ts` | Planifica la creación o actualización de un cliente desde plantillas SHEIN reales (offline). |
| `scripts/client-catalog/shein-coverage.ts` | Genera `COBERTURA_SHEIN.md` a partir de plantillas reales. |
| `scripts/client-catalog/docs.ts` | Genera `MAPEO.md` desde el código. |

## Reglas del Sheet del cliente

- **Solo lo habilitado:**
  - Una pestaña por familia que tenga al menos una categoría activa del cliente en un marketplace aprobado.
  - El desplegable «Tipo de producto» lista solo los tipos de esas categorías.
  - Las categorías sin ruta confirmada quedan como pendientes de confirmación y no activan pestañas.
- **Marketplaces:**
  - Con un solo marketplace aprobado no hay columna de marketplace: todo se publica ahí.
  - Con dos o más aparece «Publicar en …» por cada uno. Vacía o Sí significa que se publica.
- **Desplegables mapeables:** cada lista de una familia se limita a los valores universales que tienen equivalente en *todas* las categorías activas de esa familia (`exportableValues`). «Otro» y «No aplica» siempre se mantienen.
- **Actualizable sin romper:** el Sheet nunca se regenera.
  - Las columnas solo se agregan, antes de Revisión.
  - Lo que se quita se **oculta** y conserva sus datos: pestañas, columnas y marketplaces.
  - Un tipo de producto retirado sigue siendo válido en el desplegable. La Revisión marca sus filas como «Tipo de producto retirado: no se publicará», también en las filas siguientes del SPU.
  - Los valores que el cliente ya usó se conservan aunque una restricción nueva los quite (`valuesInUse`).
- **Identidad por clave, no por posición:**
  - La fila 1, oculta, tiene la clave de cada columna.
  - `_TUTO!A:A`, oculta, guarda el layout compacto.
  - `LISTAS`, oculta, contiene una columna por lista.
- **Revisión:** un solo `ARRAYFORMULA` en el encabezado. Detecta tipo retirado, obligatorios faltantes, datos del SPU faltantes, SKU repetido, SKC con dos SPU, oferta ≥ precio, composición ≠ 100 % y capacidad sin unidad.
- **Configuración regional `es_MX`, obligatoria:** con la configuración regional de España, la API rechaza las fórmulas con comas. El Sheet se crea con `CATALOG_SPREADSHEET_PROPERTIES`.

## Carpeta FOTOS

```
FOTOS/
  VASO01/                 un solo SKC: fotos directo en la carpeta del SPU
  CAM001/
    CAM001-NEGRO/         varios SKC: una subcarpeta por SKC (código exacto)
    CAM001-BLANCO/
```

Una subcarpeta con el nombre del color se acepta solo si ese color identifica un único SKC del SPU. Si un SPU pasa de uno a varios SKC, las fotos sueltas quedan marcadas como `skc_ambiguo` hasta que se muevan.

## Verificación (18 de noviembre de 2026)

- **Tests:** `node --import tsx --test tests/clientCatalog.test.ts`, 10 de 10. `npm run lint` y `npm --prefix functions run build` pasan.
- **Cobertura SHEIN** (`COBERTURA_SHEIN.md`): 26 categorías de 5 plantillas reales (Barbie, Messi, VANS, JISHOP y polos).
  - 0 columnas obligatorias sin origen.
  - Valores: 998 exactos, 595 por equivalencia y 350 sin equivalente. Esos 350 se excluyen de los desplegables del cliente.
- **Google Sheets real:** se creó, llenó y actualizó «Tuto - Catalogo dinamico (prueba) - Cliente demo» en Drive, con las mismas peticiones que genera el código:
  - **Crear** con Vaso (SHEIN): la Revisión detecta oferta ≥ precio y un dato del SPU faltante.
  - **Agregar** Tazas y Amazon: las columnas «Publicar en» se agregan antes de Revisión, los datos no se mueven y la fórmula se ajusta.
  - **Retirar** Vaso: las 3 filas de vasos quedan marcadas como historial y una Taza nueva da OK.

## Límites conocidos

- **Tallas de SHEIN:** su lista depende de la especificación elegida y el parser actual no la entrega. La cobertura de tallas no se pudo verificar con Excel. Las reglas (`8 años`→`8Y`, `0-3 meses`→`0-3M`, calzado MX→EUR) quedan sin probar con datos reales.
- **Calzado MX→EUR:** es una tabla estándar aproximada. Confirmar contra la lista de cada categoría.
- **Mercado Libre, Amazon y TikTok Shop:** las claves de columna son las de la documentación pública. Al cargar su plantilla oficial hay que correr la cobertura y ajustar los patrones `match`.
- **Menú del cliente (siguiente fase):**
  - Crear la carpeta, el Sheet (`es_MX`) y FOTOS con el Drive de la organización.
  - Leer `_TUTO` y los valores en uso.
  - Planificar, mostrar los cambios y aplicar.
  - Guardar el layout también en Firestore.
- **Importador (siguiente fase):** leer por la fila de claves, copiar los campos del SPU a sus filas, resolver FOTOS y llevar los datos a `MasterProduct` usando `canonical`.
