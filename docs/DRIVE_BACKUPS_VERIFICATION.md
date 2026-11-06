# Verificación y entrega: respaldos de Drive

Fecha: 2026-11-06. Proyecto previsto: `tutofb-260320-1003`.

## Archivos de esta implementación

- `functions/src/backups/policy.ts`: validación, cron, versiones y exportaciones.
- `functions/src/backups/drive.ts`: tokens IAM, transporte de lectura, carga idempotente y capacidad separada de trabajo.
- `functions/src/backups/isolation.ts`: comprobación de ACL/capacidades entre tres identidades.
- `functions/src/backups/engine.ts`: motor sin IA, inventario/incremental/reconciliación y conservación de versiones.
- `functions/src/backups/store.ts`: intenciones, checkpoints, métricas por archivo, historial.
- `functions/src/backups/restore.ts`: reconstrucción aditiva/idempotente.
- `functions/src/backups/functions.ts`, `runtime.ts`: scheduler, trigger, callables y parámetros.
- `functions/src/backups/legacyGuard.ts`: defensa de destinos de integraciones anteriores.
- `functions/src/google/drive.ts`, `functions/src/organizer/drive.ts`: incorporación de la guarda, conservando modificaciones preexistentes.
- `functions/src/index.ts`: cuatro exports adicionales.
- `shared/src/types/backups.ts`: contratos de backend y frontend.
- `firestore.rules`: colecciones nuevas, lectura administrativa, escrituras solo servidor.
- `src/features/backups/*`, `src/pages/SeguridadRespaldos.tsx`: acceso Firebase, hook, panel, historial/restauración.
- `src/app/AppRouter.tsx`, `src/components/layout/navigation.ts`: ruta y navegación solo administrador.
- `scripts/drive-backup-identities.mjs`: plan/aplicación explícita de nuevas cuentas e IAM por cliente, sin ACL Drive.
- `e2e/drive-backups.spec.ts`: prueba del panel sin servicios reales.
- `tests/driveBackups.test.ts`, `tests/driveBackups.integration.test.ts`: pruebas con datos sintéticos.
- `tests/organizer.test.ts`: inyección de guarda en su transporte unitario, sin acceder a Firebase real.
- `docs/DRIVE_SECURITY_BACKUPS.md` y este informe.

No se añadieron dependencias ni se editaron lockfiles, claves, reglas Storage o documentos de clientes reales. Los artefactos compilados solo los generan los comandos de build.

## Resultados

- Unitarias específicas: 13/13 aprobadas.
- Integración Auth + Firestore emulados: 5/5 aprobadas (incluye prueba principal y cuatro subpruebas), cero omitidas.
- Suite completa final: 194 pruebas, 185 aprobadas, cero fallidas, nueve omitidas por requerir otros emuladores. La integración de respaldos se ejecutó separadamente con sus emuladores y sin omisiones.
- Typecheck frontend/Functions y build frontend: aprobados.
- E2E Playwright: 1/1 aprobada, con datos simulados, sincronización manual, selección de versión, confirmación aditiva y capturas de escritorio/móvil. No usa Auth/Drive reales.
- `git diff --check`: correcto.
- Script de IAM: modo plan verificado. No se ejecutó `--apply` para clientes.
- No se ejecutó ninguna prueba destructiva ni lectura de contenido en Google Drive real.

## Estado remoto

- Primer despliegue: cuatro Functions nuevas y reglas Firestore completado correctamente.
- Runtimes nuevos creados: `drive-backup-runtime` (datastore.user + eventarc.eventReceiver) y `drive-workspace-runtime` (datastore.user). No tienen claves, secretos ni membresías en Drive. No se creó ninguna SA de cliente ni se concedió acceso a carpetas originales.
- Guardas del organizador y exportación desplegadas primero desde fuentes remotas aisladas, con compilación de los módulos modificados.
- Scheduler remoto comprobado: `firebase-schedule-scheduledDriveBackup-us-central1`, estado ENABLED, cron `0 9,11,13,15,17,19,21 * * 1-6`, zona `America/Mexico_City`.
- Entorno remoto comprobado: `DRIVE_BACKUPS_ENABLED=false`, runtime de respaldo dedicado, sin secretos vinculados. Scheduler existe pero el handler sale sin tocar Drive mientras esté desactivado.
- Firebase CLI guardó automáticamente los cinco parámetros no secretos de la integración en su dotenv de proyecto; custodios vacío, sincronización falsa. No se editaron claves o credenciales de producción.
- Segundo despliegue de siete Functions afectadas, reglas y Hosting desde el estado local autorizado por el usuario: completado correctamente. Hosting incluye los demás cambios locales de interfaz que el usuario indicó que commiteará.
- Worker: permiso `roles/run.invoker` concedido solo a `drive-backup-runtime` sobre su servicio Cloud Run (la creación automática no lo había concedido); Scheduler ya tiene esa concesión específica y usa OIDC del mismo runtime. Sin invocación pública del worker/scheduler.
- Endpoints públicos de transporte callable rechazan solicitudes sin sesión: `manageDriveBackup` y `agentDriveWorkspace` responden HTTP 401 `UNAUTHENTICATED`, comprobado sin tokens ni datos reales.
- Hosting: `https://tutofb-260320-1003.web.app/seguridad-respaldos` responde 200; el bundle publicado contiene la ruta y el chunk del panel. El acceso a los datos requiere sesión administrativa.
- No se modificaron permisos de Drive, claims ni documentos de clientes reales. La activación real y prueba entre cuentas siguen pendientes de cuenta custodio/unidades/ACLs.

## Para activar protección real

Seguir `DRIVE_SECURITY_BACKUPS.md`, sección configuración: cuenta Tuto/Workspace y custodios; dos unidades vacías por cliente; tres SAs/ACLs mínimas; revisión de permisos heredados; parámetros y despliegue revisado; alta de cliente sintético y prueba real entre cuentas; primera sincronización completa. Ningún cliente debe considerarse protegido hasta completar esa verificación.
