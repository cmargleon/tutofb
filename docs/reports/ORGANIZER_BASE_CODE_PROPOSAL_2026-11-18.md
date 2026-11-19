# Organizador por código base — Informe crítico (18 nov 2026)

Alcance: evaluación previa a implementación. No se modificó código. Las afirmaciones sobre el comportamiento actual provienen de la lectura de `functions/src/organizer/*`, `functions/src/catalog/*`, `functions/src/spreadsheets/{masterProducts,organizerProducts}.ts`, `docs/MASTER_CATALOG.md`, `docs/ORGANIZER_VALIDATION_2026-11-05.md` y de una ejecución local de `candidatesIn` / `associatePhotos` con nombres de ejemplo (resultados en §A.3).

---

## Resumen ejecutivo

1. **La convención de código base es correcta y conviene adoptarla**, pero **no basta sola**. Hacen falta dos reglas complementarias: (a) el código base debe estar **declarado en el Excel** (columna SPU / «Código base»), no deducido; (b) cuando dos variantes de un mismo producto **no se distinguen a simple vista**, el nombre del archivo debe incluir el código de variante (SKC). La IA resuelve el resto.
2. **Hoy el caso principal (A) no funciona**: `CAM001-01.jpg` sobre un producto con varios colores queda como «Conflicto de identidad», y la pasada visual casi nunca lo resuelve, porque el color aporta +15 puntos y el umbral de margen es 25 (`interpretation.ts:571-572`). El sistema sí registra el producto base (`identityState: 'base'`), lo cual es una buena base para construir.
3. **Hay un defecto real de identidad**: cuando el Excel no tiene columna SPU, el producto base se deduce cortando por el primer guion (`catalog.ts:98`). `AB-120` y `AB-121` pasan a ser el mismo producto `AB`; `CAM-001-ROJO` pasa a ser `CAM`.
4. **No existe verificación visual de un código explícito** (caso F). Si el nombre resuelve la variante, la visión no compara lo que ve con lo declarado (`worker.ts:343`).
5. **El Organizador y el Catálogo Maestro siguen siendo dos identidades** unidas únicamente por el vínculo congelado `automationJobs/{id}/organizerCommerce/{itemId}`. Cada generación automática crea una proyección nueva `hash(automationJobId, garmentId)` (`masterProducts.ts:6`). Por eso, volver a subir fotos de CAM001 genera hoy **otra ficha heredada**, no se agrega a la existente.
6. **La capacidad de procesamiento no escala a miles de fotos**: el scheduler corre 2 veces al día (`worker.ts:601`), 90 s por cliente y como máximo 300 llamadas por ejecución. El costo de Gemini no es el problema (≈ USD 0,002 por foto). El cuello de botella está en el rendimiento y en la cola de revisión humana.

Mi recomendación es implementar en 6 fases pequeñas (§D), empezando por un **conjunto de referencia etiquetado y un modo sombra**, antes de cambiar el comportamiento.

---

## A. Diagnóstico del sistema actual

### A.1 Flujo real

```
organizerScheduler (12:00 y 18:00 MX) → tickOrganizer → watch() [Drive changes + huella de inventario + debounce]
  → run: inventory → catalog → copy → vision → organize → automation → report
```

| Fase | Qué hace | Evidencia |
|---|---|---|
| Descubrimiento | Recorre las subcarpetas de forma recursiva y usa la API de cambios de Drive. La huella se calcula con `id+version+path+parents`. Hay debounce configurable. | `watch.ts`, `fingerprint.ts:3`, `worker.ts:31-60` |
| Excel | Detecta encabezados por alias (SKC/SKU/SPU/COLOR/TALLA/PACK…). Admite filas de continuación y celdas combinadas. Si falla, Gemini propone el mapeo de columnas. | `catalog.ts:25-110`, `interpretation.ts:518` |
| Agrupación de variantes | Variante visual = `digest(base, visualCode, color, pack, capacity)`. Las tallas se agregan cuando el sufijo coincide con la columna de talla. | `catalog.ts:151-184` |
| Asociación por nombre | Tokeniza el nombre y busca coincidencias exactas de SKC/SKU/base/visual. Prueba con el sufijo `-NN` y con el corte en el primer guion. También usa código de carpeta y fotos hermanas. | `catalog.ts:223-289` |
| Visión | Una llamada por foto, **solo con píxeles** (sin catálogo, por diseño para el caché). Devuelve kind/label/color/pack/view/quality/confidence. Escala de modelo si la confianza es baja. Hay caché por contenido (`pixelCache`). | `vision.ts:432-457`, `worker.ts:336-341` |
| Asociación visual | Solo cuando la foto **no** tiene variante. Hace un ranking por palabras del nombre y atributos, y exige ≥2 palabras coincidentes, margen ≥25 y confirmación de Gemini. | `interpretation.ts:564-618`, `worker.ts:343` |
| Referencias | Prendas: frontal **y** trasera obligatorias. Productos: una principal. Las propone como `suggested` y un humano las aprueba por variante. | `worker.ts:376-397`, `api.ts:334-357` |
| Generación automática | Agrupa por variante o, si no la hay, por «pista visual» dentro de la misma carpeta. **La identidad de catálogo no es requisito.** | `automation.ts:23-33` |
| Comercial → Maestro | `readOrganizerCommerce` congela la fila del Excel en el vínculo de la automatización. El maestro la lee al proyectar o incorporar. | `commerce.ts:230`, `organizerProducts.ts`, `catalog/service.ts:41` |

### A.2 Qué existe y funciona

- Inventario incremental, idempotencia por versión y hash, duplicados por checksum (`duplicateOf`), copias verificadas, ledger de presupuesto con reservas y caché de píxeles. Una segunda pasada sobre los mismos píxeles costó **0 llamadas pagadas** según la validación del 5 nov.
- Estados de identidad bien diseñados: `variant | shared | base | unresolved | needs_review`. Las decisiones humanas caducan si cambia el contexto.
- Fotos compartidas (`A216 Y A217`) y fotos con varios artículos (la visión devuelve `unknown`).
- Aislamiento por cliente, roles y lease en las ejecuciones.
- Validación real: 7/7 correctas y 5 pendientes en una muestra de 12. **No es una medida de precisión**: la muestra es muy chica y no incluye el caso de varios colores con un mismo prefijo.

### A.3 Prueba local de la asociación por nombre

Catálogo de prueba: CAM001-N (negro), CAM001-B (blanco), CAM0010-N, AB-120, AB-121 (sin SPU), CAM-001-ROJO, PROD_AZUL-20.

| Archivo | Candidatos | Lectura |
|---|---|---|
| `CAM001-01.jpg` | N, B | Conflicto. Queda pendiente para la visión. |
| `CAM0010-01.jpg` | CAM0010-N | Correcto: la coincidencia es por token, no por prefijo. |
| `CAM001-N-01.jpg` | N | Correcto: el SKC en el nombre resuelve la variante. |
| `CAM001_01.jpg` | — | **No reconoce `_` como separador de secuencia.** |
| `CAM001 (2).jpg` | N, B | Correcto a nivel base. |
| `AB-12001.jpg` | AB-120, AB-121 | **Falso candidato** por la base deducida `AB`. |
| `AB-120-01.jpg`, `PROD_AZUL-20-01.jpg`, `CAM-001-02.jpg` | correcto | Funcionan por la regla del sufijo `-NN`. |
| `IMG_4432.jpg` | — | Sin identificación (correcto). |

### A.4 Limitaciones reales encontradas

1. **Base deducida por el primer guion** (`catalog.ts:98`) cuando falta la columna SPU. Agrupa productos distintos en `baseProducts` (`worker.ts:253`) y contamina el ranking.
2. **La variante por color no se resuelve**: el color suma +15 (`interpretation.ts:481-482`) y el margen mínimo es 25. Además, la comparación es una subcadena de texto libre: «negro» frente a «NEG», «Black» o «Azul marino» frente a «MARINO» fallan. El modelo de píxeles no conoce el vocabulario de colores del cliente.
3. **No se verifica la concordancia de un código explícito** (caso F). Tampoco se alerta si el color visto contradice el SKC del nombre.
4. **La identidad de la foto depende de la ruta**: `photoDecisionKey` incluye `path` (`planning.ts:10`) y la reutilización de `gemini_evidencia` exige la misma ruta (`worker.ts:200`). Mover un archivo de carpeta **caduca la aprobación humana** y vuelve a pagar la asociación. Esto contradice la promesa de «carpetas libres».
5. **Inferencia por carpeta y por fotos hermanas** (`fotos_hermanas`, `codigo_ruta`): con carpetas libres y mezcladas, esa heurística puede asignar `IMG_4432.jpg` a la variante de sus vecinas con confianza 0,95. Comercio ya la excluye (`commerce.ts:236`), pero la generación no.
6. **El ID de variante se deriva del contenido** (`catalog.ts:158`). Si cambia el color, el SKC o el pack en el Excel, el ID cambia: se borra el documento anterior (`worker.ts:265`), se pierden las referencias aprobadas y caducan las decisiones (caso J).
7. **Requisitos de referencia rígidos**: toda prenda exige frontal y trasera; todo producto, una principal (`worker.ts:391`).
8. **Dos caminos de generación con criterios distintos**: el wizard exige `referenceState === 'approved'` (`productWorkflow.ts:296`), mientras que la automatización genera con referencias no aprobadas e incluso sin identidad (`automation.ts:23`).
9. **Rendimiento**: 2 ticks/día × 90 s/cliente, visión secuencial y `maxCalls` 300 por defecto. 2.000 fotos tardarían días y terminarían en `budget_exhausted`.
10. **Integración con el Maestro** (ver §C.4): no existe un vínculo persistente entre la base del organizador y `clients/{c}/products/{productId}`.

---

## B. Evaluación de la propuesta

### B.1 Ventajas

- Una sola regla, fácil de explicar y verificar automáticamente (podemos rechazar o avisar al instante).
- Elimina la dependencia de carpetas y renombrados por color o vista, que hoy es la principal fuente de fricción.
- Encaja con lo que ya existe: `identityState: 'base'`, caché de píxeles, ledger y decisiones humanas.
- Reduce el costo: con el código, la IA solo decide **entre las variantes de un producto** (2–8 opciones), no contra todo el catálogo.

### B.2 Donde no estoy de acuerdo o la propuesta se queda corta

1. **«Basta con el código base»**: no. Cuando las variantes comparten color (estampado, material, capacidad, pack, tallas con fotos distintas), la IA no puede elegir de forma fiable. **Regla de dos niveles**: el código base es obligatorio y el SKC es obligatorio *solo* para productos cuyas variantes no se distinguen visualmente. Tuto puede detectar esos productos automáticamente (variantes de un mismo base con igual color normalizado) y avisar al cliente de cuáles son.
2. **«El catálogo reconoce el prefijo válido más específico»**: sí, pero con **frontera de separador** obligatoria (`-`, `_`, espacio, `(`, `.` o fin). Sin frontera, CAM001 coincidiría con `CAM0010…`. Y el conjunto de prefijos debe ser **la columna de código base declarada**, nunca bases deducidas.
3. **«Convención configurable por cliente»**: evitaría regex por cliente. Son frágiles, nadie las mantiene y no se pueden probar. Alcanza con: base declarada + prefijo más largo con frontera + lista de excepciones manuales. Si un cliente necesita algo más, que se resuelva en el Excel (columna base), no en el código.
4. **«Automatización por excepción» con auto-aprobación de referencias**: estoy de acuerdo con *no* aprobar automáticamente por el nombre. Pero hoy la automatización **ya genera** sin aprobación. Hay que decidir una política única (§C.5) y no mantener dos.
5. **Visión «reutilizar sin cambios»**: el `vision.ts` actual sirve para vista, calidad y tipo. **No sirve para elegir variante**, porque deliberadamente no ve el catálogo. Hace falta un paso adicional, acotado y barato (§C.3). No es otro sistema de visión: es otra llamada con el mismo `cachedAnalysis`, ledger y presupuesto.

### B.3 Riesgos

| Riesgo | Mitigación |
|---|---|
| Asociación incorrecta silenciosa (peor que pendiente) | Nunca asignar sin margen; verificar la concordancia de los códigos explícitos; usar un conjunto de referencia con 0 errores como criterio de salida. |
| Cola de excepciones grande que no ahorra trabajo | Agrupar las excepciones por producto base y resolver en lote («estas 4 fotos son Negro»). |
| Errores del Excel (D, J) propagados a fichas | Mantener la regla de fase 1 de no fusionar. Los conflictos de base se convierten en incidencias, no en fusiones. |
| Cambio de `ALGORITHM_VERSION` que dispara reprocesos | El caché de píxeles es por contenido. Solo se repagan las asociaciones. Hay que medirlo en modo sombra. |

### B.4 Alternativas consideradas

- **Carpeta por producto** (lo actual): más fricción y peor con carpetas libres. Se descarta como requisito, pero se mantiene como señal secundaria.
- **SKC obligatorio en todas las fotos**: es lo más fiable y no requiere IA para la variante, pero es la carga que el cliente justamente quiere evitar. Se reserva para el nivel 2 de la regla.
- **Solo IA, sin código** (embeddings o similitud contra el catálogo): no alcanza la fiabilidad necesaria entre productos parecidos y contradice la regla de fase 1 de no asociar por similitud. Se descarta.
- **Hoja de control generada por Tuto** (foto → variante propuesta, que el cliente corrige en Sheets): es un buen complemento para clientes grandes en el futuro. Hoy ya se genera `controlSheet` en `finish()`.

### B.5 Casos especiales: hoy y propuesta

| Caso | Qué hace Tuto hoy | Qué debería hacer | ¿Cambio? |
|---|---|---|---|
| A. 5 colores, un prefijo | Conflicto. La visión rara vez lo resuelve (color +15 < margen 25). | Llamada cerrada por base; `base` + excepción si no hay margen. | Sí (fase 2) |
| B. CAM001 / CAM0010 | Correcto (coincidencia por token). | Igual, con frontera explícita. | Menor |
| C. Guiones, `_`, números | Funciona con `-NN`; falla con `_`; la base se deduce por el primer guion. | Base declarada + prefijo más largo con frontera. | Sí (fase 1) |
| D. Código duplicado en el Excel | Detecta SKC en variantes incompatibles y nombres distintos en comercio. Las bases se mezclan sin aviso. | Incidencia de base duplicada; fotos en excepción. | Sí (fase 1) |
| E. Sin código | Hereda de carpeta o fotos hermanas, o intenta la visión por palabras. | Excepción; las vecinas solo como sugerencia. | Sí (fase 1) |
| F. Código válido, otro producto | **Se acepta sin verificar.** | Concordancia visual obligatoria. | Sí (fase 2) |
| G. Mismo color, otro estampado | Pendiente (correcto por accidente). | Nunca automático; pedir SKC. | Regla al cliente |
| H. Reenvío o versión | Checksum → `duplicateOf`; la generación se omite por hash; una versión nueva reinicia las referencias. | Igual. | No |
| I. Varios productos | `unknown` / `shared`. | Igual. | No |
| J. Cambia el SKU/SKC | El ID de variante cambia, se borra el documento y se pierden referencias y decisiones. | Continuidad del ID por SKC. | Sí (fase 6) |
| K. Mover o borrar | Mover caduca decisiones y repaga la asociación; borrar quita la referencia. | Mover sin efecto cuando hay código. | Sí (fase 3) |
| L. Variantes nuevas | Cambia `contextKey` → se revisan todas las fotos (los píxeles están en caché). | Reevaluar solo esa base. | Sí (fase 2) |
| M. Contradicción con aprobadas | Las aprobadas no se tocan; las fotos nuevas se ignoran sin aviso. | Igual, pero con una excepción visible. | Menor |
| N. SKU por talla | Se agregan si el sufijo coincide con la columna de talla. | Igual; avisar cuando no hay columna de talla. | Menor |
| O. Sin ficha en el maestro | Cada automatización crea una proyección nueva; hay duplicados por regeneración. | Draft idempotente + alias. | Sí (fase 4) |
| P. Miles de fotos | 2 ticks/día, 90 s/cliente, 300 llamadas → días y `budget_exhausted`. | Encadenamiento continuo, límite por costo y paralelismo. | Sí (fase 5) |

---

## C. Arquitectura recomendada

### C.1 Flujo

```
Drive (cualquier subcarpeta autorizada)
 └─ watch/inventory (sin cambios; huella de inventario)
     └─ 1. Resolver BASE (determinista, sin IA)
     │     nombre → prefijo más largo ∈ {códigos base declarados} con frontera
     │     0 coincidencias → excepción «sin código» · 2+ bases con ese código (Excel duplicado) → excepción
     └─ 2. Resolver VARIANTE (de lo barato a lo caro)
     │     a) SKC/SKU exacto en el nombre ............ variante (sin IA)
     │     b) base con UNA sola variante visual ........ variante (sin IA)
     │     c) visión de píxeles (caché por contenido) → vista, calidad, tipo, color libre
     │     d) llamada «elección cerrada» por base: fotos de la base + lista de variantes
     │        (color/material/pack del Excel) → variante | ninguna | varias, por foto
     │     e) sin margen → identityState 'base' + excepción agrupada por base
     └─ 3. Concordancia: tipo/color visto vs. declarado (también para a y b) → contradicción = excepción
     └─ 4. Referencias por variante según perfil de categoría → suggested
     └─ 5. Vínculo al Maestro: base ↔ productId mediante alias persistente (§C.4)
     └─ 6. Generación: solo con identidad ≥ variante (o base, si el producto tiene una sola variante)
```

### C.2 Regla de extracción del código base

- Fuente de verdad: la columna `base` del Excel (los alias `SPU`, `PRODUCTO BASE` y `MODELO BASE` ya existen en `catalog.ts:10`). Si una pestaña no tiene base declarada, la base queda **sin confirmar** y se avisa. No se corta por guion.
- Normalización existente (`code()`), sin distinguir mayúsculas y aceptando `_` como separador.
- Coincidencia: el código base declarado más largo `B` tal que `nombre == B` o `nombre` empieza por `B` + separador. El resto (`-01`, `_3`, ` (2)`, `-N-01`) se analiza solo para buscar un SKC exacto dentro de esa base.
- Un nombre que no cumple con la regla queda como excepción. **No** se infiere por carpeta ni por fotos hermanas en este modo; esas señales se muestran como sugerencia en la revisión.

### C.3 Variante por IA: llamada de elección cerrada

- Se ejecuta solo si la base tiene más de una variante visual y la foto no tiene SKC.
- Una llamada **por grupo base** (hasta N fotos en miniatura de 384–512 px), con el enum de variantes permitido y sus atributos visuales del Excel. Pedir a la vez la concordancia de tipo («¿es una camisa?»).
- Ventajas: compara las fotos entre sí (mismo producto con distinta iluminación), usa el vocabulario del cliente y cuesta una llamada por producto en lugar de una por foto.
- Aceptar solo si: la variante está en el enum, la confianza es ≥ al umbral del cliente, no hay contradicción con el color libre de la pasada de píxeles **y** la variante es única por color normalizado. Si dos variantes comparten color, **nunca** se asigna (caso G → nivel 2 de la regla).
- La clave de caché incluye los hashes de las fotos y la huella de las variantes de esa base. Si se agrega una variante, solo se recalcula esa base.

### C.4 Integración con el Catálogo Maestro

Situación actual: el maestro reconoce productos por `hash(automationJobId|batchId, garmentId)` y fichas UUID. El organizador, por `digest(base)` y `digest(variante)` dentro de `organizers/{c}`. Solo se conectan por el vínculo congelado de cada automatización y por la «Incorporación histórica» manual.

Propuesta (sin colecciones nuevas, respetando la fase 1):

1. **Alias persistente base → ficha**: reutilizar `clients/{c}/productAliases/{aliasId}` con `aliasId = digest('organizer-base', códigoBaseNormalizado)` → `{ productId, confirmedBy, confirmedAt, baseCode }`. El ID del documento garantiza la unicidad por cliente y código. `productId` sigue siendo el UUID canónico; el código es una referencia externa.
2. **Primera vinculación**:
   - Si existe exactamente una ficha cuyo SPU coincide y no hay duplicados por SKU (`possibleCatalogDuplicates`): se **propone** el vínculo y una persona lo confirma una vez. Así se respeta la regla de «no asociar automáticamente por SKU».
   - Si no hay ninguna ficha (caso O): se crea una ficha `draft` con un UUID nuevo, evidencia de origen `organizer` (prioridad «importado») y el alias en **la misma transacción**. Es idempotente porque el alias se crea con `tx.create`.
   - Si hay varias candidatas: incidencia de identidad, sin vínculo.
3. **Variantes**: dentro de una ficha ya vinculada, se mapea la variante del organizador a `MasterVariant` por SKC exacto. Si no hay coincidencia o hay más de una, queda una incidencia. El `variantMap` se guarda en el `generationLink`, que ya existe para esto.
4. **Generación**: la automatización pasa el `productId` canónico para que los jobs se registren como `generationLinks` de la ficha existente y no creen otra proyección. Esto coincide con lo que `MASTER_CATALOG.md` deja para la fase 2 («vincular antes de crear nuevas fotografías»).
5. Las fichas confirmadas manualmente nunca reciben valores del organizador por encima de los manuales (la precedencia manual > comercial > importado > IA ya existe en `mergeCatalogSource`).

### C.5 Política única de referencias

- Perfil por categoría con las vistas requeridas, por ejemplo: prenda superior = frontal + trasera; calzado = lateral + frontal; producto rígido = principal; set o pack = principal + detalle. Reemplaza la lógica fija de `worker.ts:391`.
- Estados: `suggested` (automático) y `approved` (humano o política). Propongo permitir **auto-aprobación por política** solo cuando: la identidad de variante es de tipo a/b/d con margen, hay concordancia visual y calidad ≥ umbral, y no hay contradicciones. Se registra en `reviewHistory` con `actor: 'policy'`. Todo lo demás queda como excepción. Wizard y automatización usan la misma regla.

### C.6 Procesamiento a escala

- Mientras exista una ejecución activa, que se encadene de forma continua (scheduler cada 5 min o encolado por Cloud Tasks), en lugar de los 2 ticks diarios. El watch normal puede quedar como está.
- Límite por costo (que ya existe: `budgetUsd`) en lugar de `maxCalls` 300, o subir `maxCalls` en proporción al inventario.
- Paralelismo acotado en la visión (4–8 fotos a la vez dentro del lease).
- La identidad de la foto debe ser independiente de la ruta cuando el nombre trae código (mover archivos no caduca nada).

---

## D. Plan de implementación

| Fase | Contenido | Archivos | Riesgo | Impacto |
|---|---|---|---|---|
| **0. Medir** | Conjunto de referencia etiquetado (JISHOP + un cliente de ropa con varios colores), harness offline que ejecuta el resolver sobre inventarios guardados, métricas de error y cobertura. Modo sombra: el nuevo resolver escribe en el documento de la ejecución, no en `root`. | `tests/`, `scripts/`, `worker.ts` (solo escritura en el run) | Bajo | Habilita todo lo demás |
| **1. Base determinista** | Resolver de prefijo más largo con frontera; `_` como separador; no deducir la base por guion (marcar «base no declarada»); desactivar fotos hermanas y carpeta en modo código base (quedan como sugerencia). Bandera por cliente `organizer.identityMode = 'baseCode'`. | `catalog.ts` (`candidatesIn`, `parseTab` línea 98, `associatePhotos`), tipos de config | Medio (cambia `ALGORITHM_VERSION`) | Alto |
| **2. Variante y concordancia** | Atajos a/b; llamada cerrada por base; normalización de colores (tabla de sinónimos ES/EN y abreviaturas); verificación de concordancia también para códigos explícitos. | `interpretation.ts`, `vision.ts` (nuevo esquema), `worker.ts` fase vision | Medio | Alto |
| **3. Excepciones por base** | Bandeja agrupada por producto base: asignar fotos a variante en lote, marcar «no es este producto». Reutiliza `decisions`. Identidad independiente de la ruta cuando hay código. | UI del organizador, `api.ts`, `planning.ts` (`photoDecisionKey`) | Bajo-medio | Alto (operativo) |
| **4. Maestro** | Alias base→ficha en `productAliases`, creación de draft idempotente, mapa de variantes por SKC, `productId` canónico pasado a la automatización. | `catalog/service.ts`, `organizer/automation.ts`, `automation/persistence`, `shared/src/types/catalog.ts` | **Alto** (zona de riesgo) | Alto |
| **5. Escala** | Encadenamiento continuo, paralelismo y límites por costo. | `worker.ts`, `store.ts`, `api.ts` | Medio | Alto para clientes grandes |
| **6. Referencias y estabilidad** | Perfiles de vistas por categoría; política de auto-aprobación; continuidad del ID de variante por SKC cuando cambian atributos (mapa anterior → nuevo). | `worker.ts`, `api.ts`, `catalog.ts` | Medio-alto | Medio |

**Se preserva sin cambios**: watch/inventario, copias y manifest, ledger y presupuesto, caché de píxeles, fotos compartidas, decisiones humanas, `masterProductId`/`jobMasterProductId`, paths de Storage, publicaciones y la precedencia del maestro.

Recomendación de orden: 0 → 1 → 2 → 3 en modo sombra y luego activado para un cliente piloto. La fase 4 va recién después de medir. La 5 en paralelo, apenas un piloto supere ~500 fotos.

---

## E. Pruebas de aceptación

**Criterio de salida para activar en un cliente**: en el conjunto de referencia, **0 asignaciones automáticas incorrectas** (variante o base), cobertura automática ≥ 80 % en productos con colores distintos, y el 100 % de los casos ambiguos en excepción.

| # | Escenario | Resultado esperado |
|---|---|---|
| A | CAM001 con 5 colores distintos y 10 fotos `CAM001-01..10` | Cada foto con su variante. Las que no tienen margen quedan como `base` + excepción. Ninguna con una variante incorrecta. |
| B | CAM001 y CAM0010 en el catálogo; `CAM0010-01`, `CAM001-01`, `CAM00101` | Coincidencia exacta con frontera. `CAM00101` es excepción (no se asume). |
| C | `AB-120`, `AB-121`, `PROD_AZUL-20` con base declarada; `AB-120-01`, `AB-120_2`, `PROD_AZUL-20 (3)` | Base correcta. Sin la columna base: aviso «base no declarada», sin agrupar AB-120 con AB-121. |
| D | Dos filas con el mismo código base y nombres distintos | Incidencia de base duplicada. Las fotos de ese código quedan como excepción y no se crea ni vincula ninguna ficha. |
| E | `IMG_4432.jpg` junto a fotos de CAM001 | Excepción «sin código». No hereda la identidad de las vecinas. |
| F | `CAM001-03.jpg` que muestra una taza | Contradicción de tipo → excepción, aunque el código sea válido. |
| G | CAM002 negro liso y negro con estampado, sin SKC en el nombre | Nunca se asigna la variante; se pide el SKC. Con `CAM002-NE-01` se asigna. |
| H | Volver a subir el mismo archivo con otro nombre o ID / una versión editada | Duplicado por checksum sin nueva generación / nueva versión: se recalcula, se invalidan las referencias que la usaban y se pide aprobación otra vez. |
| I | Una foto con camisa negra y blanca | `kind unknown` o varias → `shared`, no apta como referencia. |
| J | Cambiar el SKC de CAM001-N a CAM001-NG en el Excel | Se mantienen la ficha, el alias, las referencias aprobadas (fase 6) o se reinician con un aviso explícito (antes de la fase 6). Nunca se crea una ficha nueva. |
| K | Mover fotos entre carpetas o borrar una | Mover: ninguna decisión caduca y no hay llamadas pagadas. Borrar: la referencia se quita y la variante vuelve a `pending` con aviso. |
| L | Agregar la variante «Rojo» después de procesar | Solo se reevalúa la base CAM001; las fotos ya asignadas no cambian y las de `base` pueden resolverse. |
| M | Variante con referencias aprobadas y nuevas fotos que la contradicen | No se tocan las aprobadas. Las nuevas quedan como excepción de conflicto. |
| N | SKU por talla (`CAM001-N-S/M/L`) y fotos `CAM001-01` | Las tallas se agregan en la variante visual Negro; la foto se asigna a la variante visual, no a una talla. |
| O | Código sin ficha en el maestro | Se crea una sola ficha draft más el alias. Una segunda ejecución concurrente no duplica (prueba de carrera con dos transacciones). |
| P | 3.000 fotos de 200 productos | Termina en menos de X horas, el costo queda dentro del presupuesto, se puede reanudar después de cortar el lease y una segunda pasada tiene 0 llamadas pagadas de píxeles. |
| R | Regresión | Los tests actuales `organizer*.test.ts`, `masterCatalog*.test.ts` y los e2e del maestro pasan. Los clientes sin `identityMode` no cambian de comportamiento (bandera apagada = algoritmo actual). |

Método: unitarios puros para el resolver (tabla de nombres a candidatos), integración con el emulador para alias y carrera, harness offline con el conjunto de referencia para medir la IA (es la única forma honesta de medirla) y una ejecución en modo sombra sobre un cliente real antes de activar.

---

## F. Reglas para el cliente (versión entregable)

> **Cómo enviar tus fotos a Tuto**
>
> 1. En tu Excel, cada producto debe tener un **Código base** (columna «Código base» o «SPU»). Todas las variantes de ese producto comparten el mismo código base.
> 2. **Cada foto empieza con el código base del producto**, seguido de un guion y un número: `CAM001-01.jpg`, `CAM001-02.jpg`…
> 3. Si un producto tiene variantes **del mismo color** (distinto estampado, material, capacidad o pack), agrega el código de la variante: `CAM001-ESTAMPADO-01.jpg`. Tuto te avisa qué productos lo necesitan.
> 4. Una foto debe mostrar **un solo producto**. Para fotos de conjunto, nómbralas con ambos códigos: `CAM001 Y PAN002.jpg`.
> 5. Puedes usar las carpetas que quieras. No hace falta separar por color ni por vista, ni renombrar con colores o tallas.
> 6. Fotos nítidas, con el producto completo. Para ropa, sube al menos una frontal y una trasera por color.
> 7. No cambies el código base de un producto ya cargado. Si debes hacerlo, avísanos.
>
> Lo que Tuto no pueda identificar con seguridad lo revisará nuestro equipo. No se usará ninguna foto dudosa.

---

## Respuestas directas a las 12 preguntas

1. **¿Es correcta la simplificación?** Sí, con la regla de dos niveles (base siempre; SKC solo cuando las variantes no se distinguen a simple vista) y con la base declarada en el Excel.
2. **¿Basta el código base?** Alcanza para identificar el producto. Para la variante solo alcanza si los colores son distintos, y aun así necesita una IA mejor acotada que la actual.
3. **¿Qué está implementado?** Descubrimiento incremental, lectura de Excel, agrupación de tallas, asociación por SKC exacto, visión de vista y calidad, duplicados, fotos compartidas, ledger y caché, estados de identidad (incluido `base`), referencias sugeridas con aprobación humana y automatización de generación.
4. **¿Problemas actuales?** Ver §A.4: base por guion, variante por color irresoluble, falta de concordancia, dependencia de la ruta, inferencia por vecinas, ID de variante inestable, rendimiento y doble identidad con el maestro.
5. **¿Es fiable la IA?** Para vista y calidad en prendas, razonablemente (no está medido a escala). Para colores sólidos bien distintos, sí. Para tonos cercanos, estampados, materiales, capacidades o fotos con luz o balance de blancos malos, no. Tampoco para vistas de productos simétricos. Hay que medirlo con el conjunto de referencia antes de prometer automatización.
6. **¿Primero la base y luego la variante?** Sí. Reduce el espacio de decisión de la IA a 2–8 opciones y permite usar una sola llamada por producto.
7. **¿Integración con el maestro?** Alias persistente `productAliases` (base → UUID), confirmación humana de la primera vinculación cuando ya existe una ficha, draft idempotente cuando no existe, mapa de variantes por SKC y `productId` canónico en la automatización (§C.4).
8. **¿Cómo evitamos duplicados y errores?** Unicidad por documento de alias, frontera de separador, base declarada, no fusionar, concordancia visual obligatoria, no asignar cuando dos variantes comparten color y 0 errores en el conjunto de referencia como criterio de salida.
9. **¿Qué pasa con confianza insuficiente?** La foto queda en `base` (si se conoce el producto) o `unresolved`, se agrupa en la bandeja de excepciones por producto, no es apta como referencia y no genera.
10. **¿Costo?** IA: ~USD 0,0015–0,003 por foto incluyendo escalamiento y llamada cerrada; 3.000 fotos ≈ USD 5–10. Técnico: fases 0–3 ≈ 2–3 semanas de una persona; fase 4 ≈ 1–2 semanas (zona de riesgo); fases 5–6 ≈ 1–2 semanas. Operativo: depende de la tasa de excepciones, que solo se conoce después de la fase 0.
11. **¿Cómo probarlo?** Conjunto de referencia, harness offline, modo sombra en un cliente real, piloto con bandera y la matriz de §E.
12. **¿Hay algo más simple?** Lo más simple y robusto es justamente **no** agregar heurísticas: base declarada + prefijo con frontera + SKC opcional + una sola llamada cerrada por producto + excepciones agrupadas. Evitaría las convenciones de nombre por cliente y la auto-fusión en el maestro.
