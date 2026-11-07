# Correcciones técnicas de Clientes y autorización

Fecha de verificación: 7 de noviembre de 2026. Base inspeccionada: `main`, `dca45371ef510c3dea0b2146f09e5a8cbee3b715`. El árbol estaba limpio al comenzar. No se hicieron commits ni push.

## Hallazgos y solución

- **Tokens antiguos:** Functions ya leía el usuario actual. Firestore priorizaba el claim de rol, Storage usaba claims y permitía lectura pública de resultados, y AuthProvider superponía el claim al documento. Se eliminaron esas autoridades antiguas y se verificaron tokens reales anteriores a degradación, desactivación, archivo y eliminación del documento de usuario.
- **Alcance humano:** no existía un modelo de asignaciones para sesiones web. `manglarAccess` corresponde a delegación y se conserva separado. Se añadió `users/{uid}.clientAccess`, compartido entre frontend, Functions y reglas.
- **Sobrescrituras:** marketplaces y datos generales verifican los valores esperados dentro de sus transacciones. Solo se comparan y envían campos editados; campos independientes se fusionan. La omisión de expectativas al editar se rechaza. El formulario muestra el estado remoto y permite revisar/conservar el borrador o usar el remoto. Conservar el borrador mantiene solo las ediciones propias y adopta campos remotos no editados.
- **Borradores:** claves v2 por proyecto, UID, cliente y sección en `sessionStorage`. Se ignoran registros antiguos o inválidos. Al cerrar sesión o cambiar de identidad se retiran los borradores de la identidad anterior y se reinicia el estado en memoria. Guardar/descartar una sección no elimina otras.
- **Productos y consultas:** la ficha utiliza el catálogo existente, con cliente fijado, paginación, acciones y estados propios. Los modelos se consultan por cliente. La lista de Clientes devuelve como máximo 20 filas desde un callable, mantiene filtros y búsqueda por subcadena y usa cursores Firestore internamente para reconstruir páginas numéricas de URL.
- **Fixtures:** la suite avanzada deja de compartir el documento global de configuración de otras suites. Las bases de prueba propias se limpian; la suite de automatización que utiliza la base por defecto restaura su configuración. El runner fija proyecto demo, exige Node 22 y bloquea tráfico externo.

## Modelo de permisos

| Identidad | Acceso humano a clientes |
| --- | --- |
| Administrador activo y no archivado | Global por su rol vigente |
| Operador/revisor con `{mode: 'global'}` | Global explícito, respetando las acciones permitidas por su rol |
| Operador/revisor con `{mode: 'assigned', clientIds: [...]}` | Exclusivamente esos clientes |
| Alcance ausente, inválido o lista vacía | Ningún cliente; nunca se convierte implícitamente en global |
| Usuario desactivado, archivado o sin documento | Sin operaciones de negocio |
| Principal de automatización | Mantiene su autenticación, scopes, clientes y tipos autorizados independientes |
| Conexión delegada | Intersección de alcance humano y delegado, además de scopes y restricciones previas de propietario; una concesión o caller anterior se rechaza cuando excede el alcance vigente |

Los controles cubren clientes, modelos, plantillas/categorías, lotes, productDrafts, jobs, outputs/logs, imágenes y archivos; también descargas, planes y operaciones relacionadas. Un `clientId` permitido no autoriza un `jobId`, modelo o plan de otro cliente. Las métricas globales requieren alcance global. El Organizador conserva sus operadores, carpetas y demás restricciones previas.

El panel de Usuarios permite guardar alcance global o clientes seleccionados con control de concurrencia. Las cuentas nuevas tienen asignaciones vacías por defecto; cambiar rol/estado conserva asignaciones existentes.

## Compatibilidad, contratos y datos

Se añadieron `ListClientsRequest/Response`, `SetUserClientAccessRequest/Response`, expectativas de campos y valores canónicos guardados. Actualizar un cliente o marketplace con un consumidor antiguo que omita expectativas falla de forma segura: debe recargar/actualizar el consumidor. Fuentes y Automatizaciones conservan `expectedAutomation` y guardado por sección.

No se cambiaron IDs de proveedores, estados, roles, formatos de rutas ni horarios. No se añadieron dependencias, servicios externos de búsqueda, conexiones OAuth de marketplaces ni publicaciones. No se escribieron fixtures en producción ni se modificaron originales de Drive.

La lectura de usuarios de producción encontró **dos documentos, ambos administradores activos**, en `(default)`. No se requiere migrar asignaciones para esos usuarios y no se modificaron sus documentos. Por tanto, no se ejecutó ninguna migración ni se necesitó un respaldo para migrar datos. Si posteriormente se encuentran operadores/revisores históricos sin alcance, hace falta un inventario explícito por UID, revisión del alcance y respaldo recuperable antes de aplicar un plan; no deducir clientes a partir de productos/lotes ni conceder global automáticamente.

## Límites y compromisos explícitos

- La búsqueda mantiene subcadena mediante un recorrido paginado en el servidor. Cada lectura consulta como máximo 20 documentos y cada respuesta devuelve como máximo 20 clientes. Buscar coincidencias raras o abrir páginas altas puede requerir más lecturas; no es un índice de texto. No necesita backfill ni altera nombres. Si el volumen lo justifica, un índice derivado debe tener su propia estrategia de compatibilidad y respaldo.
- Storage solo puede consultar documentos de la base Firestore por defecto. La publicación se verifica contra la base configurada y se bloquea si se cambia a una base con nombre: no se introduce fallback a claims ni se afirma soporte inexistente. Functions sigue usando `getAppFirestore()`; las pruebas incluyen la base de usuarios con nombre. Referencia: [condiciones de reglas de Storage](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore).
- `publicGeneratedImage` conserva su ruta, pero ahora requiere bearer token y devuelve `private, no-store`. El frontend resuelve blobs autenticados. Integraciones que utilizaban esa ruta como URL anónima deben usar descargas autenticadas o el mecanismo de enlaces firmados con caducidad que corresponda.
- Los enlaces firmados ya emitidos conservan su vigencia hasta caducar. Tokens de descarga de Storage y copias o cachés previamente recibidas no se revocan retroactivamente con reglas. No se hizo una revocación masiva ni modificación de metadatos de archivos; requiere inventario y un cambio separado si se necesita invalidarlos. El bucket ya tenía CORS para los orígenes de la aplicación; no se cambió su configuración.
- Historial sigue mostrando un estado vacío honesto.

## Verificación

Entorno: Node **22.22.0**, proyecto **demo-manglar-automation**, Auth/Firestore/Storage locales, proveedores y Drive simulados. No se arrancó el emulador de Functions ni triggers de automatización. El guard bloquea conexiones externas, incluidos intentos del SDK de consultar metadata de infraestructura.

- `npm run lint`: aprobado.
- `npm --prefix functions run lint`: aprobado.
- `npm --prefix functions run build`: aprobado antes de pruebas que importan `functions/lib`.
- `npm run build`: aprobado.
- `npm run test:emulators` (ejecuta `npm test` con el guard): **361 aprobadas, 0 fallos, 0 omitidas**.
- Refuerzo final de `clientSecurity.integration.test.ts`: **6 aprobadas, 0 fallos, 0 omitidas**, con consultas acotadas, acceso legítimo a A y rechazo de B.
- Playwright: `clients-redesign.spec.ts`, `client-identity-products.spec.ts`, `catalog-check.spec.ts`: **12 aprobadas**. Incluyen 45 clientes, URL/recarga, archivo/restauración, borradores, AuthProvider real con Firebase simulado, conflictos y catálogo incrustado.
- Esquemas: `node scripts/generate-manglar-schemas.mjs --only=ManglarClientSaveRequest,UpdateClientMarketplaceRequest,ListClientsRequest,SetUserClientAccessRequest --check`: aprobado.

No se ejecutó el resto de los specs de Playwright ni pruebas de conectores reales/servicios de pago. No se hicieron escrituras de prueba en producción.

## Despliegue

Publicado y verificado en `tutofb-260320-1003`, base `(default)`:

| Componente | Estado comprobado |
| --- | --- |
| Firestore y Storage | Reglas activas comparadas por contenido con los archivos locales |
| Índices | 48 en estado `READY` (39 existentes + 9 añadidos) |
| Functions | 97 en estado `ACTIVE`, runtime Node 22; las 95 anteriores se conservan y se añadieron `listClients` y `setUserClientAccess` |
| Hosting | Publicado; HTML y 11 assets referenciados coinciden byte a byte con el build local |
| Acceso anónimo remoto | `listClients`, `saveClient` e imágenes: 401; Firestore y un archivo generado existente en Storage: 403 |

El límite temporal 429 durante el despliegue final se resolvió con los reintentos de Firebase; no quedan revisiones pendientes. No se modificaron expresiones cron ni configuración de horarios. Los controles con tokens anteriores a cambios de usuario se probaron en emuladores; no se degradaron cuentas reales ni se crearon fixtures en producción. Evidencia resumida y hashes de assets: [CLIENTS_VERIFICATION.json](CLIENTS_VERIFICATION.json).

## Archivos modificados

| Archivo | Motivo |
| --- | --- |
| `.firebase/hosting.ZGlzdA.cache` | Pruebas y verificación de autorización y Clientes. |
| `docs/CLIENTS_TECHNICAL_FIXES.md` | Informe técnico, compatibilidad, pruebas, límites y estado de despliegue. |
| `docs/CLIENTS_VERIFICATION.json` | Evidencia resumida de despliegues y comprobaciones remotas, sin tokens ni secretos. |
| `e2e/client-identity-products.spec.ts` | Regresiones de interfaz, identidad, conflictos y catálogo; dobles locales sin acceso externo. |
| `e2e/clients-redesign.spec.ts` | Regresiones de interfaz, identidad, conflictos y catálogo; dobles locales sin acceso externo. |
| `e2e/support/isolated-browser.mjs` | Regresiones de interfaz, identidad, conflictos y catálogo; dobles locales sin acceso externo. |
| `e2e/support/local-fixtures.mjs` | Regresiones de interfaz, identidad, conflictos y catálogo; dobles locales sin acceso externo. |
| `firestore.indexes.json` | Índices adicionales para consultas restringidas por cliente; conserva los existentes. |
| `firestore.rules` | Rol y estado vigentes; alcance por cliente y padres; datos generales solo por callable transaccional. |
| `functions/src/admin/getSystemHealth.ts` | Las métricas globales requieren alcance global. |
| `functions/src/auth/clientAccess.ts` | Autoriza con el usuario actual y resuelve de forma independiente cada recurso referenciado. |
| `functions/src/auth/roles.ts` | Autoriza con el usuario actual y resuelve de forma independiente cada recurso referenciado. |
| `functions/src/automation/api.ts` | Alcance humano en solicitudes, planes, resultados y Drive, conservando el camino independiente de máquinas. |
| `functions/src/automation/mcp.ts` | Revalida también callers delegados ya capturados frente al alcance humano actual. |
| `functions/src/automation/mcpOAuth.ts` | Invalida concesiones antiguas que exceden el alcance humano vigente, sin mezclar principals de máquinas. |
| `functions/src/automation/persistence.ts` | Alcance humano en solicitudes, planes, resultados y Drive, conservando el camino independiente de máquinas. |
| `functions/src/automation/plans.ts` | Alcance humano en solicitudes, planes, resultados y Drive, conservando el camino independiente de máquinas. |
| `functions/src/automation/queries.ts` | Alcance humano en solicitudes, planes, resultados y Drive, conservando el camino independiente de máquinas. |
| `functions/src/automation/recovery.ts` | Alcance humano en solicitudes, planes, resultados y Drive, conservando el camino independiente de máquinas. |
| `functions/src/callables/listClients.ts` | Consulta paginada con cursores nativos, hasta 20 resultados y búsqueda por subcadena compatible. |
| `functions/src/callables/setUserClientAccess.ts` | Administración explícita y transaccional de asignaciones, con comparación del alcance previo. |
| `functions/src/callables/updateClientMarketplace.ts` | Verifica dentro de la transacción los valores esperados de cada campo editado. |
| `functions/src/callables/userManagement.helpers.ts` | Las nuevas cuentas nacen sin clientes asignados; conserva el alcance al editar usuarios existentes. |
| `functions/src/http/downloadBatchZip.ts` | Descargas e imágenes comprueban alcance actual antes de servir bytes; la ruta de imágenes exige autenticación. |
| `functions/src/http/downloadJobImage.ts` | Descargas e imágenes comprueban alcance actual antes de servir bytes; la ruta de imágenes exige autenticación. |
| `functions/src/http/downloadSelectedJobsZip.ts` | Descargas e imágenes comprueban alcance actual antes de servir bytes; la ruta de imágenes exige autenticación. |
| `functions/src/http/publicGeneratedImage.ts` | Descargas e imágenes comprueban alcance actual antes de servir bytes; la ruta de imágenes exige autenticación. |
| `functions/src/index.ts` | Exporta los dos nuevos callables, sin retirar endpoints. |
| `functions/src/manglar/access.ts` | Intersección de acceso humano y delegado, manteniendo restricciones adicionales de conexión/propietario. |
| `functions/src/manglar/catalogService.ts` | CAS de nombre/prompt, respuesta canónica y alcance de las operaciones de productos. |
| `functions/src/manglar/contracts.json` | Esquemas de los cuatro contratos afectados, conservando contratos ajenos a esta corrección. |
| `functions/src/manglar/operations.ts` | Comprueba el alcance vigente en cada operación delegada, incluso en lecturas y callers capturados. |
| `functions/src/organizer/api.ts` | Añade alcance humano a los permisos previos del Organizador y restringe su consulta de clientes. |
| `package.json` | Comando test:emulators reproducible, sin cambios de dependencias. |
| `scripts/generate-manglar-schemas.mjs` | Ejecución aislada, bloqueo de red externa, guardia de publicación y regeneración acotada de contratos. |
| `scripts/run-emulator-tests.mjs` | Ejecución aislada, bloqueo de red externa, guardia de publicación y regeneración acotada de contratos. |
| `scripts/test-emulator-guard.mjs` | Ejecución aislada, bloqueo de red externa, guardia de publicación y regeneración acotada de contratos. |
| `scripts/verify-client-release.mjs` | Ejecución aislada, bloqueo de red externa, guardia de publicación y regeneración acotada de contratos. |
| `shared/src/clientAccess.ts` | Semántica única del alcance humano: admin/global explícito/asignados; ausencia equivale a ningún cliente. |
| `shared/src/fieldConcurrency.ts` | Patches de campos editados y detección de conflictos. |
| `shared/src/types/client.ts` | Contratos de alcance, expectativas de concurrencia, valores guardados y paginación. |
| `shared/src/types/manglar.ts` | Contratos de alcance, expectativas de concurrencia, valores guardados y paginación. |
| `shared/src/types/marketplace.ts` | Contratos de alcance, expectativas de concurrencia, valores guardados y paginación. |
| `shared/src/types/user.ts` | Contratos de alcance, expectativas de concurrencia, valores guardados y paginación. |
| `src/app/AppRouter.tsx` | La cuenta archivada no conserva acceso a rutas autenticadas. |
| `src/components/clients/ClientSettings.tsx` | Envío de campos editados, conservación y revisión explícita de conflictos sin perder borradores. |
| `src/components/users/UserClientAccess.tsx` | Editor administrativo del alcance humano por usuario, independiente de conexiones delegadas. |
| `src/components/users/UserListItem.tsx` | Editor administrativo del alcance humano por usuario, independiente de conexiones delegadas. |
| `src/features/auth/AuthProvider.tsx` | El documento actual determina capacidades; reinicia suscripciones y limpia borradores/caché al salir o cambiar de cuenta. |
| `src/features/auth/scopedQuery.ts` | Añade filtros de cliente a consultas antes de descargar datos y actualiza suscripciones al cambiar permisos. |
| `src/features/automation/firebase.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/automation/useClientAutomationConfig.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/catalog/firebase.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/catalog/useCatalogJobs.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/clients/draftStorage.ts` | Lista remota paginada, guardados condicionados y borradores aislados por identidad/proyecto/sección. |
| `src/features/clients/firebase.ts` | Lista remota paginada, guardados condicionados y borradores aislados por identidad/proyecto/sección. |
| `src/features/clients/useClientDraft.ts` | Lista remota paginada, guardados condicionados y borradores aislados por identidad/proyecto/sección. |
| `src/features/clients/useClientManagement.ts` | Lista remota paginada, guardados condicionados y borradores aislados por identidad/proyecto/sección. |
| `src/features/clients/useClientSettings.ts` | Lista remota paginada, guardados condicionados y borradores aislados por identidad/proyecto/sección. |
| `src/features/dashboard/firebase.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/marketplaces/ClientMarketplaces.tsx` | Envío de campos editados, conservación y revisión explícita de conflictos sin perder borradores. |
| `src/features/marketplaces/useClientMarketplace.ts` | Envío de campos editados, conservación y revisión explícita de conflictos sin perder borradores. |
| `src/features/models/firebase.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/notifications/useNotifications.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/queue/firebase.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/search/useGlobalSearch.ts` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/features/storage/assets.ts` | Carga autenticada de blobs y caché separada/limpiada por identidad, manteniendo el resolvedor central. |
| `src/features/storage/useStorageAssetUrl.ts` | Carga autenticada de blobs y caché separada/limpiada por identidad, manteniendo el resolvedor central. |
| `src/pages/Catalogo.tsx` | Reutiliza el catálogo dentro de Productos con cliente inmutable y selección propia de lote. |
| `src/pages/ClientDetail.tsx` | Reutiliza el catálogo dentro de Productos con cliente inmutable y selección propia de lote. |
| `src/pages/Clients.tsx` | Paginas remotas, filtros y navegación URL; evita que respuestas anteriores restablezcan la página. |
| `src/pages/Dashboard.tsx` | Ajusta consultas/capacidades al alcance del usuario; evita lecturas globales o de otros clientes. |
| `src/pages/Login.tsx` | La cuenta archivada no conserva acceso a rutas autenticadas. |
| `storage.rules` | Consulta el usuario vigente en Firestore y protege archivos por cliente, incluido el cliente actual del modelo. |
| `tests/approvedTryOnPrompt.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/authRoles.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/automation.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/automationAdvanced.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/catalogDeletion.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/clientDraft.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/clientMarketplace.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/clientMarketplace.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/clientSecurity.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/driveBackups.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/manglarExpanded.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/manglarMcp.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/manglarModelPersistence.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/modelPoseActivation.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/organizer.integration.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/organizerAutomation.test.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
| `tests/support/cleanupEmulator.ts` | Pruebas reales con emuladores o fixtures con alcance explícito; aislamiento y limpieza. |
