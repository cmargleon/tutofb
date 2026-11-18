# Catálogo Maestro — Fase 1

Implementación del 18 de noviembre de 2026. Esta guía describe el código de esta fase; el estado de verificación y despliegue está en `docs/reports/MASTER_CATALOG_PHASE1_2026-11-18.md`.

## Arquitectura encontrada y decisiones

La colección `clients/{clientId}/products/{productId}` ya guardaba correcciones y configuración por canal. `masterProducts.ts` reconstruía productos desde jobs y drafts; `organizerProducts.ts` enriquecía esa proyección con procedencia de Excel/Drive y overrides. `loadExportContext` agregaba plantillas, publicaciones y categorías. No había listado comercial independiente ni creación sin lote.

Se amplía esa colección, sus tipos y sus consumidores. No se cambian las fórmulas de `masterProductId` ni `jobMasterProductId`, estados de producción, paths de Storage, contratos de los wizards o estructura de publicaciones. No se añade otra colección de productos paralela.

## Modelo definitivo

El ID del documento es la identidad canónica. En una ficha creada sin lote es un UUID elegido una vez por el navegador, que se reutiliza en los reintentos. Al incorporar un producto heredado se conserva su ID histórico salvo asociación explícita a otra ficha.

Los campos existentes siguen siendo `clientId`, `values`, `variants`, `marketplaces`, `revision`, `updatedAt`, `updatedByUid` y los overrides históricos del Organizador. Los valores comerciales son cadenas, incluidos precio e identificadores: no se convierten SKU/GTIN a números ni se infieren monedas o unidades.

Se añade `catalog`:

- `version: 1`, `status: draft | active | archived`, `createdAt`.
- `evidence`: fuente, valor original y normalizado, confianza, referencia, estado `unknown | empty | confirmed | suggested` y verificación explícita cuando procede. La ausencia de una propiedad representa desconocimiento; `''` confirmado representa vacío explícito.
- `attributes`: pares nombre/valor estructurados para propiedades adicionales.
- `issues`: incidencias de diferencias, identidad incierta y posibles duplicados, con ambos valores y referencia; se conservan hasta 200 incidencias recientes.
- `searchKeys`: proyección indexada de comienzos del nombre/palabras y referencias exactas SKU/SKC/SPU; no sustituye los valores originales.
- `thumbnailPath`: una referencia, sin bytes ni URL pública.
- `selectedImages`: referencias ordenadas a link, job y output aprobados, hasta 100 por ficha. Se revalidan contra el trabajo y su aprobación al guardar.
- `manuallyConfirmed`: marca persistente de confirmación manual; una actualización automática posterior no puede habilitar la fusión de esa ficha.
- `redirectTo`: únicamente para conservar como alias una proyección heredada que ahora apunta a otra ficha.

`MasterVariant` conserva `id`, `values`, `attributes` y admite evidencia. Sus IDs no cambian al guardar ni al incorporar otra generación. La relación con el producto es su pertenencia a `variants` y el mapa explícito de cada generación. Se rechazan dos variantes de origen asignadas a una única variante de destino.

`marketplaces` mantiene `ProductMarketplaceData`, plantillas/versiones, filas específicas, requisitos y URLs autorizadas. El editor universal no exige marketplace, plantilla ni categoría SHEIN. Los cambios en overrides del canal no se copian a `values`.

## Jobs, lotes, borradores e imágenes

`products/{canonicalId}/generationLinks/{hash(batchId, legacyProductId)}` contiene `clientId`, lote, ID heredado, garmentId, drafts, referencias del Organizador, `variantMap` y huellas de incorporación por fuente. El ID y las huellas hacen idempotente la incorporación. Las relaciones no dependen de un array creciente dentro de la ficha.

`clients/{clientId}/productAliases/{legacyProductId}` resuelve la proyección histórica a la ficha canónica. La exportación mantiene el ID histórico y la ubicación de sus publicaciones; utiliza datos universales canónicos y traduce IDs de variantes en las filas y asignaciones de fotos, sin modificar los registros antiguos durante una lectura.

Las fotografías originales y generadas permanecen en sus paths actuales. Los outputs e historial continúan en jobs y sus subcolecciones, y las publicaciones continúan en `products/{legacyId}/marketplaceImages`. La ficha consulta las imágenes efectivas de la generación solicitada y permite ordenar una selección reutilizable aprobada. No publica archivos ni convierte URLs privadas en públicas. El detalle de generaciones se pagina de 20 en 20; las fotografías se resuelven con los componentes y resolver de Storage existentes.

Los triggers nuevos observan eventos futuros de identidad de jobs y datos de drafts, con `APP_FIRESTORE_DATABASE_ID` explícito. Ignoran cambios de progreso y revisión que no afectan esos datos; la aprobación efectiva de imágenes se consulta en vivo. Los despliegues no recorren el histórico. Los reintentos leen la fuente actual y respetan la revisión de la ficha.

## Identidad, precedencia y concurrencia

No existe asociación automática por SKU, nombre, imagen o similitud. Un SKU coincidente produce una incidencia, aislada por cliente. La consulta de duplicados es acotada y vuelve a realizarse al abrir la ficha para detectar creaciones concurrentes.

La asociación a una ficha diferente requiere confirmación y mapa de variantes. Puede asociarse una proyección automática con una sola generación y sin confirmación manual, publicación o selección. Las fichas ya confirmadas, con publicaciones o varias generaciones no se fusionan; se deja la incidencia para revisión.

La prioridad de consolidación es manual > comercial verificado > importado > IA. Los overrides antiguos sin evidencia se tratan conservadoramente como manuales. Un conflicto conserva el valor de mayor prioridad y registra la diferencia; un nuevo import no rellena un vacío confirmado manualmente. Las sugerencias identificadas como IA conservan esa procedencia y estado sugerido.

Las escrituras usan transacciones, revisión esperada y comprobación de cliente activo. Una revisión obsoleta devuelve `aborted`; el formulario conserva las ediciones. Se reemplazan campos completos conocidos sin sustituir documentos ni subcolecciones, preservando extensiones futuras y publicaciones. No se permite escritura privilegiada desde el SDK cliente.

## Interfaz y uso

La vista está en `/catalogo/productos` y en el enlace «Productos maestros» de Catálogo. También es accesible desde Productos en la ficha de cliente mediante `catalogView=products`. El catálogo de fotografías conserva sus rutas y comportamiento.

1. Seleccionar cliente y consultar fichas, miniatura, marca, referencia, variantes, precio/moneda, fecha, datos pendientes e incidencias.
2. Buscar por inicio del nombre o sus palabras, o identificador exacto; combinar con estado. El servidor pagina por ID estable. El listado consulta la colección del cliente, sin reconstruir lotes ni recorrer jobs. Usa hasta tamaño de página + 26 documentos para saltar alias históricos.
3. Crear «Nuevo producto» y guardar sin lote ni plantilla. Editar valores, variantes, atributos, verificación declarada de GTIN, evidencia e incidencias.
4. Abrir generaciones, fotografías originales, efectivas/aprobadas y trabajos asociados. Elegir y ordenar referencias aprobadas para reutilización y guardar la ficha.
5. Abrir «Incorporar histórico», paginar lotes y ejecutar «Previsualizar (dry-run)». La respuesta muestra datos, huella, asociaciones y posibles duplicados sin escribir documentos. Elegir incorporación conservando ID o una ficha de destino y sus variantes; revisar diferencias y confirmar cada registro.

## Migración incremental y límites

No se ha ejecutado una migración masiva. El histórico no materializado necesita revisión e incorporación por registro. Una ficha heredada ya persistida aparece sin filtro; la búsqueda y filtro indexados requieren que se haya guardado/incorporado su metadato canónico. Los overrides parciales del Organizador se reconstruyen al incorporar su fuente.

La consulta de producción inicial fue de solo lectura: seis clientes, hasta cinco fichas y tres lotes por cliente. La muestra encontró una ficha con overrides del Organizador y varios clientes con lotes sin fichas. No constituye un inventario completo ni un reporte de migración de todo el proyecto.

Los límites explícitos son 200 variantes, 700 KB por ficha, 1000 jobs/drafts por lote de incorporación, 25 registros de catálogo por página de UI (API 1–50), 20 links por página de detalle y 100 selecciones de imagen. Se conservan hasta 200 incidencias recientes; la fuente completa permanece en el histórico.

El selector de destino del histórico muestra las fichas de la página actual: usar la búsqueda/paginación antes de abrir el histórico para localizar el destino. No hay fusión destructiva de fichas confirmadas, carga masiva de nuevos Excel arbitrarios ni catálogo completo de todos los outputs históricos dentro de este editor; se reutilizan los imports/drafts/Organizador y la revisión fotográfica existentes.

Los controles existentes de Firestore ya permiten leer productos únicamente por cliente y deniegan escritura. Alias y links se consultan mediante callables autorizados; no se amplían permisos de reglas ni de Storage. Se añade únicamente el índice combinado de estado y búsqueda.

## Archivos de esta fase

- Contratos: `shared/src/types/catalog.ts`, `marketplaceExport.ts`, `index.ts`.
- Servicio: `functions/src/catalog/model.ts`, `validation.ts`, `service.ts`, `triggers.ts`; callables `catalogProducts.ts`; exportación desde `functions/src/index.ts`.
- Compatibilidad: `functions/src/spreadsheets/masterProducts.ts`, `marketplaceExportService.ts`, `functions/src/callables/marketplaceExports.ts`.
- Vista y acciones: `src/features/catalog/MasterCatalog.tsx`, `CatalogProductForm.tsx`, `CatalogLegacyImport.tsx`, `useMasterCatalog.ts`, `masterFirebase.ts`, `productFields.ts`.
- Integración: `src/pages/Catalogo.tsx`, `src/app/AppRouter.tsx`, `src/components/layout/navigation.ts`, `src/features/marketplaces/MarketplaceProductEditor.tsx` (reutiliza definiciones de campos).
- Índice: `firestore.indexes.json`.
- Pruebas: `tests/masterCatalog.test.ts`, `masterCatalog.integration.test.ts`, corrección de IDs de fixture en `organizerMarketplace.integration.test.ts`, `e2e/master-catalog.spec.ts`, fixture específico y entrada opcional en `e2e/support/local-fixtures.mjs`.

## Fase 2

Adaptar cada canal desde esta identidad canónica con mapeos/versiones explícitas y overrides propios; añadir una selección comercial directa en los wizards para vincular antes de crear nuevas fotografías. Preparar una migración por páginas con informe de cobertura, decisiones de identidad y autorización de ejecución por cliente. Mantener separadas las siguientes capacidades: publicación por APIs, inventario y pedidos. Antes de activarlas, corregir las expectativas preexistentes de los simuladores de SHEIN y probar con archivos y cuentas de prueba autorizadas.
