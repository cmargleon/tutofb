# Prueba E2E Drive → Organizador → Automatización → Catálogo → SHEIN (2026-11-19)

Cliente de prueba `automation-e2e-test`, carpeta Drive `11Dr9ihE1VCQz7fwI63vZvTFz7JprTqXq`.

## Resultado

- Una sola ejecución del Organizador («Generar todas las fotos nuevas», run `aed758d5`) creó **2 trabajos de automatización** con
  14 artículos (8 prendas `VVbJ03bONXvrnoerMvA4`, 6 objetos `EX8brTyrfukblGKlX1wD`). Prendas y objetos usan pipelines
  distintos, por eso hay un lote por tipo; la exportación los junta en una sola descarga.
- Categoría SHEIN asignada automáticamente a los 13 artículos con código (antes: ninguno).
- Objetos: 36/36 fotos aprobadas. Prendas: 14/18 aprobadas.
- Descarga SHEIN desde Catálogo → «Exportar a marketplaces» con «Omitir productos con requisitos pendientes»: ZIP con
  2 libros oficiales (6 categorías de ropa/jardín + 3 de vasos), **20 filas (una por talla/variante), 10 productos**,
  0 obligatorias vacías, 0 valores fuera de lista, pesos convertidos a g, 46/46 URLs de imagen con HTTP 200.
- Omitidos (según lo pedido): AT-R06 y AT-R07 (prendas de hombre generadas sobre modelo femenina; el cliente no tiene
  modelo masculino), suéter negro sin código (sin fila en el Excel) y AT-J02 (no se pudo recortar la foto cuadrada).

## Errores, causa y arreglo

| # | Error | Causa | Arreglo | Verificado |
|---|-------|-------|---------|------------|
| 1 | Autollenado SHEIN «too many states» | `responseJsonSchema` con `minItems/maxItems` = nº de campos (40+) | Grupos de 8 campos en paralelo, sin límites de longitud; `key` como enum del grupo; fallos parciales no anulan el resto (`marketplaceAutofill.ts`) | 47 análisis nuevos OK en producción |
| 2 | Export con «1 variante» | La ficha maestra se creaba sin los datos del Organizador y el export la usaba | `syncCatalogSource` aplica `organizerCommerce` al crear/actualizar la ficha; SPU → `variant.spu` | 3 filas S/M/L por prenda |
| 3 | Fichas sin referencia/precio/marca, nombre = archivo | Igual que 2 | Igual que 2 | Fichas nuevas con nombre, SKU, precio y marca del Excel |
| 4 | Un lote por artículo; manual ≤4 fotos y 1 grupo | `createAutomation` por grupo; validaciones en `api.ts` | Un trabajo por tipo con N artículos (`organizerCommerce/{itemId}` por artículo), presupuesto escalado por artículo, hasta 400 fotos; generar sin selección = todo lo nuevo; export reúne los lotes de la misma ejecución (`includeOrganizerRun`) | 14 artículos → 2 lotes → 1 descarga |
| 5 | Ejecuciones no manuales esperan al programador | `organizerManualRun` solo atendía `generate` | Todas las ejecuciones creadas por una persona arrancan al instante; nueva `organizerRunContinuation` encadena tramos y reanudaciones | Run completó en ~3 min |
| 6 | «Clasificar» y cuota de Drive | La cuenta de servicio (sin delegación) no tiene cuota en «Mi unidad» | Validación clara al configurar: la carpeta contenedora debe estar en una unidad compartida; sin ella, usar «Generar desde originales» | Comportamiento documentado de Google; no se probó una unidad compartida |
| 7 | Ejecución fallida bloquea | `activeRunId` no se liberaba | Una ejecución `failed` libera el organizador; «Reanudar» la reactiva y la procesa al instante | Tests |
| 8 | Prendas fallan con preset `generic_product` | Un preset integrado se aplicaba a ambos tipos | El preset integrado del otro tipo resuelve al del tipo propio (`resolveAutomationPresetName`) | Tests |
| 9 | Duplicado sin código (PNG+JPG) = 2 artículos | Agrupación por etiqueta de Gemini | Hash perceptual (dHash) por carpeta; se agrupan y la copia no se envía dos veces | Run: suéter negro = 1 artículo con 2 fotos |
| 10 | `-DETRAS` clasificada como frontal | Solo visión | La vista explícita en el nombre (FRENTE/DETRAS/ESPALDA…) tiene prioridad | Tests |
| 11 | Revisión contradictoria | (a) La validación técnica rechazaba por esquinas 254 en vez de 255 y el resumen decía «cumple»; (b) el prompt revisado pedía quitar la modelo | (a) Los casi blancos se guardan como RGB 255 en tomas de fondo blanco y el rechazo explica qué falló; (b) el prompt de revisión fija la composición del plan | (a) verificado con imagen real; (b) Gemini aún lo pidió una vez en AT-R06 |
| 12 | Sin categoría para copas/vasos | No había plantilla compartida | Publicadas «Juego de vasos», «Tazas» y «Vaso» desde la plantilla oficial de JISHOP al catálogo compartido (sin tocar JISHOP) | AT-V01/V02/V03 y AT-O01 categorizados |

Arreglos adicionales encontrados durante la prueba:

- Las plantillas compartidas de SHEIN no se consideraban al clasificar en la automatización (`organizerCategory.ts`).
- SHEIN exige el peso en g y las medidas en cm: el export convierte kg/lb/oz y m/mm/in (`convertMeasurementUnits`).
- Columnas extra del Excel con el mismo nombre que la columna SHEIN (p. ej. «Elasticidad de la tela(39)») llegan a la planilla; `MATERIAL` alimenta «Material(160)».
- Descarga parcial: «Omitir productos con requisitos pendientes» exporta lo listo y lista lo omitido, también si falla una imagen.
- Las categorías compartidas que vienen del mismo libro oficial se escriben en un solo archivo (antes, un archivo por categoría).

## Mapeo Excel de origen → columna SHEIN

| Columna del Excel | Columna SHEIN |
|---|---|
| SPU | supplier_code (Número del artículo) ← variant.spu |
| SKC | agrupa las tallas; supplier_code si no hay SPU |
| SKU | supplier_sku (SKU del vendedor) |
| NOMBRE | default_product_name[es] |
| DESCRIPCION | default_product_desc[es] |
| CATEGORIA | contexto para elegir plantilla/categoría |
| COLOR | main_attribute_value (Especificación 1 Contenido) |
| TALLA | secondary_attribute_1_value (Especificación 2 Contenido), una fila por talla |
| PACK | variant.pack |
| PRECIO | original_price[shein-mx+MXN] |
| STOCK | stock[México+…] |
| PESO (KG) | weight + weight_unit (kg → g) |
| LARGO/ANCHO/ALTO (CM) | length / width / height + length_unit |
| MARCA | brand_code + hoja «Lista de marcas válidas» |
| MATERIAL | Material(160) cuando no hay columna «Material(160)» |
| Materiales en contacto con alimentos(1000463) | attr_1000463 |
| Especificación 2, Origen, Tipo de embalaje | secondary_attribute_1, origin_code, package_type |
| Composición(62), Tipo de cierre(25), Detalles(31), Elasticidad de la tela(39), Tipo de ajuste(40), Longitud(54), Temporada(77), Estilo(101), Tipo(109), Línea del Talle de la Cintura(113), Ocasión(128), Material(160), Transparente(207), Cantidad(1000411), Bolsillo(1000438), Escote(66), Forro(58), Características del Producto(1000616) | attr_&lt;id&gt; con el mismo nombre |

Columnas SHEIN no presentes en el Excel: las completa Gemini (aviso no bloqueante si la certeza es baja).

## Pendiente

- Prendas de hombre: el cliente de prueba solo tiene modelo femenina. Configurar un modelo masculino o usar plano (flat lay) cuando falte.
- AT-J02: recorte cuadrado no verificable para una foto muy horizontal.
- Ningún cambio está en commit: los archivos tocados también contienen trabajo sin commit de otra sesión.
