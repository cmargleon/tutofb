# Exportación multicanal de productos

Implementación del 9 de noviembre de 2026 sobre `df1587e`. No cambia proveedores, prompts, escenas, modelos, revisión, reintentos, presupuestos ni contadores de generación.

## Responsabilidades y contratos

- `shared/src/types/marketplaceExport.ts`: producto maestro, variantes, evidencia, configuración específica de canal, versiones de mappings, prevalidación y descarga. Las autorizaciones de exención de GTIN se guardan en los requisitos de Amazon, con contexto de marca/categoría; no se comparten entre canales. Los campos comerciales desconocidos permanecen vacíos. SKU, GTIN, ASIN y demás identificadores no se generan.
- `functions/src/spreadsheets/masterProducts.ts`: proyección de los jobs y ProductDrafts actuales. Conserva los drafts completos, incluidas columnas desconocidas, evidencia/confianza y referencias originales. Combina correcciones almacenadas en `clients/{clientId}/products/{productId}`. El ID determinista usa lote/artículo y, para Automation, `automationJobId`/artículo: varios `batchIds` del mismo trabajo no duplican el producto.
- `shared/src/marketplaceExport/adapters.ts`: adaptadores SHEIN, Mercado Libre, TikTok Shop y Amazon independientes de React y de los workers de imágenes. Preparan filas, aplican equivalencias de valores, mantienen las correcciones explícitas de salida y validan obligatoriedad, listas, identificadores y fotografías. Categoría/plantilla se seleccionan explícitamente por producto; no se adivina una categoría comercial.
- `marketplaceTemplates.ts`: analiza la estructura según las claves del adaptador, conserva categorías del importador SHEIN existente, extrae validaciones del paquete original y permite confirmar la primera fila de datos. Un formato desconocido queda incompatible. Abrir un ZIP/Excel no lo activa. La activación requiere revisión administrativa de estructura, categorías, campos obligatorios y asociaciones.
- `marketplaceExportService.ts`: autoriza cliente y cada lote, recupera información histórica, resuelve plantillas/categorías, agrupa productos, valida y prepara coordenadas. `previewMarketplaceExports` es de solo lectura: no serializa un libro ni crea artefactos o productos.
- `downloadMarketplaceExports`: única entrada del motor multicanal que serializa XLSX/ZIP. Una transacción deduplica por usuario/cliente/requestId con lease de diez minutos; el botón también tiene bloqueo síncrono. Se revalida al descargar. La validación multicanal toma las listas reales de cada categoría y no aplica las suposiciones históricas que fijaban Color/Talla. Un canal con errores no excluye productos: falla ese canal completo. Los demás se entregan y los fallidos quedan disponibles para un reintento explícito.

Las interfaces de producto/canal y las filas adaptadas permiten añadir un transporte API sin crear cuatro catálogos de productos. No se añadieron credenciales ni conexiones de publicación.

## Flujo de uso

1. En Cliente → Marketplaces, habilitar el canal y subir uno o varios XLSX oficiales. Se conserva una copia íntegra, fingerprint SHA-256, archivo/nombre original, categorías, operación, fecha y versión.
2. Revisar atributos, primera fila de productos, obligatoriedad, tipos de celda, fuentes y equivalencias. Las asociaciones admiten `product.campo`, `variant.campo`, `attribute.campo`, `legacy.columna`, `image.índice` y `literal.valor` explícito. Los identificadores se mantienen como texto.
3. Activar una revisión pendiente en su propio documento. Los uploads pendientes usan `version: 0`; la primera activación asigna v1 y cada sustitución suma uno a la versión vigente reemplazada, dentro de una transacción. Modificar asociaciones de una versión ya activada crea otro documento; reutiliza su original protegido sin sobrescribir archivos. Asociar una plantilla heredada crea un documento de exportación y una copia propia; conserva la plantilla de generación intacta. `replacesTemplateId` apunta a la versión activada sustituida y `legacyTemplateIds` conserva el linaje. Dos activaciones de la misma revisión o dos reemplazos del mismo origen no pueden ganar simultáneamente; una operación desactualizada debe recargarse.

   La versión sustituida queda archivada con `supersededByTemplateId`: no es una opción vigente para nuevos productos, pero los productos ya vinculados pueden seguir guardándose y exportándose con sus categorías y mappings originales. El archivo manual elimina esa autorización histórica, conservando documentos y archivos. Las versiones multicanal no se pueden borrar con el callable heredado. Una activación también retira los ancestros publicados que el ciclo anterior dejó activos dentro de su linaje explícito, sin alterar productos ni rehabilitar archivos manuales. Las versiones publicadas antes de esta corrección conservan su numeración; no se renumeran ni migran datos existentes.
4. Generar fotografías con el flujo existente. El modo predeterminado sigue siendo fotografías sin plantilla. Las plantillas de salida multicanal no aparecen como plantillas de generación. Automation sigue usando su pipeline y `batchIds` existentes.
5. Abrir Catálogo y seleccionar un lote → **Exportar a marketplaces**. Automation ofrece el mismo componente para todos sus lotes. El flujo manual ya termina en el Catálogo. El panel nunca se abre por un proceso en segundo plano.
6. Completar el producto maestro/variantes y los datos particulares del canal utilizando `ProductDraftEditor`. Revisar errores agrupados por destino y producto. Se admite uno, varios o todos los canales habilitados. Los destinos sin plantilla compatible quedan deshabilitados con acceso a su configuración. No hay exportación parcial silenciosa de productos.
7. Presionar **Descargar**. Si el resultado contiene un solo libro se descarga XLSX; si hay varios, incluso si pertenecen a un único marketplace, se descarga ZIP. Un workbook oficial con varias hojas de categoría conserva esas hojas; varios templates producen varios archivos.

## Preservación del XLSX

`ooxmlWorkbook.ts` edita directamente las partes XML de celdas dentro del ZIP original usando JSZip, que ya era dependencia. SheetJS se utiliza para leer; no se utiliza su writer en el motor multicanal. Se conservan literalmente las demás partes del paquete, relaciones, hojas auxiliares/ocultas, nombres definidos, estilos, fórmulas, validaciones, listas y combinaciones. Las nuevas celdas pueden heredar el estilo de la primera fila de productos. Texto e identificadores se escriben como `inlineStr`; los números se escriben como números solo con asociación explícita. No se ejecutan fórmulas proporcionadas como valores.

No se sobrescriben fórmulas ni celdas combinadas. Una comprobación de coordenadas de solo lectura detecta estos bloqueos durante la prevalidación. No se extienden arbitrariamente las validaciones fuera de sus rangos. Macros, firmas, vínculos externos y hojas operativas protegidas/con tablas estructuradas quedan bloqueados cuando requieren soporte específico. Una hoja auxiliar protegida se conserva sin impedir editar otras hojas de captura.

`validationFormula.ts` interpreta exclusivamente un subconjunto acotado: nombres de rango, `INDIRECT`, `IF`, `ISBLANK`, `SUBSTITUTE`, concatenación y referencias de celda relativas/absolutas. No ejecuta JavaScript, macros ni funciones arbitrarias. Resuelve los desplegables dependientes comprobados en los archivos reales de SHEIN. Las fórmulas/listas no resolubles o los nombres locales ambiguos bloquean valores, en vez de aceptar texto libre. También se comprueban validaciones numéricas simples en las coordenadas originales durante prevalidación/descarga.

La exportación heredada conserva sus endpoints/contratos, incluyendo Google Sheets y la conversión histórica de XLS binario. Sus XLSX también usan la edición del paquete original. El modo binario heredado conserva su conversión anterior y no se admite como plantilla multicanal. La compatibilidad de la hoja heredada no certifica que sus enlaces internos sean publicables: el flujo multicanal valida fotografías y URLs por separado.

## Fotografías y seguridad

El motor recupera únicamente outputs actuales completados, no marcados para revisión, aprobados por Gemini o seleccionados explícitamente por el operador mediante el mecanismo existente. No publica imágenes de Storage, no crea tokens de descarga de originales ni usa URLs temporales de Firebase/Drive para publicar.

Si la plantilla necesita URLs, el operador debe alojar las fotografías aprobadas en un servicio autorizado y registrar sus URLs HTTPS permanentes con confirmación explícita. Se rechazan URLs con tokens/query, hosts privados, Firebase, Drive y proxies autenticados. Una URL debe estar asociada al ID de una imagen aprobada del mismo producto. Esto es una autorización declarada por el operador, no una comprobación de identidad visual del contenido remoto ni una publicación automática. Las URLs de outputs que dejan de estar aprobados no se exportan.

Los callables usan roles actuales, acceso efectivo al cliente y comprobación individual de cada batch. No basta enviar un `clientId` permitido junto con lotes ajenos. Configurar/importar/archivar exige administrador; editar datos y descargar conserva los roles admin/operador/revisor. Se rechazan clientes archivados y escrituras concurrentes del producto mediante revisión esperada.

Firestore permite leer `clients/{clientId}/products` únicamente con acceso al cliente y prohíbe escrituras directas. Las plantillas/categorías siguen siendo de escritura servidor. Storage permite crear uploads administrativos, pero impide sobrescribir o eliminar originales vinculados a documentos de plantilla. No se añaden índices ni se cambian las convenciones de rutas existentes.

Los artefactos nuevos usan `client_spreadsheet_exports/{clientId}/{requestHash}/{fileName}`. Se entregan con URL firmada de quince minutos, sin token permanente. Un barrido horario elimina solo archivos marcados como temporales y pertenecientes al prefijo exacto de la solicitud. Conserva todos los paths de reintentos para evitar huérfanos. Las solicitudes fallidas sin resultado caducan a las 24 horas. `marketplaceExportRequests` no tiene acceso directo de navegador.

Límites explícitos: 20 MB por template, 100 MB expandido, 3000 partes ZIP, 100 categorías, documentos de plantilla por debajo de 850 KiB, 20 lotes/500 productos/2000 variantes por descarga y 200000 celdas por libro. El resultado se limita a 64 MB. Se conservan hasta 200 versiones consultables por cliente; el exceso requiere revisión administrativa.

## Migración y compatibilidad

No hay una migración destructiva ni un backfill automático sobre clientes reales. Las plantillas anteriores aparecen sin marketplace. El administrador elige el canal y revisa sus asociaciones: se crea una versión nueva con linaje y una copia del original. La plantilla heredada permanece activa para sus lotes y wizard actuales. El linaje permite recuperar datos antiguos mediante `legacy.columna` en versiones nuevas sin copiar cuatro veces la información.

Los ProductDrafts y batches no se reescriben durante una prevalidación. Un lote histórico sin drafts se proyecta desde sus jobs/fotos y puede completarse posteriormente. Las correcciones del maestro se guardan al pulsar Guardar, con control de revisión. `saveMasterProduct.marketplaces` es un patch por canal: los omitidos conservan íntegramente su configuración persistida. El editor envía solo los habilitados. La transacción relee cliente y producto, compara `expectedRevision` y aplica únicamente los canales habilitados; un canal deshabilitado enviado por un cliente anterior se acepta solo si coincide exactamente con el almacenado. Un cambio clandestino, un alta de configuración deshabilitada o una edición obsoleta se rechaza. Deshabilitar/rehabilitar no borra filas, URLs ni requisitos del canal, incluso si cambian campos maestros o variantes. Los flujos manuales de prendas/objetos y los automáticos no importan el serializador ni llaman al motor de exportación.

## Verificación con archivos reales

Se descargaron en modo lectura dos originales existentes mediante Manglar, sin modificar documentos ni archivos remotos:

| Archivo existente | Categorías | Hojas | Validaciones originales | Tras writer anterior | Columnas dependientes resueltas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Barbie | 8 | 28 | 210 | 0 | 24 |
| VANS | 10 | 34 | 235 | 0 | 30 |

`marketplaceRealTemplates.test.ts` verifica todas las partes ZIP sin cambios salvo las hojas con celdas solicitadas; compara validaciones, fórmulas y merges de esas hojas y comprueba posiciones/tipos de valores. Reproduce la pérdida del writer anterior y comprueba referencias dependientes tanto en fila 7 como en fila 8. Los originales descargados quedan fuera del repositorio en `/tmp/tuto-marketplace-real`.

En los 18 tabs aparece una validación de `origin_code` que apunta a `Lista de lugares de origen válidos`, mientras la hoja existente tiene su nombre truncado. El motor no corrige el original ni inventa opciones; ese campo permanece bloqueado si se intenta escribir. En estos archivos no figura obligatorio. Se necesita una plantilla oficial corregida si el marketplace requiere completarlo.

No se encontraron templates cargados de Mercado Libre, TikTok Shop ni Amazon. Sus adaptadores/transporte y casos de identificadores se prueban con fixtures estructurales explícitamente sintéticos. **No se certifica compatibilidad final de esos canales ni aceptación de subida en ninguna plataforma.** Tampoco se realizaron publicaciones ni generaciones pagadas para pruebas.

## Verificación reproducible y límites del entorno

- Baseline local: `npm test`: 225 aprobadas, 14 omitidas por ausencia de emuladores, cero fallos.
- Lint/typecheck frontend, build Vite, lint y build de Functions.
- Suite completa con Auth/Firestore/Storage locales, proyecto `demo-manglar-automation`, guardia de red y directorio de templates reales. Incluye aislamiento de reglas, versiones, archivo original intacto, migración aditiva, 1/2/3/4 canales, varios archivos en un solo canal, concurrencia, fallos independientes y limpieza.
- Prueba crítica añadida a `automationAdvanced.integration.test.ts`: crear/completar generación manual y automática con proveedores simulados; comprobar cero artefactos; validar; descargar explícitamente; comprobar la aparición del primer XLSX, sin nuevas llamadas al proveedor ni cambios del presupuesto.
- E2E nuevos: drawer, selección/reset, ausencia de canales, plantillas incompatibles/ausentes, móvil, edición del maestro/variantes, varias versiones y revisión de atributos. Los E2E usan el frontend aislado y dobles locales; las integraciones anteriores ejercitan los servicios Firebase reales en emuladores.
- Regresiones ejecutadas de Clientes, wizard de prendas/objetos y navegación de Automation. Los resultados finales y el despliegue se registran en el informe de verificación.

El host tiene Node 25.8.1; el runtime configurado para Functions permanece Node 22. Para ejecutar la suite aislada se copió a `/tmp` la guardia de red del repositorio quitando únicamente su aserción de versión Node 22. Se mantuvieron las comprobaciones de proyecto demo/hosts loopback y el bloqueo de red externa. No se cambiaron dependencias, lockfiles, runtime ni secretos.

Las pruebas históricas de `catalog-subscriptions.spec.ts` fallaban también en una copia limpia de `df1587e` (seis de ocho), al igual que el spec del panel de drafts. La causa estaba en los dobles del navegador: identidad de appUser inestable y callbacks iniciales que se entregaban después de cancelar la suscripción. Se corrigió el harness para reproducir la identidad estable y cancelación reales de Firebase, y se ajustó la instrumentación al listener interno de autorización actual. Se conservaron las expectativas de datos, errores y descarte de notificaciones tardías. Ambos specs pasan ahora sin modificar el código de autenticación o de suscripciones del producto.

## Operación pendiente del administrador

Habilitar los canales deseados por cliente, asociar los templates heredados tras revisión, cargar los oficiales de los otros marketplaces y confirmar campos/categorías/operación. Completar datos comerciales y exenciones verificadas externamente; alojar las imágenes aprobadas si la plataforma necesita URLs públicas; efectuar una subida de prueba en cada marketplace con su plantilla oficial. Los requisitos desconocidos o formatos bloqueados necesitan ampliar el adaptador, no introducir valores de relleno.

## Resultado de las verificaciones y despliegue

Última verificación completa de esta implementación: **383 pruebas aprobadas, cero fallos y cero omisiones**, con Auth/Firestore/Storage locales y los originales reales disponibles. **38 E2E aprobados** de multicanal, Clientes, wizard y navegación de Automation, más **4 pruebas del aislamiento del navegador**. Incluyen seis E2E nuevos; no se usaron estas pruebas de interfaz con dobles como certificación de formatos oficiales.

Los fallos históricos de navegador se reprodujeron en `df1587e` y quedaron resueltos corrigiendo los dobles, no la lógica de autenticación de producción. La ejecución final de 38 E2E incluye Catálogo, suscripciones y panel de drafts. Los resultados de ejecuciones intermedias y trazas se guardaron fuera del repositorio.

Proyecto de despliegue: `tutofb-260320-1003`, región `us-central1`, runtime Node 22. Se despliegan únicamente las doce funciones afectadas, sin actualizar los workers de imágenes:

| Función | Cambio |
| --- | --- |
| `previewMarketplaceExports` | Nueva: consulta/prevalidación sin artefactos |
| `downloadMarketplaceExports` | Nueva: descarga XLSX/ZIP explícita |
| `saveMasterProduct` | Nueva: edición con revisión esperada |
| `configureMarketplaceTemplate` | Nueva: activación de versiones/asociación aditiva |
| `archiveMarketplaceTemplate` | Nueva: archivo sin borrado |
| `cleanupMarketplaceExportsOnSchedule` | Nueva: limpieza horaria acotada |
| `importClientSpreadsheetTemplate` | Análisis por canal y copia inmutable |
| `deleteClientSpreadsheetTemplate` | Protección de versiones multicanal |
| `exportBatchSpreadsheet` | Conservación del XLSX heredado |
| `editBatchSpreadsheet` | Reutiliza la exportación conservadora existente |
| `previewProductDrafts` | Compatibilidad del helper de validaciones compartido |
| `manglarMcp` | Consumidor de las operaciones heredadas actualizadas |

Las doce funciones se desplegaron y verificaron en estado `ACTIVE`. Reglas Firestore/Storage publicadas; sin cambios de índices, proyecto o targets. Hosting: [Tuto](https://tutofb-260320-1003.web.app). La guardia de despliegue verificó acceso del service agent de Storage a Firestore y CORS antes de publicar reglas. El [informe JSON de verificación](reports/2026-11-09-multichannel-export-verification.json) registra el estado final del despliegue, pruebas HTTP y correspondencia de los assets publicados con el build local. Los cinco callables nuevos con acceso de usuario rechazan solicitudes sin autenticación con `401 UNAUTHENTICATED`. No se ejecutó una exportación autenticada con datos de producción; sus casos funcionales se verificaron en emuladores.
