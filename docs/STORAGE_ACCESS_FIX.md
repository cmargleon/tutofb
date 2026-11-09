# Acceso a imágenes de Storage — 2026-11-09

## Causa y corrección

El catálogo publicado devolvía `storage/unauthorized` (HTTP 403) en las doce
portadas. Las reglas ya consultaban `users` y `models` en Firestore, pero al
agente `service-1003939376366@gcp-sa-firebasestorage.iam.gserviceaccount.com`
le faltaba `roles/firebaserules.firestoreServiceAgent` en `tutofb-260320-1003`.

Se concedió exclusivamente ese rol al agente de Storage y se ejecutó
`firebase deploy --only storage --project tutofb-260320-1003 --non-interactive`.
No fue necesario modificar las reglas de acceso ni los datos del catálogo.
El permiso puede tardar varios minutos en propagarse.

Firebase CLI 15.11.0 omite la comprobación IAM en modo no interactivo y
también cuando las reglas coinciden con las desplegadas. El nuevo predeploy
`scripts/verify-storage-release.mjs` comprueba el proyecto y el permiso real
con `gcloud`; falla antes de publicar si falta el rol o no puede consultar IAM.
Requiere Google Cloud CLI autenticado con permiso para consultar el proyecto
y su política IAM. No modifica permisos automáticamente.

Referencia: [permisos de reglas entre Storage y Firestore](https://firebase.google.com/docs/rules/manage-deploy#manage_permissions_for_cross-service).

## Alcance

La misma dependencia de Firestore afecta a todas las rutas de `storage.rules`:
poses importadas, imágenes de identidad/poses generadas, fotos de referencia,
Excel de origen, plantillas y exportaciones. Las imágenes finales bajo
`generated/` se sirven en el frontend mediante una Function autenticada;
esa ruta de servidor no depende de este rol del agente de Storage.

## Verificación

- `npm test` con Node 22: 224 pruebas aprobadas, 14 omitidas por necesitar
  emuladores, cero fallos; incluye build de Functions y dos pruebas del guard IAM.
- `npm run lint`: correcto.
- Suite `clientSecurity.integration.test.ts` en Auth/Firestore/Storage locales,
  proyecto `demo-manglar-automation`, con bloqueo de conexiones externas:
  siete pruebas aprobadas, cero omisiones. Comprueba lectura de modelos,
  generaciones de identidad/poses, rutas antiguas, plantillas/exportaciones y
  borradores propios, además de rechazos entre clientes y a cuentas inactivas.
- Despliegue de Storage completado con el nuevo predeploy IAM.
- Verificación en la sesión real de la app publicada tras la propagación:
  doce de doce portadas cargadas, veinticuatro de veinticuatro poses en
  MODELO BASE MUJER y tres imágenes finales de un lote JISHOP, sin errores
  en esas vistas. Se dejó la pestaña original en el catálogo de modelos.

Los emuladores prueban las reglas y el aislamiento, pero no reproducen la
política IAM de producción; por eso la comprobación remota forma parte del
predeploy.

## Corrección adicional para desarrollo local

La sesión de `http://localhost:3001` presentaba otro fallo: las descargas
respondían HTTP 200 pero el navegador bloqueaba su lectura por CORS.
El bucket únicamente incluía `localhost:3000`, además de los dos dominios
publicados. La comprobación anterior se había limitado a la app publicada.

Se añadieron a `cors.json` los orígenes explícitos `localhost` y `127.0.0.1`
en los puertos 3000, 3001 y 3002. Se conservaron los dominios publicados,
métodos y cabeceras existentes. Se aplicó la configuración real mediante:

```sh
gcloud storage buckets update gs://tutofb-260320-1003.firebasestorage.app --cors-file=cors.json
```

El predeploy de Storage ahora compara también el CORS del bucket con
`cors.json` y rechaza diferencias. Requiere permiso de lectura de metadata
del bucket, además de la consulta IAM. `firebase deploy --only storage`
no aplica por sí solo el archivo CORS; se debe usar el comando anterior.
La prueba del guard detecta la ausencia de cada origen local admitido.

Verificación en la pestaña original `localhost:3001/models/catalogo`:
doce de doce imágenes cargadas, sin errores en la vista. El cambio corrige
también las demás descargas autenticadas mediante `getBlob` desde esos
orígenes. Referencia: [CORS para descargas en navegador](https://firebase.google.com/docs/storage/web/download-files#cors_configuration).

Tras esta corrección, `npm test` con Node 22: 225 pruebas aprobadas,
14 omitidas por necesitar emuladores y cero fallos. Despliegue de Storage
completado con las comprobaciones remotas de IAM y CORS correctas.
