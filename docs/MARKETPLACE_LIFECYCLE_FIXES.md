# Correcciones multicanal: verificación del 9 de noviembre de 2026

## Base y reproducción previa

`HEAD` era `8632676`, sin cambios locales ni commits posteriores. Se leyeron `AGENTS.md`, `ARCHITECTURE.md` y `docs/MARKETPLACE_EXPORTS.md` antes de editar código.

Se compilaron Functions y se invocaron sus handlers reales (`.run`) contra Firebase local, proyecto `demo-manglar-automation`, base dedicada `test-marketplace-reproduction`. Node 22.22.0 y `scripts/test-emulator-guard.mjs` bloquearon conexiones externas. Los libros de esta reproducción son fixtures estructurales sintéticos.

- Importar/activar A, guardar un producto vinculado a A, importar B con `replacesTemplateId: A` y activar B dejó **A activa en v2 y B activa en v4**, con un documento intermedio archivado en v3. El producto seguía vinculado a A.
- Guardar SHEIN/Amazon, deshabilitar Amazon mediante `updateClientMarketplace` con su estado esperado y guardar solo un cambio de nombre, incluyendo el payload del editor, produjo **`invalid-argument: Marketplace no disponible.`** Rehabilitar Amazon confirmó que sus datos seguían almacenados.

Evidencia previa: `/tmp/tuto-marketplace-reproduction.log`. Las primeras regresiones fallaron con el código original: `/tmp/tuto-marketplace-regression-before.log`. No se usaron clientes de producción para reproducir los problemas.

## Causas y solución

El importador incrementaba la versión, y la activación volvía a incrementarla y archivaba solo el upload, perdiendo la relación operativa con la versión vigente. Ahora los uploads tienen v0 hasta su confirmación y se activan en su propio documento; el reemplazo suma uno a la versión publicada del predecesor. Reconfigurar una versión publicada crea otro documento. No se renumera el historial existente.

La transacción relee cliente, origen, categorías y predecesor y contrasta el estado leído durante el análisis. Solo una activación puede sustituir cada versión vigente. Si el ciclo anterior dejó ancestros publicados activos, la siguiente activación los retira dentro de ese linaje explícito; conserva sus números y sus productos. Las versiones archivadas manualmente no se rehabilitan. Las asociaciones heredadas tienen destino determinista y comprobación de asociaciones anteriores para impedir duplicados concurrentes. Conservan una copia propia con precondición de no sobrescritura; las revisiones multicanal reutilizan su archivo ya protegido.

La versión sustituida queda archivada con `exportConfig.supersededByTemplateId`. Deja de ser una opción vigente para nuevos productos, pero los ya vinculados conservan sus categorías, mappings y exportación con esa versión. La disponibilidad de un producto histórico no depende de que siga existiendo una versión vigente seleccionable para productos nuevos. El archivo manual de su propia versión quita esa autorización histórica. `legacyTemplateIds` conserva el linaje; las plantillas de generación y los drafts heredados permanecen intactos.

El editor enviaba todos los canales almacenados y el servidor rechazaba cualquiera deshabilitado. Además, sustituía el mapa completo. Ahora el editor envía los habilitados y evita alterar localmente filas o exenciones de los deshabilitados. El backend combina por canal dentro de una transacción, partiendo del documento persistido. Los omitidos permanecen íntegros. Un cliente anterior puede enviar un canal deshabilitado solo si coincide exactamente con el almacenado; modificarlo o añadirlo clandestinamente se rechaza. Se releen la habilitación y las plantillas, manteniendo `expectedRevision` y los permisos existentes.

## Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `functions/src/callables/importClientSpreadsheetTemplate.ts` | Predecesor vigente válido y upload pendiente sin incremento publicado |
| `functions/src/callables/marketplaceExports.ts` | Activación/archivo transaccionales y merge de productos con revisión y validación de canales |
| `functions/src/spreadsheets/marketplaceTemplates.ts` | v0 mientras está pendiente |
| `functions/src/spreadsheets/marketplaceExportService.ts` | Disponibilidad vigente e histórica vinculada |
| `shared/src/types/marketplaceExport.ts` | Marca de sustitución y documentación del patch por canal |
| `src/features/marketplaces/MarketplaceTemplates.tsx` | Presentación de estados y reemplazo solo de versiones publicadas |
| `src/features/marketplaces/MarketplaceProductEditor.tsx` | Payload habilitado, conservación local y selección histórica |
| `tests/marketplaceLifecycle.integration.test.ts` | Regresiones con Firebase local, concurrencia, permisos e integridad |
| `tests/marketplaceTemplateLifecycle.test.ts` | Invariantes de disponibilidad por canal y estado |
| `tests/marketplaceExport.integration.test.ts` | Expectativa de activación del documento pendiente |
| `e2e/marketplace-export.spec.ts` | Edición sin Amazon y selección de plantilla histórica |
| `e2e/support/local-fixtures.mjs` | Escenarios y doble de guardado con merge por canal |
| `docs/MARKETPLACE_EXPORTS.md` y este informe | Contrato y evidencias |

## Preservación y límites

Las integraciones comparan los productos antes/después del reemplazo, las categorías/mappings de A, el documento heredado completo, sus categorías y sus drafts con columnas desconocidas. Comparan byte a byte cada upload y original persistido, incluida la copia heredada. Descargan un XLSX después de reemplazar A y comprueban que conserva el override del producto vinculado a A.

También comparan filas y requisitos de Amazon después de deshabilitar, editar maestro/variantes, omitir canales, rechazar modificaciones clandestinas, competir guardados con la misma revisión y rehabilitar. Incluyen todos los canales deshabilitados, un cambio de habilitación entre prevalidación y transacción, admin/operador/revisor, anonimato y acceso cruzado a clientes/lotes/plantillas.

La prueba existente con Barbie y VANS contrasta partes ZIP, validaciones, nombres, fórmulas, merges y metadatos. Esto comprueba conservación del XLSX, no aceptación comercial por los marketplaces.

No se modificaron generación de fotos, presupuestos, workers, revisión de imágenes, serializadores ni formatos Excel. No cambiaron dependencias, lockfiles, reglas, índices, targets o secretos. No se ejecutan migraciones ni borrados de originales de producción.

## Validación y despliegue

- `npm run lint` y `npm --prefix functions run lint`: correctos.
- `npm run build` y `npm --prefix functions run build`: correctos; el despliegue también ejecuta los checks de Functions.
- Suite completa: `npm test`, invocado por `scripts/run-emulator-tests.mjs` desde `firebase emulators:exec --project demo-manglar-automation --only firestore,auth,storage`, con Node 22.22.0 y `TUTO_REAL_TEMPLATE_DIR=/tmp/tuto-marketplace-real`. La guardia de red original permanece sin modificaciones. **Resultado final: 389 aprobadas, cero fallos y cero omisiones.** Registro: `/tmp/tuto-marketplace-lifecycle-release-final-suite.log`.
- `./node_modules/.bin/playwright test e2e/marketplace-export.spec.ts`: **8 aprobadas**. Registro `/tmp/tuto-marketplace-lifecycle-e2e-final.log`.
- `git diff --check`: correcto.

Las ejecuciones preliminares mostraron interferencias al solapar dos ejecuciones de la misma suite y al reutilizar emuladores con datos de otras suites. La ejecución final usa emuladores recién iniciados y termina apagándolos. También se normalizó como `aborted` el error de transacción cerrada que Firestore local puede devolver bajo contención; no se ocultan otros errores de validación.

Se despliegan únicamente `importClientSpreadsheetTemplate`, `configureMarketplaceTemplate`, `archiveMarketplaceTemplate`, `saveMasterProduct`, `previewMarketplaceExports`, `downloadMarketplaceExports` y Hosting en `tutofb-260320-1003`. Sin despliegue de workers, reglas o índices. **Despliegue completado y verificado:** las seis Functions están `ACTIVE` con Node 22 en `us-central1`. Sus hashes cambiaron respecto al inventario anterior; ninguna otra Function cambió. Hosting está publicado y sus hashes coinciden con el build local. Registro del despliegue final: `/tmp/tuto-marketplace-lifecycle-deploy-final.log`; verificación: `/tmp/tuto-marketplace-lifecycle-remote-verification.json`.

La verificación de Hosting comparó SHA-256 de `index.html`, el chunk de detalle de cliente y el drawer de exportación publicados con el build local: coinciden. Los seis endpoints devolvieron `401 UNAUTHENTICATED` ante un POST anónimo. Registros: `/tmp/tuto-marketplace-lifecycle-hosting-verification.json` y `/tmp/tuto-marketplace-lifecycle-http-verification.json`. Tras la actualización final se repitió la comprobación HTTP de los seis endpoints, con el mismo resultado. Las operaciones autenticadas se comprobaron en emuladores; no se ejecutaron ediciones ni exportaciones sobre datos de producción.
