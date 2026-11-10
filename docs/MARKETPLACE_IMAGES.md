# Imágenes públicas para marketplaces

Tuto conserva las referencias y los resultados privados en su bucket Firebase actual. La publicación explícita crea copias JPG en `${projectId}-marketplace-images`, un bucket GCS separado en la misma región (`us-central1` en producción).

## Uso

En Catálogo → Exportar a marketplaces → Completar datos, selecciona la plantilla/categoría, abre el destino, autoriza la publicación y pulsa **Preparar URL para …**. Se publican solo las fotografías que el servidor considera aprobadas. Puedes copiar las URL o abrir los archivos y guardar el producto para volver a validar. Los cambios del formulario se conservan durante la preparación. Los enlaces de alojamiento externo siguen admitidos.

Abrir el catálogo, validar o descargar un Excel no publica fotografías. La proyección de exportación recupera publicaciones existentes y completa las asociaciones `image.0`, `image.1`, etc. de la plantilla. Los valores explícitos por fila siguen teniendo prioridad: una celda con una URL antigua debe vaciarse para usar su asociación o corregirse.

## Servidor y almacenamiento

- Callable tipado: `publishMarketplaceImages`, roles admin/operador/revisor, usuario activo con acceso al cliente, canal habilitado y consentimiento explícito. Comprueba el producto y vuelve a comprobar aprobación, selección, ruta y canal antes de publicar y al registrar el resultado. Límite: 20 fotografías aprobadas por producto/solicitud. Los errores por foto son visibles y permiten reintentar.
- Registro privado: `clients/{clientId}/products/{productId}/marketplaceImages/{marketplaceId}`, mapa `images` por output ID, con origen, perfil, medidas, peso, autor y fecha. Solo Admin SDK lo escribe; el navegador lo recibe mediante los callables. Las reglas existentes deniegan acceso directo a esta subcolección.
- Archivos públicos: `images/{sha256(clientId)}/{publicationHash}/{contentHash}.jpg`. La URL HTTPS directa de `storage.googleapis.com` no requiere token, cookie, firma ni redirección. El validador acepta esos enlaces únicamente cuando están asociados a una publicación del producto/canal y a una imagen aprobada.
- La Function transforma/publica; cada descarga posterior va directamente a GCS. `Cache-Control: public, max-age=86400, immutable`. Storage factura almacenamiento, operaciones y transferencia; no hay Function ni lectura de Firestore por descarga pública.
- Las publicaciones son idempotentes y no sobrescriben archivos; sobreviven a regeneraciones, cambios de selección, rechazo posterior y limpieza de outputs antiguos. Si una foto deja de estar aprobada, se excluye de nuevas exportaciones. Los enlaces ya exportados siguen disponibles. El borrado definitivo del cliente elimina sus copias públicas; las cachés pueden conservarlas hasta su vencimiento.

## Preparación técnica de imágenes

Perfil versionado `jpeg-v1`: JPG RGB sin transparencia, fondo blanco para zonas transparentes/márgenes, máximo 2.900.000 bytes, orientación EXIF aplicada. No modifica los originales. Límite de entrada: 32 MiB y 40 millones de píxeles; se rechazan imágenes animadas o con resolución insuficiente.

| Destino | Preparación |
| --- | --- |
| SHEIN | Lado corto de origen mínimo 900 px; copia cuadrada de hasta 2200 px con márgenes, sin recortar el producto. |
| TikTok Shop | Lado corto mínimo 600 px; conserva proporciones entre 3:4 y 4:3 y añade márgenes cuadrados fuera de ese rango; máximo 2200 px. |
| Amazon | Lado corto mínimo 500 px; conserva proporción y limita el lado largo a 2200 px. |
| Mercado Libre | Lado corto mínimo 500 px; conserva proporción y limita el lado largo a 1920 px. |

Se añaden márgenes también si una reducción dejaría el lado corto por debajo del mínimo. Estos perfiles aseguran transporte/formato y medidas básicas; no certifican requisitos visuales, cantidad de imágenes, imagen principal, variantes o categoría. Esos requisitos y la aceptación de cada plantilla se verifican en el marketplace correspondiente.

## Aprovisionamiento y despliegue

`node scripts/setup-marketplace-image-bucket.mjs` muestra el plan. `--apply` crea el bucket de publicación si falta, en la ubicación del bucket actual, y comprueba proyecto/acceso uniforme si ya existe. Concede `roles/storage.legacyObjectReader` a `allUsers` (solo lectura de objetos, sin listado) y `roles/storage.objectUser` a la cuenta de ejecución de `saveMasterProduct` (publicación y limpieza al borrar definitivamente el cliente). No modifica IAM del bucket privado ni permisos globales del proyecto. La prevención de acceso público de la organización debe permitir este bucket.

El bucket se administra como GCS mediante IAM; no se registra como bucket cliente Firebase ni se abren las reglas Storage actuales. El nombre se deriva del proyecto del Admin SDK. Si cambia la cuenta de ejecución, hay que actualizar su concesión en el bucket.

Tras build/lint/pruebas, desplegar `publishMarketplaceImages`, `previewMarketplaceExports`, `downloadMarketplaceExports`, `saveMasterProduct`, `permanentlyDeleteClient` y Hosting. Otros endpoints privados y exportaciones históricas permanecen con sus contratos actuales.

Pruebas: `marketplaceImages.test.ts` cubre transformación y URL; `marketplaceImages.integration.test.ts` usa emuladores para permisos, consentimiento, idempotencia, Excel, aislamiento y retención/borrado; `e2e/marketplace-export.spec.ts` comprueba la publicación explícita y conservación del formulario con dobles locales.
