# Autorización humana vigente — 6 de noviembre de 2026

La autoridad de las operaciones privilegiadas humanas pasa a ser `users/{uid}` en `getAppFirestore()`, después de la corrección de selección de base de `09390a1`. Un claim de rol, aunque esté firmado y diga `admin`, no concede permisos si el documento falta, tiene `active !== true`, está archivado o contiene otro rol. Solo se aceptan `admin`, `operador` y `revisor`. Se conserva la firma de los helpers y sus códigos de error.

## Caracterización previa de consumidores

| Helper / frontera | Quién lo llama | Decisión que le corresponde |
| --- | --- | --- |
| `getUserRole` | Únicamente los otros helpers de `auth/roles.ts` | Resolver el rol humano actual; antes retornaba inmediatamente un claim reconocido y omitía existencia, actividad y archivo. |
| `getRequestRole` | `assertCallableRoles` y `syncUserClaims` | Identidad de Firebase ya verificada por el transporte; consultar el usuario actual. No autentica máquinas. |
| `assertCallableRoles` | Entradas callable de generación, catálogo, spreadsheets, usuarios, finanzas, sistema, Automation, consentimiento/conexiones MCP, Organizador y Respaldos; también sus invocaciones internas desde el registro MCP | Ausencia de `request.auth`: `unauthenticated`. Usuario no disponible/rol insuficiente: `permission-denied`. En delegación: comprobar UID y ejecutar `authorize(request.data)` antes de aceptar el rol vigente. |
| `assertUserRoles` | Cuatro descargas HTTP tras `verifyIdToken`; rama humana de `authenticateAutomation`; rama humana del worker de Automation; handoff humano del Organizador; servicios de catálogo Manglar; administrador propietario de grants MCP heredados | Autorizar un UID humano explícito con documento actual. El argumento de claim se conserva por compatibilidad pero se ignora. |
| `manglar/context.ts` | Ejecución delegada, producción delegada del Organizador y contexto de presupuesto del worker | `AsyncLocalStorage` transporta caller, autorización y presupuesto durante una ejecución. Un contexto solo de presupuesto no crea un caller humano. No se añade caché de autorización. |
| `manglar/access.ts` | Verificación de grants individuales, operaciones MCP y comprobación de stamps de producción | Ya exigía humano activo y rol vigente; conserva versión de acceso, ámbitos de cliente, propiedad del operador y estado del grant. No se modifica su política de Storage. |

`syncUserClaims` distingue privilegio administrativo y recuperación propia: un humano inactivo/degradado no puede sincronizar o elevar a otro usuario. Se conserva la sincronización de sus propios claims desde su documento, incluida la propagación de `active:false`; no es una concesión de privilegios. Un documento propio ausente sigue produciendo `not-found` en esa recuperación.

Las cuatro rutas HTTP son `downloadModelBundle` (admin), `downloadJobImage`, `downloadBatchZip` y `downloadSelectedJobsZip` (admin/operador/revisor). Se conserva verificación de token y traducción 401/403; un revisor degradado desde admin puede seguir usando sus descargas permitidas, pero no exportar un modelo. No se amplían sus políticas de recursos.

Automation distingue antes de consultar usuarios:

- Firebase ID token: verificación existente con revocación y `assertUserRoles`; solo admin/operador.
- `manglar_at_…`: `verifyMachineToken`, principal técnico, scopes y clientes propios; no requiere documento `users` ni usa los helpers humanos.
- Worker invocado por Eventarc/IAM: para jobs técnicos usa `automationPrincipalId`, UID técnico coherente y `authorizeMachineJob`; para jobs humanos revalida al responsable. Scheduler/Eventarc no se convierten en sesiones humanas.
- MCP individual: grant `user-v1`, humano vigente, scopes, accessVersion y clientes; MCP heredado conserva su ruta técnica y la comprobación del administrador propietario.

## Cambios y lecturas

No se cambian roles, formatos de token, verificación criptográfica, autenticación técnica, IAM declarado, reglas, índices ni rutas de Storage. `authorize(request.data)`, UID delegado, scopes, propietarios y restricciones por cliente permanecen en sus fronteras existentes.

| Entrada humana | Lecturas de autorización de `users` antes, con claim reconocido | Después |
| --- | ---: | ---: |
| Helper privilegiado directo / descarga HTTP | 0 | 1 |
| Helper callable delegado (además del callback de autorización) | 1 | 1 |
| Callable Automation (seis entradas) | 2 | 1 |
| HTTP Automation | 2 | 1 |
| Listar/revocar conexiones MCP | 1 | 1 |
| `organizerAction`, `manageDriveBackup`, `agentDriveWorkspace` | 1 | 1 |

Sin claim reconocido, los callables de Automation antes hacían tres lecturas. Se reutiliza el rol devuelto por la decisión en las entradas anteriores; no se memoizan usuarios, roles ni permisos entre peticiones, ni siquiera si se reutiliza el objeto de request. Las lecturas adicionales para nombres de auditoría, documentos objetivo, grants y permisos por cliente cumplen otras funciones y se conservan. Los servicios de catálogo que también se invocan directamente desde MCP mantienen su comprobación propia antes de escribir; la autorización de la operación MCP y la del handler siguen siendo fronteras separadas, con revalidación deliberada.

Diferencias intencionales: una promoción vigente puede ser efectiva sin refrescar un claim antiguo; una degradación pierde solo los privilegios retirados. `active` malformado y roles ajenos al contrato se rechazan. Algunos textos de error se unifican con el helper; se preservan `unauthenticated` y `permission-denied`. Un error de Firestore no concede acceso por fallback al claim. La decisión no constituye una transacción entre un cambio de rol concurrente y una escritura posterior: las fases posteriores de producción conservan sus revalidaciones.

## Validación y aislamiento

Todas las pruebas usan Auth/Firestore/Storage locales y proyectos `demo-*`, sin emulador de Functions (no dispara triggers ajenos). Las pruebas nuevas bloquean `fetch` externo y usan cuentas ficticias. Las integraciones existentes simulan proveedores e IAM/Drive en sus adaptadores; no generan cargos ni prueban con cuentas reales.

`authRoles.integration.test.ts` cubre los tres roles activos, claim admin contra revisor vigente, inactivo, archivado, ausente, rol inválido y `active` inválido; 401/403 por transporte real local; cuatro descargas y seis callables Automation; UID delegado incorrecto, identidad de `request.data`, cliente ajeno; recuento de lecturas, aislamiento concurrente y revalidación del mismo request; base nombrada frente a documento opuesto en `(default)`; máquina sin usuario por su ruta técnica con scopes/clientes propios. La integración Automation entra además por `automationIntakeWorker.run` sin sesión humana para el job técnico.

El emulador no implementa la política IAM de invocación de Cloud Run/Eventarc. Se valida el handler de esa ruta con evento sintético y principal técnico, y se compara la configuración desplegada; no se afirma una prueba real de IAM ni se invoca producción. Las suites Manglar existentes comprueban conexión OAuth/MCP con clientes ajenos, scopes insuficientes, revocación, cambio de rol e inactividad.

Comandos reproducibles (sin instalar dependencias):

```sh
npm --prefix functions run lint
npm --prefix functions run build
GCLOUD_PROJECT=demo-manglar-automation firebase emulators:exec \
  --only auth,firestore,storage --project demo-manglar-automation \
  'npm test -- --test-concurrency=1'
firebase functions:list --project tutofb-260320-1003 --json > /tmp/tuto-functions.json
node scripts/verify-auth-release.mjs /tmp/tuto-functions.json > /tmp/tuto-auth-inventory.json
```

Los fixtures que antes derivaban permisos únicamente del claim se actualizan para tener usuario vigente. Marketplaces usa carpetas propias y comprueba ausencia de jobs solo para su cliente, para poder ejecutar la suite completa en el mismo proyecto demo sin colisionar con Automation.

Resultados finales: `npm --prefix functions run lint` y build de Functions correctos. `npm test` con los tres emuladores: **311 pruebas aprobadas, cero fallos, cero omisiones**, incluidas `authRoles.integration`, `automation.integration`, `automationAdvanced.integration`, `manglarMcp`, `manglarExpanded` y `manglarModelPersistence`. `git diff --check` correcto. **Release completado:** 75/75 Functions seleccionadas actualizadas; 95/95 endpoints activos. Se verifican hashes nuevos, revisiones nuevas listas y 100% del tráfico en esas revisiones para las 75; las otras 20 conservan hash y revisión.

## Inventario y revisión del release

El verificador cruza exports TypeScript, metadata real `__endpoint` compilada e imports/exportaciones/dynamic imports transitivos con `firebase functions:list`. Falla si difieren los conjuntos local/remoto, el tipo de trigger o el estado/región esperados. Los servicios internos exportados sin metadata de endpoint no cuentan como Functions.

Comprobación previa: **95 endpoints locales = 95 desplegados activos; 75 incorporan el helper: 63 callable, 6 HTTP, 3 eventos y 3 schedules**. El alcance es conservador a nivel de módulo: `automationGenerationProgress`, `recoverAutomationImports`, `driveBackupWorker` y `scheduledDriveBackup` incorporan el módulo por compartir archivo/dependencias, aunque su propio handler no concede permisos humanos. Se incluyen en el release para no dejar revisiones con código compartido antiguo. `organizerScheduler` alcanza la comprobación del responsable humano por el handoff de generación.

Las otras 20 entradas no incorporan el helper y quedan fuera del despliegue seleccionado. Se registra la revisión Cloud Run anterior por endpoint para recuperación y se verificó que el conjunto seleccionado esté actualizado, sin cambios de runtime, identidad de servicio ni tipo/configuración de trigger. No se ejecutan operaciones de negocio, escrituras de prueba ni sincronización de claims contra producción.

La comparación posterior confirma sin cambios las identidades de servicio, runtime, memoria, CPU, concurrencia, límites, ingress, triggers, schedules y referencias a secretos de los 95 endpoints. No se sobrescribió ningún valor de entorno de negocio existente. Como efecto del CLI, 63 Functions incorporaron cinco parámetros de respaldos ya declarados (`DRIVE_BACKUPS_ENABLED`, `DRIVE_BACKUP_CUSTODIANS`, `DRIVE_BACKUP_RUNTIME`, `DRIVE_BACKUP_TIMEZONE`, `DRIVE_WORKSPACE_RUNTIME`), con exactamente los valores que ya tenían las Functions de respaldos; `DRIVE_BACKUPS_ENABLED` sigue en `false`. En ocho Functions se normalizó metadata `FUNCTION_SIGNATURE_TYPE` (siete adiciones y una omisión del valor implícito `http`), sin cambio de tipo de trigger. No se editaron archivos de entorno ni se activaron respaldos.

## Recuperación

Para denegaciones legítimas, revisar primero (solo lectura) `users/{uid}` en la base configurada y el rol requerido. Para MCP revisar también grant, scopes, versión de acceso y clientes; reconectar tras una revocación real. La recuperación administrativa de un documento/rol corresponde a un administrador autorizado y no forma parte de estas pruebas. Un refresh del token no rehabilita una cuenta inactiva.

Ante un problema de release, preferir un ajuste hacia adelante que mantenga la autoridad documental. Las revisiones previas por servicio quedan registradas abajo como referencia del incidente. Como contingencia, reconstruir `09390a1` en un checkout aislado y desplegar el mismo inventario restaura el código previo, pero reintroduce la vulnerabilidad de claims: requiere una decisión explícita de incidente y no se ejecuta automáticamente. No hay migraciones ni datos productivos que deshacer, ni se han creado commits o pushes.

## Revisiones por endpoint

| Endpoint (`us-central1`) | Tipo | Revisión anterior | Revisión lista tras release |
| --- | --- | --- | --- |
| `agentDriveWorkspace` | callable | `agentdriveworkspace-00002-xad` | `agentdriveworkspace-00003-yep` |
| `archiveAppUser` | callable | `archiveappuser-00090-yav` | `archiveappuser-00091-tib` |
| `automationApi` | http | `automationapi-00014-kas` | `automationapi-00015-cam` |
| `automationGenerationProgress` | event | `automationgenerationprogress-00010-xuk` | `automationgenerationprogress-00011-nij` |
| `automationIntakeWorker` | event | `automationintakeworker-00018-net` | `automationintakeworker-00019-vaw` |
| `backfillModelPoses` | callable | `backfillmodelposes-00025-xaz` | `backfillmodelposes-00026-wiz` |
| `cancelBatchProcessing` | callable | `cancelbatchprocessing-00052-rup` | `cancelbatchprocessing-00053-yeb` |
| `cancelJobGeneration` | callable | `canceljobgeneration-00072-few` | `canceljobgeneration-00073-nek` |
| `cancelPendingBatchJobs` | callable | `cancelpendingbatchjobs-00089-kux` | `cancelpendingbatchjobs-00090-vuq` |
| `classifyGarmentViewsWithGemini` | callable | `classifygarmentviewswithgemini-00076-nog` | `classifygarmentviewswithgemini-00077-can` |
| `createAppUser` | callable | `createappuser-00090-ruf` | `createappuser-00091-doy` |
| `createAutomationJob` | callable | `createautomationjob-00009-deg` | `createautomationjob-00010-giw` |
| `createAutomationPlan` | callable | `createautomationplan-00006-fom` | `createautomationplan-00007-did` |
| `createFinanceManualEvent` | callable | `createfinancemanualevent-00012-rix` | `createfinancemanualevent-00013-yik` |
| `createGenerationBatch` | callable | `creategenerationbatch-00100-vix` | `creategenerationbatch-00101-sew` |
| `createProductGenerationBatch` | callable | `createproductgenerationbatch-00005-zis` | `createproductgenerationbatch-00006-nil` |
| `decideManglarConnection` | callable | `decidemanglarconnection-00004-xiw` | `decidemanglarconnection-00005-moj` |
| `deleteClientSpreadsheetTemplate` | callable | `deleteclientspreadsheettemplate-00048-loq` | `deleteclientspreadsheettemplate-00049-nat` |
| `deleteJob` | callable | `deletejob-00026-sin` | `deletejob-00027-way` |
| `downloadBatchZip` | http | `downloadbatchzip-00090-kim` | `downloadbatchzip-00091-vol` |
| `downloadJobImage` | http | `downloadjobimage-00090-taj` | `downloadjobimage-00091-sof` |
| `downloadModelBundle` | http | `downloadmodelbundle-00022-lep` | `downloadmodelbundle-00023-hoj` |
| `downloadSelectedJobsZip` | http | `downloadselectedjobszip-00089-fuj` | `downloadselectedjobszip-00090-gex` |
| `driveBackupWorker` | event | `drivebackupworker-00002-kon` | `drivebackupworker-00003-yer` |
| `editBatchSpreadsheet` | callable | `editbatchspreadsheet-00007-hap` | `editbatchspreadsheet-00008-xul` |
| `executeAutomationPlanCallable` | callable | `executeautomationplancallable-00006-xug` | `executeautomationplancallable-00007-jej` |
| `exportBatchSpreadsheet` | callable | `exportbatchspreadsheet-00040-yoj` | `exportbatchspreadsheet-00041-ren` |
| `generateModelPose` | callable | `generatemodelpose-00096-led` | `generatemodelpose-00097-mug` |
| `getAutomationPlan` | callable | `getautomationplan-00005-but` | `getautomationplan-00006-qed` |
| `getFinanceDashboard` | callable | `getfinancedashboard-00013-yup` | `getfinancedashboard-00014-qar` |
| `getManglarConnectionRequest` | callable | `getmanglarconnectionrequest-00003-sit` | `getmanglarconnectionrequest-00004-yaw` |
| `getSystemConfig` | callable | `getsystemconfig-00070-zal` | `getsystemconfig-00071-yes` |
| `getSystemHealth` | callable | `getsystemhealth-00094-jus` | `getsystemhealth-00095-pov` |
| `importClientSpreadsheetTemplate` | callable | `importclientspreadsheettemplate-00060-jin` | `importclientspreadsheettemplate-00061-zin` |
| `importModelBundle` | callable | `importmodelbundle-00022-yoh` | `importmodelbundle-00023-hep` |
| `listManglarConnections` | callable | `listmanglarconnections-00003-xox` | `listmanglarconnections-00004-rib` |
| `manageDriveBackup` | callable | `managedrivebackup-00002-six` | `managedrivebackup-00003-zan` |
| `manglarMcp` | http | `manglarmcp-00014-rig` | `manglarmcp-00015-xuf` |
| `organizerAction` | callable | `organizeraction-00008-jic` | `organizeraction-00009-rab` |
| `organizerScheduler` | schedule | `organizerscheduler-00010-cad` | `organizerscheduler-00011-jix` |
| `permanentlyDeleteAppUser` | callable | `permanentlydeleteappuser-00090-wut` | `permanentlydeleteappuser-00091-wum` |
| `permanentlyDeleteClient` | callable | `permanentlydeleteclient-00089-cof` | `permanentlydeleteclient-00090-sow` |
| `permanentlyDeleteModel` | callable | `permanentlydeletemodel-00089-wuq` | `permanentlydeletemodel-00090-zor` |
| `previewProductDrafts` | callable | `previewproductdrafts-00064-wez` | `previewproductdrafts-00065-gun` |
| `rebuildAnalytics` | callable | `rebuildanalytics-00093-kob` | `rebuildanalytics-00094-nod` |
| `rebuildFinanceSnapshots` | callable | `rebuildfinancesnapshots-00013-luf` | `rebuildfinancesnapshots-00014-tuc` |
| `recoverAutomationImports` | schedule | `recoverautomationimports-00008-vup` | `recoverautomationimports-00009-xam` |
| `regenerateFailedBatchJobs` | callable | `regeneratefailedbatchjobs-00096-mom` | `regeneratefailedbatchjobs-00097-bil` |
| `regenerateJob` | callable | `regeneratejob-00097-siw` | `regeneratejob-00098-xiq` |
| `regenerateJobsBulk` | callable | `regeneratejobsbulk-00094-wex` | `regeneratejobsbulk-00095-bos` |
| `replaceModelPose` | callable | `replacemodelpose-00002-did` | `replacemodelpose-00003-fuf` |
| `restoreAppUser` | callable | `restoreappuser-00090-nuz` | `restoreappuser-00091-hel` |
| `resumeAutomationJob` | callable | `resumeautomationjob-00004-qor` | `resumeautomationjob-00005-pub` |
| `retryAutomationJob` | callable | `retryautomationjob-00009-xem` | `retryautomationjob-00010-fuw` |
| `retryJobAutoReview` | callable | `retryjobautoreview-00074-tah` | `retryjobautoreview-00075-gih` |
| `revokeManglarConnection` | callable | `revokemanglarconnection-00003-qis` | `revokemanglarconnection-00004-sub` |
| `saveClient` | callable | `saveclient-00002-tiy` | `saveclient-00003-qoc` |
| `saveModel` | callable | `savemodel-00003-nuk` | `savemodel-00004-hol` |
| `scheduledDriveBackup` | schedule | `scheduleddrivebackup-00002-sub` | `scheduleddrivebackup-00003-baq` |
| `selectJobOutput` | callable | `selectjoboutput-00077-liy` | `selectjoboutput-00078-pon` |
| `setClientArchived` | callable | `setclientarchived-00002-det` | `setclientarchived-00003-zoz` |
| `setJobManualFlag` | callable | `setjobmanualflag-00002-kow` | `setjobmanualflag-00003-yir` |
| `setModelActive` | callable | `setmodelactive-00001-lel` | `setmodelactive-00002-deh` |
| `setModelArchived` | callable | `setmodelarchived-00002-cer` | `setmodelarchived-00003-cog` |
| `setModelPoseActive` | callable | `setmodelposeactive-00002-rug` | `setmodelposeactive-00003-zun` |
| `syncUserClaims` | callable | `syncuserclaims-00092-poy` | `syncuserclaims-00093-hum` |
| `updateAppUser` | callable | `updateappuser-00090-mov` | `updateappuser-00091-jos` |
| `updateBatchProductDraft` | callable | `updatebatchproductdraft-00058-mar` | `updatebatchproductdraft-00059-wim` |
| `updateClientAutomation` | callable | `updateclientautomation-00009-gup` | `updateclientautomation-00010-ley` |
| `updateClientMarketplace` | callable | `updateclientmarketplace-00001-roq` | `updateclientmarketplace-00002-gup` |
| `updateClientSpreadsheetTemplateCategory` | callable | `updateclientspreadsheettemplatecategory-00055-qes` | `updateclientspreadsheettemplatecategory-00056-cax` |
| `updateFinanceSettings` | callable | `updatefinancesettings-00013-bep` | `updatefinancesettings-00014-kap` |
| `updateSystemAlertSettings` | callable | `updatesystemalertsettings-00082-tac` | `updatesystemalertsettings-00083-tad` |
| `updateSystemConfig` | callable | `updatesystemconfig-00070-som` | `updatesystemconfig-00071-dep` |
| `upsertFinanceClientPricing` | callable | `upsertfinanceclientpricing-00013-gus` | `upsertfinanceclientpricing-00014-xev` |

Fuera del release, con hash y revisión sin cambios: `onBatchFinanceClose`, `onClientDelete`, `onGeminiUsageFinanceCreate`, `onJobAnalyticsUpdate`, `onJobCompletedSquareCrop`, `onJobHumanFinanceUpdate`, `onJobOutputAnalyticsCreate`, `onJobOutputAnalyticsDelete`, `onJobOutputFinanceCreate`, `onJobStatusChange`, `onModelDelete`, `onModelGenerationFinanceCreate`, `onModelWrite`, `processJobOnActivation`, `processJobOnCreate`, `processJobOnRequeue`, `publicGeneratedImage`, `requeueExpiredJobsOnSchedule`, `storageCleanupOnSchedule`, `syncClaimsOnUserWrite`.

