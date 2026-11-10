/**
 * Flag central de Firebase App Check para TODAS las funciones onCall.
 *
 * Se aplica vía `setGlobalOptions({ enforceAppCheck })` en `functions/src/index.ts`,
 * que firebase-functions usa como valor por defecto de `enforceAppCheck` en cada
 * `onCall` (las opciones propias de una callable tendrían prioridad; ninguna lo define).
 * Los endpoints `onRequest` (manglarMcp, automationApi, descargas HTTP) no se ven
 * afectados: `HttpsOptions` no admite enforceAppCheck.
 *
 * - false (modo monitoreo): las requests sin token o con token inválido se aceptan;
 *   las métricas de App Check en la consola muestran cuántas llegan verificadas.
 * - true (enforcement): las requests sin token válido reciben 401.
 *
 * Se lee al definir las funciones (cold start), así que cambiarlo requiere deploy.
 */
export const ENFORCE_APP_CHECK = false;
