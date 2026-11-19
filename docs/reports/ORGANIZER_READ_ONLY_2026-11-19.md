El Organizador quedó desplegado con Drive de solo lectura en `tutofb-260320-1003`. La prueba real terminó el 19 de noviembre de 2026: una fotografía nueva produjo un lote con seis imágenes completadas y cero fallos.

`classify` y `sync` se conservan por compatibilidad, con el mismo recorrido: inventario → catálogo → visión → automatización → reporte. `generate` también consume originales. La simulación continúa sin llamadas de IA ni generación, y las ejecuciones manuales completas de clasificación/sincronización conservan la simulación y la confirmación exacta de presupuesto.

Los campos antiguos de destino en Firestore se ignoran. No se borraron carpetas, copias, manifiestos ni datos históricos. Las fases antiguas `copy` y `organize` se saltan al reanudar una ejecución anterior; ninguna ejecución nueva entra en ellas.

| Archivo | Cambio de esta tarea |
| --- | --- |
| `functions/src/organizer/drive.ts` | Cliente exclusivamente GET. Eliminados `zone`, `root`, `managed`, `folder`, `copy`, `verifyCopy`, `moveCopy`, `report`, `destinationGuard`, reconciliación e intentos de escrituras. Verificación de pertenencia, versión y hashes; descarga original con comprobación SHA-256/MD5. |
| `functions/src/google/drive.ts` | El token del Organizador siempre pide `drive.readonly`. Se conservan las funciones de escritura de otros dominios, que tienen consumidores propios. |
| `functions/src/organizer/store.ts` | Sin requisito de `parentId` ni `createAttemptRecorder`/`driveAttempts`. Presupuestos, autorización y leases conservados. |
| `functions/src/organizer/worker.ts` | Originales para inventario y visión; retiradas las fases de copia/movimiento. Reportes privados JSON/XLSX en Storage, estados y `sourceFiles` en Firestore. |
| `functions/src/organizer/source.ts` | Nuevo helper común: verifica el original y guarda el JPEG normalizado en la ruta existente `garments/drafts/{uid}/organizer-{digest}/source/image.jpg`, con `ifGenerationMatch: 0` para impedir sobreescrituras. |
| `functions/src/organizer/reports.ts` | Enlaces firmados de una hora, restringidos al cliente/ejecución y con descarga como adjunto. |
| `functions/src/organizer/automation.ts` | Todas las ejecuciones importan originales con el helper común; eliminadas dependencias de copias/manifest. Respeta `autoRun` por cliente y las desactivaciones explícitas. |
| `functions/src/organizer/api.ts` | Configuración sin destino, nombre ni directorios de salida. Borrador y miniatura verifican originales. Referencias ya no exigen `copyUrl`. Descargas mediante callable autorizado. |
| `functions/src/organizer/baseCodeVision.ts` | Elección cerrada de variantes desde originales, con verificación antes y después de leer. Sin condición de existencia de copia. |
| `functions/src/organizer/productWorkflow.ts` | La ficha enlaza al original. |
| `functions/src/organizer/planning.ts` | Vista previa de lecturas y relaciones de catálogo, sin destinos de Drive. |
| `functions/src/organizer/watch.ts` | Observación de originales sin carpeta contenedora. El scheduler conserva el control global del vigilante. Una invocación explícita de operador puede solicitar una comprobación inmediata del cliente, sin cambiar globales. |
| `functions/src/automation/clientConfig.ts` | Valida y persiste `organizerGeneration.autoRun`. |
| `shared/src/types/automation.ts`, `shared/src/automationConfig.ts` | Contrato y resolución compartida del nuevo interruptor. `autoRun: true` habilita generación con el global apagado; `automation.enabled: false` u `organizerGeneration.enabled: false` siguen impidiéndola. |
| `shared/src/types/organizer.ts` | Configuración antigua de destino opcional/deprecada; plan de lectura. Se conservan fases históricas para compatibilidad. |
| `src/pages/Organizador.tsx`, `src/features/organizer/useOrganizer.ts` | Retirados campos, enlaces y textos de copias/carpetas de salida. Descargas con enlaces firmados renovados al pulsar; catálogo pendiente/revisar/subido conservado. |
| `src/components/clients/ClientAutomationSection.tsx`, `src/features/clients/draftStorage.ts` | Interruptor por cliente y persistencia del borrador de configuración. |
| `tests/organizer.test.ts`, `tests/organizerHybrid.test.ts` | Contrato de lectura, pertenencia, versiones/checksums y vista previa sin destinos. |
| `tests/organizer.integration.test.ts` | Transporte de Drive que falla ante cualquier método distinto de GET; ejecución automática sin `parentId`, con `autoRun` y global de generación apagado; ausencia de manifiestos/intentos. |
| `tests/organizerAutomation.test.ts`, `tests/automationConfig.test.ts` | Automatización desde originales, interruptores y reintentos/idempotencia. |
| `tests/organizerSource.test.ts` | JPEG inmutable, revalidación al reutilizarlo y límites de los enlaces firmados. |
| `ARCHITECTURE.md` | Frontera Drive/Storage y nueva resolución por cliente actualizadas. |

Se preservó el trabajo previo de «código base»: asociación, concordancia visual, selección/aprobación de referencias y vinculación al catálogo maestro. Solo se adaptó su lectura de imágenes en `baseCodeVision.ts`, las fases en `worker.ts`, el acceso a referencias en `automation.ts` y el borrador en `api.ts`. No se editaron `baseCode.ts`, `catalog/organizerBinding.ts` ni su política de vinculación. Los cambios previos de agrupación por actualización y enlaces comerciales permanecen en el árbol desplegado.

Verificación local:

- `npm run lint`: correcto.
- `npm --prefix functions run lint`: correcto.
- `npm --prefix functions run build`: correcto.
- `npm run build`: correcto; Vite mantiene advertencias existentes de imports `default` en `commercialPhoto.ts` y `dateUtils.ts`.
- `npm test`: 456 pruebas, 422 aprobadas, 34 omitidas por requerir emuladores; cero fallos.
- Integración en emuladores de `organizer.integration`, `organizerAutomation` y `organizerBinding`: 29 aprobadas, cero fallos. Incluye una ejecución creada por `watcher`, sin `parentId`, que llega a automatización con el global de generación apagado.
- Pruebas específicas adicionales de fuente y Drive: 9 aprobadas, incluidas inmutabilidad y descarga de bytes con checksum incorrecto.
- Una ampliación de integración con seguridad de clientes y exportación SHEIN obtuvo 36 aprobadas y un fallo ajeno al cambio: el fixture sintético de `organizerMarketplace.integration.test.ts` incluye `xl/metadata.xml`, que la validación de plantilla oficial rechaza. Al retirar ese metadato solo en un ensayo temporal, también apareció una incompatibilidad previa del fixture de autofill (`TypeError`, material requerido). No se modificó ese test ni la lógica de exportación como parte de esta tarea.
- Los emuladores usaron proyecto `demo-manglar-automation` y el guard de red local existente, con una copia temporal que solo omite la exigencia de Node 22, porque el ejecutable instalado es Node 25. Las suites automatizadas de integración usaron solo emuladores; la comprobación real descrita más abajo sí usó el proyecto de producción.

Antes del deploy se inspeccionó `git status --short` y se avisó que el árbol compartido incluye trabajo sin commit de otras sesiones. El deploy subió el árbol disponible y actualizó exclusivamente:

- `organizerAction`
- `organizerManualRun`
- `organizerRunContinuation`
- `organizerScheduler`
- `organizerContinuation`
- `updateClientAutomation`
- Hosting: [Tuto](https://tutofb-260320-1003.web.app)

Las seis funciones y Hosting terminaron correctamente. Las funciones seleccionadas incluyen dependencias previas de código base, catálogo y automatización. Hosting incorpora también el estado actual sin commit de clientes/contactos, correo, plantillas/exportación a marketplaces, wizard y ajustes. No se desplegaron los endpoints de correo ni otros workers. No se cambiaron reglas, índices, dependencias, secretos ni configuración global, y no se hicieron commits.

La prueba real se realizó únicamente con `automation-e2e-test`, origen `11Dr9ihE1VCQz7fwI63vZvTFz7JprTqXq`. Se confirmó por lectura que tanto este organizador como `5RPUrQKfkERh4josuuvX` tenían `parentId: ""`. La carpeta declara a `tutofb-260320-1003@appspot.gserviceaccount.com` como `reader`.

Se activaron `automation.organizerGeneration.autoRun: true`, la vigilancia de ese organizador y su hoja de control descargable. No se modificó el otro cliente. `organizerWatcherEnabled` y `organizerAutoGenerationEnabled` permanecieron en `false`. Por autorización explícita del usuario se invocó una comprobación inmediata del mismo helper `watch`, con el actor administrador existente; el procesamiento ocurrió en la función desplegada. No se ejecutó `gcloud scheduler jobs run`. La ejecución real lleva al operador como `createdBy`; el caso automático con `createdBy: watcher` quedó cubierto en emuladores. La vigilancia programada seguirá detenida mientras su global permanezca apagado.

Datos preparados mediante el conector del usuario, antes de iniciar el Organizador:

- Foto nueva `1NknXAaO0fw1R57xBYxREh9djjdzhsH0s`, `AT-V02-BLA-RO1911.jpg`, en la carpeta `VASOS`. Se subió la imagen de referencia existente de la taza como un archivo de prueba nuevo, con identificación explícita.
- El conector rechazó modificar `CATALOGO AUTOMATION.xlsx` (`appNotAuthorizedToFile`). Se conservó el libro original y se agregó `LECTURA-TEST.xlsx`, ID `1hNLD618LNZEJnIGl4HZ_Bwu1HMlvtA8F`, con una fila para SKU `AT-V02-BLA-RO1911`, SPU `AT-V02` y SKC `AT-V02-BLA`, manteniendo los datos de la taza existente. El conector verificó la fila después de subirla.

Resultado real:

| Evidencia | Resultado |
| --- | --- |
| Ejecución | `74f2bb1110288c3ad1599093533f22d3561c9cdc6ca302ed2082a6e8df11de24`, `completed` |
| Automatización | `nK8nbgRXfbOTjKUUit3k`, `completed` |
| Lote | `automation-nK8nbgRXfbOTjKUUit3k`, `completed` |
| Artículos/fotos nuevas enviadas | 1 artículo, 1 foto, 1 automatización |
| Generación | 6 imágenes completadas, 0 fallidas; `fal-gpt-image-2.5-flare` |
| Inventario | 41 entradas: 12 carpetas, 27 fotos, 2 Excel |
| Gemini del Organizador | USD 0.020594, presupuesto USD 2; no incluye el costo de generación del lote |
| JPEG inmutable | `image/jpeg`, 162867 bytes; generación de Storage `1795055448992235` |
| Copias/intentos en Drive | `manifest: 0`, `driveAttempts: 0` |
| Callable de reporte desplegado | HTTP 200 con usuario autenticado |
| JSON firmado | HTTP 200, 147763 bytes |
| XLSX firmado | HTTP 200, 40952 bytes; pestañas Resumen, Productos, Fotografías |

El listado antes de preparar el caso tenía 39 entradas. Las dos altas fueron operaciones explícitas del conector del usuario. Al comparar los listados inmediatamente antes y después del Organizador quedaron las mismas 41 entradas: ninguna alta, baja, renombrado, movimiento, cambio de contenido, tamaño, checksum o fecha de modificación. Drive devolvió una diferencia de metadatos en la foto recién subida: `version` de `1` a `2`, sin ningún otro campo de contenido o ubicación modificado. Se registra esa diferencia; no se atribuye una causa a ese cambio interno de Drive. La cuenta utilizada solo tenía permiso `reader` y el cliente de API del Organizador solo emite GET con scope de lectura.

Los listados completos y la evidencia estructurada, sin credenciales ni URLs firmadas, se guardaron junto a este informe:

- [Listado anterior](organizer-readonly-2026-11-19/drive-before.json)
- [Listado posterior](organizer-readonly-2026-11-19/drive-after.json)
- [IDs, resultados, configuración y comprobación del JPEG/reportes](organizer-readonly-2026-11-19/evidence.json)
