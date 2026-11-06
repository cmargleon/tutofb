# Seguridad y respaldos de Drive

Estado de entrega: 6 de noviembre de 2026. La implementación se despliega inicialmente con `DRIVE_BACKUPS_ENABLED=false`. **No equivale a clientes protegidos:** se necesita el alta manual de las unidades/identidades y una primera sincronización correcta. No se probaron ni modificaron carpetas reales de clientes.

## Auditoría de la implementación anterior

- Firebase real: `tutofb-260320-1003`, Functions v2/Node 22, Firestore con `getAppFirestore()` y database ID configurable. Se conservan las reglas y contratos existentes.
- `functions/src/automation/drive.ts`: integración de importación de imágenes con IAM Credentials y una SA lectora, `drive.readonly`, sin claves; valida cliente/carpeta/versión. Es reutilizable como patrón, pero su límite de imágenes de 10 MB no sirve como motor genérico.
- `functions/src/google/drive.ts`: exportación/actualización/compartición de Sheets mediante `GOOGLE_PRIVATE_KEY`, scope `drive`, y suplantación de usuario Workspace opcional. **Es una identidad heredada con capacidad de escritura.** No se reutiliza para respaldos. La nueva guarda rechaza destinos registrados como originales/respaldos, incluyendo descendientes.
- `functions/src/organizer/drive.ts`: organizador con inventarios/cursor de cambios y comprobación de carpetas administradas. Usa el token anterior y requiere el mismo Drive para origen y destino. Su análisis con Gemini **no participa en respaldos**. Se añadió la misma guarda a sus destinos; su arquitectura heredada requiere una migración revisada para trabajar con las nuevas unidades aisladas; las guardas ya pueden bloquear escrituras en raíces protegidas.
- OAuth de Manglar autentica conexiones de agentes frente a Tuto; **no es OAuth de los propietarios de Drive**. Ningún token Google se devuelve por el nuevo contrato.
- Auditoría IAM de solo lectura: la función existente usa la SA Compute por defecto, con `roles/editor`; `automation-drive-reader` tiene una concesión específica `automationDriveTokenMinter`. La nueva integración usa runtimes independientes, sin acceso a `GOOGLE_PRIVATE_KEY` y sin roles Editor.
- Se detectaron numerosos cambios locales anteriores. No se hizo commit, reset, instalación, cambio de lockfile ni migración de datos. Inicialmente se desplegaron los endpoints/reglas nuevos y las guardas sobre copias del código remoto. Tras la confirmación del usuario de que se commiteará todo el estado local, se publica también el panel y las funciones afectadas desde esa base. No se hizo commit.

## Arquitectura elegida

```text
Drive cliente -- SA src: lector + drive.readonly --> motor determinista
                                                       |
                                                 SA bkp: gestor de contenido
                                                       v
                                             Shared Drive respaldo
                                             espejo + .tuto-versions
                                                       |
                                             restauración administrativa
                                                       v
                                             Shared Drive trabajo
                                                       ^
                                         API cliente + SA work exclusiva
                                                       |
                                                   agentes
```

Por cliente hay tres identidades sin claves y dos unidades compartidas independientes, controladas por una cuenta Workspace de Tuto. Los IDs raíz de respaldo y trabajo son los IDs de sus unidades compartidas. Esta decisión evita que un ancestro heredado comparta privilegios con otro cliente. No se permite almacenar con una SA en My Drive ni usar domain-wide delegation.

La documentación de Google confirma que [las service accounts no tienen cuota ni pueden poseer archivos](https://developers.google.com/workspace/drive/api/guides/handle-errors#storagequotaexceeded). My Drive con OAuth de un usuario humano es una alternativa técnica, pero no se implementó un segundo almacén de refresh tokens ni consentimiento de escritura: añade privilegios y mantenimiento. Si Tuto no tiene un plan Workspace con unidades compartidas, deberá contratarlo o acordar esa variante antes de activar.

| Identidad | Acceso Drive | Quién puede emitir su token |
| --- | --- | --- |
| `db-CLIENTE-src` | Solo lector de la carpeta original autorizada | runtime de respaldo |
| `db-CLIENTE-bkp` | `fileOrganizer` (gestor de contenido) solo de su unidad de respaldo | runtime de respaldo |
| `db-CLIENTE-work` | Gestor de contenido solo de su unidad de trabajo | runtime de respaldo (restaurar) y runtime de trabajo |
| `drive-backup-runtime` | No membresía directa en Drive | Functions programada, worker y callable administrativo |
| `drive-workspace-runtime` | No membresía directa en Drive | Callable de trabajo autenticado |

La emisión usa solo `iam.serviceAccounts.getAccessToken`, con tokens de 600 segundos, caché menor al vencimiento, sin `signJwt`, claves privadas ni secretos nuevos. No conceder impersonación a usuarios/agentes, runtimes heredados o a nivel global del proyecto. Los runtimes necesitan `roles/datastore.user`; el worker también `roles/eventarc.eventReceiver` y autorización para recibir su evento. La autorización por cliente se verifica en el backend y las reglas deniegan escrituras directas. Tres SAs por cliente consumen cuota IAM; con muchos clientes puede ser necesario solicitar su ampliación.

La activación y cada ejecución verifican:

1. Origen accesible, carpeta, permiso explícito lector de la SA y capacidad de edición falsa.
2. Respaldo y trabajo editables, en unidades compartidas distintas del origen y entre sí.
3. Ninguna identidad puede leer siquiera otra capa (una respuesta 403 no se interpreta como prueba de aislamiento; se exige 404).
4. Miembros del respaldo: solo SA bkp como `fileOrganizer` y custodios humanos explícitos. Sin grupos, dominios, enlaces públicos ni agentes. Trabajo también restringido a su SA y custodios.
5. Carpetas e identidades no están asignadas a otro cliente. Una frontera existente no se puede cambiar desde el panel.

Google no ofrece un rol que permita mover archivos dentro de una unidad compartida sin permitir también enviarlos a papelera: `writer` puede crear/editar pero no mover. Se usa el **mínimo rol funcional `fileOrganizer` solo para el motor aislado**, sin endpoints de papelera/eliminación en su cliente de respaldo, sin permisos para borrar definitivamente ni administrar miembros. La alternativa de colaborador requeriría snapshots nuevos sin mover y cambiaría el requisito de espejo/historial. Ver [matriz oficial de permisos](https://developers.google.com/workspace/drive/api/guides/ref-roles). Los agentes no pueden emitir tokens de esta identidad.

Los permisos reales de las carpetas existentes no se modifican automáticamente. La protección física exige revisar/revocar con el propietario cualquier acceso antiguo de escritura del organizador, usuarios de agentes o delegación Workspace. Las guardas de aplicación son defensa adicional; no sustituyen esa revisión de ACL/IAM.

## Algoritmo y recuperación ante fallos

- Un único Scheduler: `0 9,11,13,15,17,19,21 * * 1-6`; zona inicial `America/Mexico_City`. Configurable al desplegar con `DRIVE_BACKUP_TIMEZONE` (zona IANA). Siete ejecuciones por día de lunes a sábado, ninguna programada en domingo. Una continuación/reintento o solicitud manual puede terminar fuera del horario; no es una nueva ejecución programada.
- Scheduler encola un documento por cliente; un trigger Firestore ejecuta slices de hasta siete minutos. Lease de 12 minutos, timeout de 9, exclusión por cliente y tres instancias máximas.
- Inicial: inventario recursivo paginado; cola de carpetas, página y offset persistidos. Se captura `startPageToken` **antes** del inventario.
- Incremental: `changes.list` evita inventarios si no hubo eventos. Cuando hay cambios se reconcilian metadatos del árbol autorizado y solo se transfieren contenidos nuevos/modificados. No se aplica directamente el feed global, que puede contener elementos fuera de la carpeta o movimientos de carpetas con descendientes sin eventos individuales.
- Reconciliación al menos cada 24 h de actividad programada; cursor 410 fuerza inventario. Los eventos ocurridos durante el inventario se reproducen en la siguiente ejecución.
- Binarios: checksum MD5/tamaño verificados, lectura con `drive.readonly`, carga con la identidad de respaldo. Cambios de nombre/ubicación no recargan el contenido si su MD5 coincide.
- Cada contenido observado genera un archivo independiente. Las versiones anteriores se guardan en `.tuto-versions/ID_ORIGINAL/`. No dependen de la retención automática de revisiones de Drive. Solo el motor puede reorganizar el espejo y el historial; no sobrescribe el contenido de una versión existente.
- Antes de cada creación se reserva un ID con `files.generateIds` y se persiste la intención en Firestore. La repetición de una operación utiliza el mismo ID, también tras timeout ambiguo. Los metadatos verifican cliente/clave/raíz. Se mantiene checksum y manifiesto por archivo.
- Ninguna ruta de respaldo llama `files.delete`, `emptyTrash`, cambia permisos o pone archivos en papelera. Ausencias (borrado, movimiento fuera del origen o permiso perdido) se marcan `missing`, se registran como alerta y se conservan sus copias.
- 429/5xx y cuotas temporales: backoff exponencial, cuatro intentos HTTP como máximo. Worker: cuatro intentos por solicitud; el siguiente horario o una solicitud manual reinicia el presupuesto. Errores permanentes quedan visibles y no avanzan el cursor. Un archivo incompatible bloquea esa ejecución de forma visible; no se declara respaldo completo.
- Restauración: administrativa, aditiva, hacia `Restauración REQUEST_ID` en trabajo. Permite archivo, carpeta con descendientes, cliente completo o versión específica de un archivo. No sobrescribe datos de trabajo. IDs persistidos y cursor permiten reanudar. Una nueva reconstrucción tras otro borrado requiere un nuevo requestId.

## Contratos, seguridad y panel

- Ruta administrativa `/seguridad-respaldos`: estado por cliente, última ejecución correcta, contadores, último error, auditoría, sincronización manual, configuración, archivos/versions recientes y restauraciones. La lista visible tiene límite 100; para otros elementos puede introducirse su ID/clave. No se descarga el catálogo entero al abrir el panel.
- `manageDriveBackup`: administrador activo (verificación de documento además de claim); conexiones delegadas Manglar rechazadas. Acciones `configure`, `sync`, `restore`. La carpeta original tiene que estar ya autorizada en `clients/{id}.automation.driveFolderIds`.
- `agentDriveWorkspace`: administrador u operador activo incluido en `operatorUids`; se verifica el límite de cliente de la conexión delegada. Acciones `list/read/create/update/trash`, sin raíz/credencial elegibles por el llamador. Todas las operaciones prueban ascendencia actual hasta la raíz configurada. La raíz misma no se borra. Carga/lectura de hasta 8 MiB y carpetas de hasta 100 elementos por respuesta.
- Este endpoint está listo para clientes Firebase/servidores autenticados. **No se añadió al catálogo MCP heredado ni se redirigió automáticamente el organizador**: requiere definir esa migración sin sus permisos anteriores.
- `driveBackups/{clientId}`: configuración sin secretos, estado, lease, cursor, contadores, errores. Subcolecciones: `entries`, `versions`, `intents`, `runs` (tasks/events/counts), `restores`, `audit`, `workspaceIntents`, `workspaceAudit`.
- `driveBackupQueue`, `driveBackupControl`: privados de servidor. Administradores pueden leer estado e historial; operadores no leen respaldos. Nadie escribe directamente desde SDK cliente, ni siquiera administradores.
- Auditoría estructurada de errores en Cloud Logging (`drive_backup_error`) y Firestore. No se implementan notificaciones por email/Slack: faltan destinatario/canal autorizado. Consultar panel/logs; opcionalmente crear una política de Monitoring sobre esa entrada.

## Configuración manual exacta

1. Identificar la cuenta Workspace **independiente de Tuto**, custodios humanos y plan/cuota disponible. No usar la cuenta de un cliente ni una cuenta Google conectada a un agente como custodio.
2. Revisar la política de compartir de Workspace (incluye service accounts externas al dominio). Crear dos unidades compartidas vacías por cliente: `Tuto - CLIENTE - RESPALDO` y `Tuto - CLIENTE - TRABAJO`. No mover carpetas existentes.
3. Crear identidades/impersonación con el script (primero muestra plan, luego aplica solo recursos nuevos):

   ```sh
   node scripts/drive-backup-identities.mjs --client=slug
   node scripts/drive-backup-identities.mjs --client=slug --apply
   ```

   `slug`: minúsculas, comienza por letra, 2–15 caracteres. Reutiliza el rol específico existente `projects/tutofb-260320-1003/roles/automationDriveTokenMinter`, auditado para contener solo `iam.serviceAccounts.getAccessToken`. No genera claves. El script nunca comparte carpetas ni cambia ACL existentes.
4. Con la cuenta propietaria, compartir **como lector** la carpeta original con `db-slug-src@tutofb-260320-1003.iam.gserviceaccount.com`. Ninguna de las otras identidades tendrá acceso al origen.
5. En respaldo, añadir `db-slug-bkp@...` como gestor de contenido (`fileOrganizer`) y solo custodios humanos. En trabajo, añadir `db-slug-work@...` como gestor de contenido. Mantener fuera a lectores de origen, organizadores antiguos, grupos, dominios y agentes. Los agentes operan por API de trabajo; no reciben claves/tokens de Google.
6. Revisar con el propietario las ACL de origen, delegación de dominio y credenciales heredadas. Retirar sus privilegios de escritura si se usan por agentes. Esto requiere revisar dependencias reales antes de modificar permisos, no una migración automática.
7. Configurar parámetros en el proceso de despliegue de Firebase (valores no secretos):

   | Parámetro | Valor inicial |
   | --- | --- |
   | `DRIVE_BACKUPS_ENABLED` | `false`, cambiar a `true` después de los pasos previos |
   | `DRIVE_BACKUP_TIMEZONE` | `America/Mexico_City` |
   | `DRIVE_BACKUP_CUSTODIANS` | correos humanos de Tuto separados por coma |
   | `DRIVE_BACKUP_RUNTIME` | `drive-backup-runtime@tutofb-260320-1003.iam.gserviceaccount.com` |
   | `DRIVE_WORKSPACE_RUNTIME` | `drive-workspace-runtime@tutofb-260320-1003.iam.gserviceaccount.com` |

   No usar `.env.example` como secreto ni poner claves en Firestore, frontend o repositorio. No hay nuevas variables Vite ni refresh tokens. Cambiar parámetros requiere redesplegar las cuatro Functions.
8. Tras revisar los cambios previos del repositorio, desplegar:

   ```sh
   firebase deploy --project tutofb-260320-1003 --only functions:manageDriveBackup,functions:scheduledDriveBackup,functions:driveBackupWorker,functions:agentDriveWorkspace,firestore:rules
   # Solo después de revisar las modificaciones anteriores del organizador/exportación:
   firebase deploy --project tutofb-260320-1003 --only functions:organizerAction,functions:organizerScheduler,functions:editBatchSpreadsheet,hosting
   ```

   No usar `functions deploy` global para publicar sin revisión otros cambios locales. Nuevos runtimes: `roles/datastore.user`; respaldo además `roles/eventarc.eventReceiver`. El trigger debe poder invocar su servicio Cloud Run:

   ```sh
   gcloud run services add-iam-policy-binding drivebackupworker --region=us-central1 --project=tutofb-260320-1003 --member=serviceAccount:drive-backup-runtime@tutofb-260320-1003.iam.gserviceaccount.com --role=roles/run.invoker
   ```

   Este permiso ya quedó aplicado en la entrega; verificarlo después de futuros despliegues. IAM Credentials/Drive API, Scheduler, Eventarc, Functions y Firestore deben estar habilitados; se aprovechan servicios existentes.
9. En el panel, registrar IDs raíz/identidades/UIDs de operadores, activar y esperar el resultado de verificación y sincronización inicial. Un checkbox marcado no implica un respaldo ya terminado. Probar primero con **un cliente y archivos sintéticos**, incluyendo reconstrucción completa, antes del alta de clientes reales.
10. Verificar que los runtimes heredados no tienen permiso de emitir tokens de las nuevas SAs. Concederlo solo sobre cada cuenta destinataria, nunca con `roles/iam.serviceAccountTokenCreator` global. Auditar también cuentas con roles Owner/Editor/administración IAM, que son administradores de infraestructura y no deben quedar expuestas como herramientas genéricas de agentes.

## Límites explícitos y trabajo pendiente

- Transferencias de archivos binarios: hasta **100 MiB por archivo** para acotar memoria/tiempo. Archivos mayores generan alerta y dejan el cursor pendiente. Para volúmenes mayores falta transferencia por streaming con sesiones de carga resumibles persistidas por chunk.
- Docs/Sheets/Slides se exportan respectivamente a DOCX/XLSX/PPTX; Drawing a SVG, conservando el nombre. Esto no preserva comentarios, ACL, IDs originales, historial anterior al primer respaldo ni todas las funciones nativas. `files.export` tiene [límite de 10 MB](https://developers.google.com/workspace/drive/api/guides/manage-downloads#export_google_workspace_document_content). Vids, Forms, shortcuts y otros tipos no exportables generan error visible, sin seguir enlaces fuera del árbol ni crear copias vacías.
- No es un respaldo inmutable WORM frente al administrador de Workspace o una credencial del motor comprometida. Sí separa físicamente permisos de agentes y el motor no tiene rutas de eliminación de respaldos. GCS con retención bloqueada podría añadir protección frente al custodio; no se incorporó ni se incurrió en ese costo.
- El feed de cambios evita escaneos vacíos; cuando hay eventos se recorre el árbol completo de metadatos. No es un índice de cambios de O(archivos modificados). Se priorizó reconciliar movimientos de carpetas de forma segura y mantener una sola implementación.
- IAM de Firestore es de base de datos/proyecto; el aislamiento por cliente de endpoints es de aplicación. No se ofrecen credenciales de Admin SDK a agentes. Las guardas de Drive complementan el aislamiento físico de las identidades.
- No hay borrado automático de versiones, eventos o manifiestos. El crecimiento es deliberado; evaluar una política de retención explícita antes de cualquier limpieza.
- No hay prueba real entre dos cuentas de Workspace todavía: faltan las unidades, custodio e identidades por cliente. La documentación oficial y simulaciones no sustituyen esa validación de dominio/ACL. No activar para clientes reales antes de ella.

## Costos estimados (USD; orientación, no presupuesto medido)

- Scheduler: un job adicional cuesta **$0.10/mes** fuera de los tres gratuitos por cuenta de facturación; no se cobra cada tick. Aproximadamente 182 ticks/mes (`7 × 6 × 52 / 12`). [Precio oficial](https://cloud.google.com/scheduler/pricing).
- CPU/memoria: ejemplo 10 clientes × 182 ejecuciones × 5 segundos = 9,100 vCPU-s y 9,100 GiB-s; a $0.000024/vCPU-s + $0.0000025/GiB-s son **~$0.24/mes** antes de capa gratuita, eventos, dispatcher, builds, logs, Firestore y transferencia. Si promedian 60 s, **~$2.89/mes** de cómputo. Un inventario inicial grande puede costar más. [Cloud Run](https://cloud.google.com/run/pricing).
- Firestore: se cobran documentos leídos/escritos e índices; la cuota gratuita es compartida con todo Tuto. A modo de cálculo de volumen, 10 clientes × 1,000 archivos × 26 reconciliaciones diarias representan 260,000 visitas a entradas/mes, con varias lecturas/escrituras por archivo, más las ejecuciones con cambios. No se debe extrapolar el costo del tick vacío al inventario completo. Ver [tarifas por región](https://cloud.google.com/firestore/pricing).
- Drive: uso estándar dentro de cuotas sin costo adicional según [documentación vigente](https://developers.google.com/workspace/drive/api/guides/limits). Google anuncia cambios de cobro por excesos para 2026; no asumir API ilimitada o gratis para cualquier volumen. Hay límites de solicitudes, carga y almacenamiento.
- Workspace: si ya existe un plan apropiado y cuota, puede no haber licencia adicional. Como referencia, Business Standard publica **$14/usuario/mes con compromiso anual y 2 TB compartidos por usuario**, sin promociones/impuestos ni conversión regional. Confirmar elegibilidad de unidades compartidas y políticas del dominio. [Precio oficial](https://workspace.google.com/pricing.html). No se compró ninguna licencia.
- Almacenamiento: `contenido inicial + bytes de cada versión observada + datos de trabajo + restauraciones aditivas`. Ejemplo: 50 GB iniciales + 5 GB/mes de versiones + 50 GB de trabajo = ~105 GB el primer mes y 160 GB al mes 12, antes de nuevas restauraciones. Se conservan las versiones indefinidamente; no hay deduplicación entre clientes.
- Rango ilustrativo para 10 clientes pequeños y plan Workspace nuevo: **~$14–20/mes**, siempre que datos/operaciones quepan en cuota y no haya transferencias grandes ni otros consumos de Tuto. No es una cota ni un cálculo basado en inventarios reales. Sin licencia nueva, el componente cloud podría quedar en pocos dólares o capas gratuitas.

## Validación reproducible

```sh
npm --prefix functions run build
node --import tsx --test tests/driveBackups.test.ts
firebase emulators:exec --project demo-tuto-drive-backups --only firestore,auth 'node --import tsx --test tests/driveBackups.integration.test.ts'
npm test
npm run lint
npm run build
```

Las pruebas usan Drive en memoria/transporte simulado y proyecto Firebase `demo-*`. Cubren jerarquía, alta, cambios, renombres, movimientos, borrado de árbol original, recuperación tras borrado total de trabajo, respuesta incierta, autenticación/permisos, reintentos, repetición, fronteras de acceso, reglas reales en emulador y calendario semanal/zona. El informe de verificación registra los resultados y el estado remoto comprobado.
