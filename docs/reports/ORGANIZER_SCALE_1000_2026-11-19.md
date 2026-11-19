# Organizador a escala: una actualización de ~1000 fotos de corrido (2026-11-19)

Objetivo: que una actualización de Drive detectada por el vigilante (12:00 / 18:00 CDMX, sin cambios) se procese completa:
Organizador → automatización → generación → una sola descarga SHEIN, sin esperar al programador ni confirmaciones.

No se hizo ninguna prueba con fotos reales ni se generaron imágenes. Todo está cubierto con tests unitarios y de
integración contra el emulador (Firestore + Storage).

## Resumen de los 9 puntos

| # | Causa confirmada en el código | Cambio | Tests |
|---|---|---|---|
| 1 | `shouldContinueRun` excluía `createdBy === 'watcher'` (worker.ts) | Las ejecuciones automáticas encadenan tramos igual que las manuales. Se mantiene: `queued` **con error** (Drive 429/5xx) espera al programador. Nuevo contador `chainedSlices` en el run (se incrementa al agotar el tramo, se reinicia al «Reanudar»); tope `MAX_CHAINED_SLICES = 300` (≈32 h de trabajo; 1000 fotos necesitan ~20 tramos). Pasado el tope, sigue con el programador sin perder avance. | `organizerScale.test.ts` (punto 1), `organizerE2eFixes.test.ts` |
| 2 | `run.maxCalls = config.maxCalls` (300) fijo; la visión hace ≥1 llamada por foto. Solo el modo `baseCode` escalaba | Nuevo `organizer/limits.ts` → `scaledRunLimits`: al terminar la fase de catálogo, `maxCalls = max(piso, min(tope, fotos × llamadas/foto + 50))`, con llamadas/foto = 2 (+1 si hay modelo de escalamiento). Tope absoluto por cliente `maxCallsCap` (por defecto 5000, máx. 20 000), editable en Organizador → Configuración. | `organizerScale.test.ts` (puntos 2 y 3) |
| 3 | `run.budgetUsd = config.budgetUsd` fijo; en automático nadie amplía → `budget_exhausted` | El presupuesto escala: `max(piso, min(tope, fotos × costo/foto + reservas en vuelo))`. Tope por cliente `budgetCapUsd` (por defecto USD 40, máx. 500). Ver «Costo por foto». | ídem |
| 4 | `automateNewPhotos` descargaba de Drive todas las fotos sin variante en cada tramo (dHash) y salía con `return` sin guardar los grupos preparados | (a) El hash se guarda en la foto (`differenceHash: { key: versión de contenido, value }`) y el catálogo lo conserva si el contenido no cambió; (b) cada grupo preparado se guarda en `generationHandoffs` con estado `prepared`, sus `inputImages` y su vínculo comercial; (c) los trabajos se crean una sola vez al final; (d) las fuentes consumidas por la **misma** ejecución siguen en la selección, así un tramo reanudado reconstruye los mismos grupos y claves de idempotencia. Además: lecturas en lotes (`getAll`), configuración releída cada 30 s, descarga de hashes en paralelo (4). **Bug encontrado por el test**: al pasar a `queued`, `tx.set` borraba `inputImages`/`link`; ahora usa `merge`. | `organizerScale.integration.test.ts` (1000 fotos en tramos de 1,5 s: 1000 descargas y 1000 congelados exactos, sin reinicios; reintento posterior no crea nada nuevo), `organizerAutomation.test.ts` |
| 5 | `> 100` artículos → error; `ORGANIZER_MAX_INPUT_IMAGES = 400`. Topes implícitos adicionales: ver abajo | `ORGANIZER_MAX_ARTICLES = 500`, `ORGANIZER_MAX_INPUT_IMAGES = 2000` (500 × 4). La API externa conserva 40. **Una actualización se reparte en trabajos de ≤30 prendas / ≤40 objetos** (`ORGANIZER_ARTICLES_PER_JOB`), todos con el mismo `organizerRunId` → una sola exportación. Guarda de tamaño: un trabajo nuevo > 700 KB se rechaza. | `organizerScale.test.ts` (punto 5), integración (13 trabajos para 500 objetos) |
| 6 | `createAutomation` escribía trabajo + N `organizerCommerce` + alias en una transacción | Para el Organizador el id del trabajo es la clave de idempotencia. Antes de la transacción se escriben, por partes de 200 e idempotentes: reclamos de subida, vínculos `organizerCommerce/{itemId}` y alias (solo si no existen). La transacción final (pequeña) verifica que existan todos los vínculos y crea trabajo + claves. El trigger de intake solo reacciona al documento del trabajo, que aparece con todos sus vínculos. **No hay estado nuevo de AutomationJob.** Se valida la política antes de escribir nada. Flujo de una foto y API externa: sin cambios. | integración: 500 artículos con 50 alias, duplicado devuelve el mismo trabajo |
| 7 | `resolveAutomationPolicy` y la reserva de gasto (`budget.ts`) usaban siempre `automationBudget.maxBudgetUsd` global | Nuevo `ClientAutomationConfig.maxBudgetUsd` (solo admin, Cliente → Automatizaciones): reemplaza el máximo global **solo para ese cliente** (0,01–10 000 USD, ≥ presupuesto por defecto). Se aplica en la política, en la reserva de gasto del worker de jobs y en el informe de la API. El global no cambia. | `organizerScale.test.ts` (punto 7), integración (límite 400 > global 100) |
| 8 | `limit(1001)`/>1000 jobs o fichas por lote; >500 productos; >2000 variantes; ≤20 lotes; 200 000 celdas | Jobs y fichas paginados (`readPaged`, páginas de 500); `getAll` por páginas. Nuevos límites `EXPORT_LIMITS`: 50 lotes, 12 000 jobs (6000 por lote), 2000 productos, 6000 variantes, 500 000 celdas. 64 MB de plantillas sin cambios. Publicación de imágenes y recortes en paralelo (8 / 4) con plazo de 360 s; si no alcanza, se encola la preparación en segundo plano y se pide reintentar. | integración: lote con 1300 jobs |
| 9 | Autollenado, categorías, recortes y publicación corrían al abrir el panel / descargar; los fallos se reintentaban cada 60 s (`retryAfter`) | Nuevo `spreadsheets/marketplacePrecompute.ts`: al pasar un AutomationJob a `completed`/`needs_attention` se encola `marketplacePrecomputes/{id}`; `marketplacePrecomputeWorker` procesa tramos de 400 s (categorías → autollenado → recortes SHEIN → publicación), encadenados por el mismo trigger, tope 40 tramos, recuperación de tramos abandonados en `recoverAutomationImports`. Todo queda en las cachés existentes. Mientras corre, el panel no analiza (muestra «Preparando en segundo plano» y se refresca cada 15 s). **Los fallos de Gemini son definitivos** para su huella: quedan pendientes para revisión humana; solo el botón «Reintentar con Gemini» los repite. | integración: tramos encadenados, tope, recuperación, disparo solo para usuarios humanos |

## Topes implícitos encontrados (punto 5) y dónde se aplica `batchMaxJobs`

| Lugar | Tope | Efecto con 500 artículos en un solo trabajo |
|---|---|---|
| `createProductGenerationBatch.helpers.ts:24` | 40 objetos por lote | El intake fallaría |
| `createMarketplacePhotoBatch.ts:19` | 100 artículos por lote de fotos | El intake fallaría |
| Documento AutomationJob y Batch (1 MiB) | Plan de fotos ≈ 6–7 KB por tarea ≈ 20 KB por prenda, guardado en **ambos** documentos (medido en `VVbJ03bO`: 8 prendas = 166 KB); `analysisCache` ≈ 2,4 KB por artículo; `inputImages` + `sourceImages` | Se supera 1 MiB a partir de ~45 prendas |
| Intake (`automationIntakeWorker`, 540 s) | Clasificación Gemini en serie por artículo | Cientos de artículos no caben en una invocación |
| `refreshAutomation` | Lee todos los jobs del trabajo en cada cambio de estado | O(n²) lecturas con miles de jobs |
| `batchMaxJobs` (2000) | `createGenerationBatch.ts:45/116/333` (prendas sin plan de marketplace), `createMarketplacePhotoBatch.ts:55` (prendas con marketplace), `createProductGenerationBatch.helpers.ts:43` (objetos: artículos × escenas), `automation/plans.ts:82` (planes vía API) | 340 objetos × 6 = 2040 > 2000 |

Por eso cada actualización se divide en trabajos de ≤30 prendas / ≤40 objetos: el mayor trabajo genera ~240 jobs, muy
por debajo de `batchMaxJobs`, el intake cabe en una invocación y el documento queda < 700 KB. **No hace falta cambiar
`batchMaxJobs`.** La alternativa de «un único trabajo con varios lotes» exigiría rediseñar AutomationJob (cachés y plan
fuera del documento, contadores en vez de `refreshAutomation` O(n²)) y tocar `createGenerationBatch`; queda propuesta.

## Costo por foto del Organizador (punto 3)

Ledgers reales (gemini-3.1-flash-lite, 2026-11-19): análisis de píxeles ≈ 1200 + 105 tokens = **USD 0.00046**;
interpretación/asociación ≈ 1660 + 700 tokens = **USD 0.0015** por llamada. La estimación usa 1700 + 800 tokens
con `MODEL_PRICES` del modelo configurado × 1,5 de margen: **USD 0.0049 por foto** (2 llamadas). 1000 fotos →
presupuesto de ejecución ≈ USD 5.3 (incluye 4 reservas en vuelo de USD 0.11). El costo real esperado es USD 1–3.

## Límites de exportación medidos (punto 8)

Plantilla SHEIN compartida real (83 columnas), validación de listas + ensamblado OOXML, Node local:

| Filas | Celdas | Tiempo | RSS |
|---|---|---|---|
| 500 | 41 500 | 2,3 s | 412 MB |
| 2000 | 166 000 | 7,7 s | 550 MB |
| 6000 | 498 000 | 22 s | 677 MB |

Con 1 GiB y 540 s: 500 000 celdas / 6000 variantes. 2000 productos y 12 000 jobs (~10 KB por job en memoria ≈ 120 MB).

## Configuración que queda pendiente de tu aprobación

- **`batchMaxJobs`**: no hace falta cambiarlo (ver arriba).
- **Máximo global `automationBudget.maxBudgetUsd` (100)**: no hace falta cambiarlo. Para el cliente de la prueba hay que
  fijar el nuevo **máximo por cliente**: un trabajo de 40 objetos consume ≈ USD 134 de presupuesto contable (USD 3.35 por
  objeto) y uno de 30 prendas ≈ USD 61 (USD 2.04 por prenda). Recomendado: máximo del cliente USD 200 y presupuesto
  por pedido del cliente USD 4 (por artículo). No lo cambié.
- `organizerAutoGenerationEnabled` y el interruptor del vigilante están **apagados** en `system_config/main`: sin ellos
  no hay detección ni generación automática. No los toqué.
- Topes del Organizador por cliente: los clientes sin `budgetCapUsd`/`maxCallsCap` usan USD 40 / 5000 llamadas. El
  cliente `5RPUrQKfkERh4josuuvX` tiene piso USD 0,5 / 8 llamadas; ahora sus ejecuciones grandes pueden escalar hasta
  esos topes por defecto. Ajustable en Organizador → Configuración.
- **`organizerContinuation`** (ya desplegada, otra sesión): cada 5 min llama a `watch()` para clientes en modo
  `baseCode`, es decir, detecta cambios cada 5 min además de 12:00/18:00. No la cambié; con el punto 1 ya no hace falta
  para continuar ejecuciones. Decide si se elimina o se limita a continuar.

## Estimación para 1000 fotos (~500 artículos: 250 prendas y 250 objetos) con los valores actuales

| Etapa | Tiempo | Costo |
|---|---|---|
| Organizador: inventario + catálogo | minutos | — |
| Visión (legacy, 1 foto a la vez ~3 s) / (baseCode, 4 en paralelo) | ~50–80 min / ~15–25 min | USD 1–3 real (≤ USD 5.3 presupuestado) |
| Automatización: hashes (1000 descargas, 4 en paralelo) + congelado (1000 referencias) | ~10–20 min | — |
| Trabajos: 9 de prendas (30) + 7 de objetos (40) = 16; intake ≤ 5 min c/u, 5 en paralelo | ~15–20 min | incluido abajo |
| Generación: ~560 jobs de prendas + 1500 de objetos ≈ 2060 jobs (41–78 s c/u, hasta 400 en paralelo) | ~0,5–2 h (límite real: el proveedor) | Presupuesto contable ≈ USD 1350 (≈ 250 × 2.04 + 250 × 3.35); costo registrado en la prueba ≈ USD 0.15–0.18 por artículo ≈ USD 80–90 |
| Preparación SHEIN en segundo plano (autollenado, categorías, textos, recortes, publicación) | ~20–40 min | ≈ USD 5–15 |
| Descarga | ~30–60 s (solo ensambla) | — |

Total aproximado: **3–5 h** desde la detección, sin intervención, más la revisión humana de lo pendiente.

## Verificación

- `npm run lint`, `npm --prefix functions run build`, `npm run build`: OK.
- Suite completa bajo el emulador: 661 tests, 657 OK, 3 omitidos, **1 fallo preexistente** (`organizerMarketplace.integration`:
  «Usa una plantilla oficial de SHEIN sin hojas adicionales…»): falla igual en `HEAD` limpio, no está relacionado.
- Nota de entorno: iCloud renombra `node_modules/@esbuild/darwin-arm64/bin/esbuild` («esbuild 2/3/4»); los tests se
  corrieron con `ESBUILD_BINARY_PATH` apuntando a una copia.
