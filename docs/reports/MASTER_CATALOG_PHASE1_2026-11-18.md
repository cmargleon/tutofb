# Entrega y verificación — Catálogo Maestro, fase 1

Fecha: 18 de noviembre de 2026. Repositorio `cmargleon/tutofb`. Proyecto Firebase `tutofb-260320-1003`.

## Resultado funcional

Vista independiente en `/catalogo/productos`, con cliente, búsqueda por nombre/referencia, estado, paginación, creación sin lote, ficha universal, variantes, atributos, procedencia, incidencias y selección ordenada de fotografías aprobadas. El editor reutiliza ProductDraftEditor y las definiciones compartidas del editor de marketplaces; no exige plantilla SHEIN.

La colección de productos existente es la ficha persistente. Alias y links separan identidad comercial, variantes, lotes, jobs y drafts. Las exportaciones mantienen su identidad histórica, overrides y publicaciones, mientras leen los campos universales de la ficha asociada. No se ejecutó una migración masiva ni se crearon datos comerciales de prueba en producción.

Arquitectura encontrada, archivos, modelo completo, compatibilidad, operación de migración y recomendaciones de fase 2: [MASTER_CATALOG.md](../MASTER_CATALOG.md).

## Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `npm run lint` | Aprobada |
| `npm --prefix functions run lint` | Aprobada, también en predeploy |
| `npm --prefix functions run build` | Aprobada |
| `npm run build` | Aprobada; repetida por Hosting |
| `npm test`, copia aislada de esta fase | 405 pruebas: 373 aprobadas, 32 omitidas por requerir entorno de integración, 0 fallos |
| Unitarias nuevas `masterCatalog.test.ts` | 5/5 aprobadas |
| Emuladores Firestore/Auth/Storage, proyecto demo | 20/20 aprobadas |
| E2E de catálogo maestro y aislamiento de cliente | 4/4 aprobados, navegador aislado con dobles locales y red externa bloqueada |
| Diff y manifiesto | Sin errores de whitespace; código de release coincide con los archivos de esta fase |

Los emuladores ejecutaron `masterCatalog.integration.test.ts`, `marketplaceExport.integration.test.ts`, `marketplaceLifecycle.integration.test.ts`, `marketplaceImages.integration.test.ts` y `productWorkflow.integration.test.ts`. Incluyen creación/reintentos sin lote, edición de campos/variantes, dos lotes sobre una ficha, mapeo de variantes de exportación sin modificar filas antiguas, confirmación manual persistente tras actualizaciones automáticas, aislamiento, claims falsificados, revisiones obsoletas, ceros iniciales, prioridad manual, duplicados, publicaciones conservadas, selección de imágenes revalidada, previews sin escritura y paginación.

No se generaron fotografías con proveedores reales durante las pruebas. Los E2E validan la interfaz con datos sintéticos, no una sesión autenticada contra la producción.

## Fallos preexistentes reproducidos

1. `organizerMarketplace.integration.test.ts`: el fixture intentaba usar IDs inexistentes en categorías sin analizar. Se corrigió ese montaje para persistir las categorías ya analizadas. Con la plantilla oficial local `Vaso(1083-3218)`, la prueba llega a una aserción preexistente: espera dos llamadas Gemini simuladas y recibe diez (línea 144). Se reprodujo el mismo `10 !== 2` sobre el código original de `HEAD`, aplicando únicamente la corrección del fixture. No se relajó la aserción. Sin la plantilla oficial externa, el fallback sintético tampoco cumple el saneamiento del catálogo SHEIN compartido.
2. `e2e/product-workflow.spec.ts`: un recorrido espera un botón «Importar referencias» que ya no aparece en el wizard (línea 19). Se reprodujo el mismo fallo en `HEAD`, sin cambios de esta fase; el segundo caso pasa. La prueba de backend `productWorkflow.integration.test.ts` sí pasa.

Estas dos comprobaciones adicionales no se contabilizan como aprobadas en las cifras anteriores. Las exportaciones multicanal/SHEIN existentes y el ciclo de publicación de imágenes sí pasan sus pruebas de integración.

## Inspección de producción

Se ejecutaron consultas de solo lectura y acotadas: seis clientes, hasta cinco productos y tres lotes por cliente. Se profundizó en una ficha heredada con revisión 2, variantes almacenadas como overrides del Organizador y una publicación existente; no tenía links canónicos. En tres lotes se contrastaron hasta cinco jobs y cinco drafts con la fórmula histórica de identidad. La muestra confirma que hay producción sin ficha persistida; no equivale a un inventario de todo Firestore.

## Despliegue y controles

Las 13 funciones fueron desplegadas y verificadas en estado `ACTIVE`, con Node.js 22 y región `us-central1`. El índice fue desplegado sin borrar otros índices y se verificó en estado `READY` el 18 de noviembre. Hosting también quedó publicado. La URL [Catálogo maestro](https://tutofb-260320-1003.web.app/catalogo/productos) devuelve HTTP 200; el JavaScript público coincide por SHA-256 con la copia aislada verificada e incluye la ruta nueva. Se comprobaron `listCatalogProducts`, `getCatalogProduct` y `previewCatalogImport` sin autenticación: los tres devuelven HTTP 401 `UNAUTHENTICATED`.

Las funciones de esta fase se publican desde una copia aislada basada en `HEAD` más los archivos enumerados en la guía. Los cambios simultáneos de edición fotográfica presentes en el workspace se conservaron y se excluyeron del despliegue. No hubo installs, cambios de dependencias, secretos, reglas de acceso, paths de Storage, commits ni push.

Las funciones afectadas son:

- Nuevas: `listCatalogProducts`, `getCatalogProduct`, `saveCatalogProduct`, `listCatalogLegacyBatches`, `previewCatalogImport`, `applyCatalogImport`, `getCatalogGenerationImages`, `syncCatalogJob`, `syncCatalogDraft`.
- Actualizadas por compatibilidad: `previewMarketplaceExports`, `downloadMarketplaceExports`, `saveMasterProduct`, `publishMarketplaceImages`.
- Índice de `products`: `catalog.status` + `catalog.searchKeys` + orden de documento. No se desplegaron reglas modificadas.

Los dos triggers tienen reintentos de Firebase, con deduplicación por fuente y transacciones; se confirmó esa política en el despliegue. La prueba remota sin autenticación de `listCatalogProducts` devuelve HTTP 401 `UNAUTHENTICATED`. Además, se ejecutaron localmente los handlers de lectura de esta release contra Firestore real mediante el cliente administrativo de inspección: listado, ficha, página de lotes y dry-run devolvieron resultados, y el conteo de productos permaneció en 1 antes/después. Esto verifica compatibilidad con datos heredados reales, sin crear una sesión de Auth ni ejecutar endpoints de escritura; no se presenta como prueba de una sesión web autenticada en producción.

## Pendiente operativo y fase 2

Revisar e incorporar el histórico por cliente desde el dry-run. Las fichas ya guardadas se ven sin filtro; las búsquedas y filtros indexados de registros antiguos requieren su incorporación/guardado canónico. No hay asociaciones por SKU automáticas ni fusión de fichas confirmadas. El selector de destinos usa la página actual del catálogo.

Los límites documentados y los dos fallos preexistentes siguen pendientes. Para fase 2: selección de ficha antes de generar, informe paginado de cobertura histórica y adaptación de canales desde el maestro con mapeos y versiones; publicación por APIs, sincronización de stock y pedidos quedan fuera de esta fase.
