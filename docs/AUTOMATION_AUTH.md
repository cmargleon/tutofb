# Identidad técnica de ChatGPT Work

La autenticación máquina-a-máquina está separada de usuarios humanos y de Firebase Auth. Work no genera Firebase ID tokens. La API ofrece OAuth 2.0 `client_credentials`: la herramienta HTTP segura intercambia su credencial por un bearer opaco de 15 minutos y repite el intercambio automáticamente cuando necesita renovarlo. No utiliza refresh tokens de Firebase ni cuentas de servicio con acceso a datos de producción.

## Configuración provisionada

| Campo | Valor |
| --- | --- |
| Base URL | `https://tutofb-260320-1003.web.app/api/automation` |
| Token URL | `https://tutofb-260320-1003.web.app/api/automation/token` |
| Grant type | `client_credentials` |
| Client ID | `chatgpt-work` |
| Client secret | Obtener de Secret Manager, recurso indicado abajo; nunca copiarlo al chat |
| Scopes | `uploads:write jobs:create jobs:read` |
| Cliente de negocio autorizado | `automation-e2e-test` |
| Tipos admitidos | `garment`, `product` |
| Polling de jobs | **20 segundos durante 5 minutos; después 60 segundos; timeout de seguimiento de 30 minutos** |
| Revisión de Gmail | Configuración independiente en el scheduler externo (`GMAIL_CHECK_INTERVAL_SECONDS`) |
| Vigencia del access token | 900 segundos; adquirir otro al comenzar la siguiente ejecución |
| Almacenamiento del secreto | `projects/tutofb-260320-1003/secrets/MANGLAR_WORK_CLIENT_SECRET/versions/latest` |

El cliente de negocio de prueba se llama **Manglar Automation E2E (TEST ONLY)**. Esta credencial no puede enviar trabajos para clientes reales. No tiene `jobs:retry`, rol `operador`, rol `admin`, acceso al panel, Firebase Auth, Firestore directo ni permisos IAM sobre Storage. Solo puede consultar jobs de su propia identidad. No se ha ampliado el acceso a ningún cliente real.

La identidad está en `automationPrincipals/chatgpt-work`, sin documento `users` y sin usuario Firebase Auth. Los originales se guardan bajo el UID interno `automation-chatgpt-work`, manteniendo la convención `garments/drafts/{uid}/…`.

## Qué configurar/entregar en Work

En el **almacén de credenciales de la herramienta HTTP segura**, configurar:

- `MANGLAR_CLIENT_ID`: `chatgpt-work` (no secreto).
- `MANGLAR_CLIENT_SECRET`: valor de la versión vigente de `MANGLAR_WORK_CLIENT_SECRET` en Google Secret Manager (**secreto**).
- `MANGLAR_BASE_URL`: base URL de la tabla (no secreto).
- `MANGLAR_ALLOWED_CLIENT_ID`: `automation-e2e-test` (no secreto).
- Polling de jobs: política de `shared/src/automationPolling.json` (20 s / 5 min → 60 s; timeout 30 min).
- `GMAIL_CHECK_INTERVAL_SECONDS`: frecuencia del scheduler externo de Gmail, por separado; por ejemplo `7200` para revisar correo cada dos horas. Manglar no ejecuta ese scheduler ni lee esta variable para consultar jobs.

El nombre de variable externa y el ID de Secret Manager son distintos: `MANGLAR_CLIENT_SECRET` contiene el valor del secret `MANGLAR_WORK_CLIENT_SECRET`. No son una API key de OpenAI, una API key de Firebase, credenciales de Google Drive ni una clave de cuenta de servicio. No hace falta entregar `FAL_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, credenciales de Google Cloud o Firebase refresh tokens a Work.

El administrador debe transferir **una vez** el client secret desde Secret Manager al campo seguro de esa herramienta, o conectar su proveedor de secretos con acceso exclusivamente a ese recurso. Para acceso directo desde un runtime Google Cloud, el operador puede conceder `roles/secretmanager.secretAccessor` **solo sobre ese secret** a la identidad del runtime, sin roles de proyecto. No se concedió ese acceso a una identidad externa desconocida.

No pegar el secreto en prompts, instrucciones del agente, documentos, Gmail, logs, repositorios o archivos de configuración versionados. La herramienta realiza el intercambio y añade el bearer internamente; devuelve al modelo solo resultados de negocio. No dar acceso al modelo a la función que lee secretos ni devolverle el access token.

No puedo registrar el secreto en el almacén externo de Work desde este repositorio: no hay una sesión/configuración de esa herramienta conectada. La identidad, el secret y los endpoints quedan provisionados y probados; el único paso externo es vincular el campo seguro o proveedor de secretos de la herramienta seleccionada.

### Cliente listo para la herramienta HTTP

`scripts/manglar-work-client.mjs` encapsula la credencial y el bearer en campos privados. Obtiene token al hacer la primera operación, lo reutiliza hasta poco antes de expirar y renueva una vez ante 401. El proveedor `getClientSecret` se vuelve a consultar en cada renovación, permitiendo adoptar una rotación del almacén seguro sin cambiar el código.

Distribuir `scripts/manglar-work-client.mjs` junto con `shared/src/automationPolling.json`, conservando esas rutas relativas; requiere Node.js 22 o posterior. La API y el helper comparten esa política.

Código a ejecutar **dentro del runtime confiable de la herramienta**, donde `credentialStore` es el adaptador real de su almacén seguro:

```javascript
import { ManglarAutomationClient, getPollingPlan } from './scripts/manglar-work-client.mjs';

const manglar = new ManglarAutomationClient({
  clientId: 'chatgpt-work',
  getClientSecret: () => credentialStore.get('MANGLAR_CLIENT_SECRET'),
});

// El conector autorizado de Gmail/Drive proporciona bytes, sin enviar sus tokens a Manglar.
const { storagePath } = await manglar.upload(downloadedImageBytes, 'image/jpeg');
const created = await manglar.createJob({
  source: 'gmail',
  externalId: `gmail:${mailboxId}:${gmailMessageId}`,
  gmailMessageId,
  clientId: 'automation-e2e-test',
  jobType: 'product',
  preset: 'generic_product',
  inputImages: [{ itemId: 'sku-001', fileName: 'frente.jpg', storagePath }],
});
// Persistir created completo (incluidos jobId, createdAt y pollingDeadlineAt).
// En un runtime persistente, espera con la cadencia correcta y renovación automática:
const status = await manglar.waitForJob(created);
// Devuelve completed/failed/needs_attention; timeout lanza AutomationPollingTimeout.
// Guardar outputs desde status si completed, y gestionar intervención en los otros casos.

// Alternativa para herramientas con scheduler durable (sin proceso esperando):
const plan = getPollingPlan(created);
// Si !plan.done && !plan.timedOut, programar GET /jobs/:id en +plan.delaySeconds.
// Guardar su respuesta y repetir getPollingPlan con ella hasta terminar o timeout.
```

El snippet muestra operaciones de una herramienta; `credentialStore` es un punto de integración, no una API de Work inventada. No se ha creado un conector MCP ni una automatización de Gmail nueva. Este flujo corresponde a la opción confirmada: **script/herramienta HTTP segura**. Los plugins MCP nativos de ChatGPT no aceptan directamente `client_credentials`; necesitarían una conexión OAuth distinta. [Autenticación de plugins de OpenAI](https://developers.openai.com/plugins/build/auth).

## Endpoints OAuth

`POST /api/automation/token`, cuerpo `application/x-www-form-urlencoded` o JSON:

```text
grant_type=client_credentials
client_id=chatgpt-work
client_secret=<inyectado por el almacén seguro>
scope=uploads:write jobs:create jobs:read
```

También se admite HTTP Basic para client ID/secret. No enviar credenciales en query strings. Scopes son opcionales; si se omiten se usa el conjunto autorizado. Solicitar un scope no concedido devuelve 400 `invalid_scope`.

Respuesta, solo para el código confiable de la herramienta:

```json
{"access_token":"BEARER_CORTO","token_type":"Bearer","expires_in":900,"scope":"uploads:write jobs:create jobs:read"}
```

La herramienta usa ese bearer en `/uploads`, `/jobs` y `/jobs/:id`. Los consumidores humanos existentes conservan su soporte de Firebase ID tokens. Ningún access token técnico es un Firebase ID token ni sirve para otros endpoints.

Las respuestas del token endpoint incluyen `Cache-Control: no-store` y `Pragma: no-cache`. Los errores no incluyen credenciales. El límite de emisión es 60 tokens por hora por identidad; se recomienda reutilizar el cliente en el runtime de la herramienta.

No existe un refresh token adicional: en el grant de credenciales de cliente, la renovación consiste en solicitar un nuevo access token con la credencial del cliente. [RFC 6749, sección 4.4](https://www.rfc-editor.org/rfc/rfc6749#section-4.4).

## Persistencia, renovación, rotación y revocación

- Secret original: solo Google Secret Manager / almacén externo seguro.
- Firestore `automationPrincipals`: SHA-256 del secret aleatorio de 384 bits, scopes, clientes permitidos, activo y versión de revocación. El hash es apropiado para una credencial de alta entropía generada por el sistema; no se utiliza para contraseñas humanas.
- Firestore `automationAccessTokens/{sha256(token)}`: identidad, scopes, versión y expiración. No contiene el bearer original.
- Reglas de Firestore: ambas colecciones rechazan cualquier lectura/escritura de clientes.
- Cada llamada comprueba token, expiración, identidad activa, versión, scopes y cliente; no hay autorización basada en claims humanos de la identidad técnica.
- Cada intake comprueba de nuevo el permiso de producción de la identidad. La revocación impide llamadas nuevas; no promete cancelar llamadas al proveedor que ya estén en curso.
- El mantenimiento existente elimina hasta 200 tokens expirados cada cinco minutos. La expiración se valida siempre, independientemente de la limpieza física.

Comandos de **operador autorizado**, con gcloud configurado para este proyecto; nunca se usan como credenciales de Work:

```bash
node scripts/automation-admin.mjs inspect
node scripts/automation-admin.mjs rotate
node scripts/automation-admin.mjs revoke
```

`rotate` genera un nuevo secret, crea una versión de Secret Manager y actualiza sus hashes. Mantiene el anterior durante 24 horas para actualizar el almacén externo sin cortar procesos. El proveedor de secretos de Work debe leer la versión nueva; si el secreto fue copiado a un campo estático, actualizar ese campo seguro. Los access tokens ya emitidos duran como máximo 15 minutos. `revoke` desactiva la identidad e incrementa su versión: todos sus tokens dejan de aceptarse sin esperar su expiración. Los comandos nunca imprimen secretos.

`provision` ya se ejecutó y rechaza sobrescribir una identidad existente; no restaura permisos ni amplía clientes silenciosamente. La ampliación a clientes reales queda pendiente de una solicitud explícita.

## Polling de jobs y revisión independiente de Gmail

El reloj empieza en `createdAt` del job, conservado al repetir POST con la misma idempotencia o reiniciar la herramienta:

- Primera consulta a los 20 segundos; después cada 20 segundos durante los primeros 300 segundos.
- Desde el minuto 5, consultar cada 60 segundos.
- Detener inmediatamente en `completed`, `failed` o `needs_attention`.
- Timeout total de seguimiento: 1800 segundos (30 minutos) desde la creación. No consultar automáticamente después del deadline ni iniciar otro job por timeout. La generación continúa; conservar jobId y consultar manualmente el mismo job si hace falta.

POST `/jobs` y GET `/jobs/:id` incluyen `createdAt`, `pollingDeadlineAt`, `pollAfterSeconds`, `pollingTimedOut` y `pollingPolicy`. `pollAfterSeconds` es 20 o 60 según la edad, acotado al tiempo restante; vale 0 en estado terminal o al agotar el seguimiento. Un cero nunca debe provocar un bucle de consultas inmediatas: comprobar estado/timeout primero. GET sigue disponible después del timeout para recuperación explícita; `pollingTimedOut` no cambia el estado de producción.

`ManglarAutomationClient.waitForJob(created)` aplica la política, admite `AbortSignal`, renueva credenciales y devuelve el estado terminal. En timeout lanza `AutomationPollingTimeout` con jobId y último estado. Para herramientas con scheduler durable, `getPollingPlan(últimaRespuesta)` calcula el próximo intervalo; persistir también `createdAt` y el deadline, no reiniciar un reloj al recuperar el job. El scheduler debe tener resolución de 20 segundos: un heartbeat de Gmail de dos horas no sirve para este seguimiento.

La revisión de Gmail se configura **exclusivamente en el scheduler externo de Gmail**, mediante su propio ajuste `GMAIL_CHECK_INTERVAL_SECONDS` (ejemplo: 7200). Ese ajuste no se utiliza en la política de jobs. Este repositorio no contiene un lector/scheduler Gmail y no crea una nueva automatización externa. Cada correo puede iniciar un seguimiento de job independiente del próximo chequeo de la bandeja.

No es necesario mantener un token activo durante la espera: la siguiente ejecución obtiene otro automáticamente. Las URLs de outputs se firman al consultar el estado y duran 15 minutos; descargarlas en esa ejecución. Si se consumen más tarde, consultar el mismo job para obtener enlaces nuevos. Los intervalos internos de providers y recuperación de jobs no cambian.

## Prueba real y reproducción

La prueba real usa el helper de Work y el secret de la identidad técnica, únicamente el cliente `automation-e2e-test`, una fotografía pública atribuida y el preset `generic_product`. Invoca `/token → /uploads → /jobs → /jobs/:id → descarga de outputs`. Repite POST con el mismo externalId para verificar idempotencia. No simula fal, Gemini ni generación/revisión. No usa las credenciales de operador para generar: gcloud solo permite leer el secret para ejecutar el cliente técnico de prueba.

```bash
node scripts/automation-e2e.mjs start
node scripts/automation-e2e.mjs status
```

`start` se niega a crear otra producción si ya existe el reporte local. El reporte conserva la política histórica de la prueba original (`productionPollIntervalSeconds: 7200`); no describe la política vigente. Las nuevas pruebas registran `productionPollingPolicy`. La política vigente es 20 s / 5 min → 60 s, con timeout de 30 min. El reporte `docs/AUTOMATION_E2E_RESULT.json` no guarda bearers, secrets ni URLs firmadas. Ver ese reporte para IDs, estado real, descargas verificadas y resultado de la prueba.

Fuente del input de prueba: [A white mug filled with warm coffee](https://commons.wikimedia.org/wiki/File:A_white_mug_filled_with_warm_coffee.jpg), Nenad Stojković / Shixart1985, [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). Se reduce la referencia y se producen escenas derivadas mediante IA; la atribución también se registra en metadata del job.

## Tests y despliegue

```bash
npm run lint
npm --prefix functions run lint
npm test
firebase emulators:exec --project demo-manglar-automation --only auth,firestore,storage \
  'node --import tsx --test tests/automation.integration.test.ts'
firebase deploy --project tutofb-260320-1003 \
  --only functions:automationApi,functions:automationIntakeWorker,functions:automationGenerationProgress,functions:recoverAutomationImports,functions:createAutomationJob,functions:retryAutomationJob,firestore:rules
```

Los tests verifican el flujo anterior y el técnico: permisos por cliente/tipo/scope, expiración, nueva emisión, revocación inmediata, ausencia de usuario humano, procesamiento por el worker, cliente HTTP con renovación ante 401 y persistencia sin bearer en claro. No se añaden dependencias ni secrets a archivos `.env`.

## Resultado de esta implementación (16 de octubre de 2026)

Despliegue completado de las seis Functions de automatización y reglas de Firestore. Suite general: 78 aprobadas, cero fallos, un test de integración omitido sin emuladores. Integración en emuladores: 16 comprobaciones aprobadas, cero fallos. El helper también verifica que veinte operaciones paralelas compartan una sola renovación.

Prueba real: job `MZlufWPMjLzp5PNrWwPX`, batch `automation-MZlufWPMjLzp5PNrWwPX`, estado `completed`, cuatro imágenes de 1024×1024 aprobadas en el primer intento y descargadas con HTTP 200. Se verificó la idempotencia con un POST duplicado, la adquisición automática de tokens usando el secret actual y el anterior dentro del período de gracia, y el rechazo HTTP 403 para un cliente no autorizado. No se enviaron trabajos a clientes reales. El costo y detalle de intentos se conservan en el reporte JSON.

La credencial vigente está en la versión `latest` del secret indicado; se probó su rotación sin mostrar ningún valor secreto. La conexión del almacén seguro externo de Work sigue siendo el único paso de configuración fuera del repositorio.

### Corrección de polling (16 de octubre de 2026)

`automationApi` fue desplegada con la política 20 s durante 5 min → 60 s y timeout total de 30 min. Se actualizaron el cliente HTTP, ejemplos y política compartida. Comprobaciones: typecheck frontend y Functions correctos; suite general 82 aprobadas, cero fallos y una integración omitida sin emuladores; integración en emuladores 16 comprobaciones aprobadas, cero fallos. Incluyen cambio de intervalo, reanudación/idempotencia sin reiniciar el reloj, timeout sin cancelar generación, estados terminales y renovación de credenciales.

La consulta real tras el deploy, con la identidad técnica, confirmó la nueva política y `pollAfterSeconds: 0` para el job de prueba terminado, con cuatro outputs. Evidencia sin credenciales ni URLs firmadas: `docs/AUTOMATION_POLLING_VERIFICATION.json`. No se generaron imágenes adicionales ni se cambiaron permisos de clientes. Para adoptar el nuevo seguimiento en Work, actualizar el helper y su archivo JSON en el runtime externo; el scheduler Gmail se configura por separado allí.
