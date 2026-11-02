# Plugin privado de Manglar para ChatGPT

## Instalar y vincular

El servidor está en `https://tutofb-260320-1003.web.app/api/manglar/mcp`.

1. Abre [Plugins de ChatGPT](https://chatgpt.com/plugins), pulsa **+** y **Add custom MCP server**.
2. Nombre: **Manglar**. URL: la indicada arriba. Autenticación: **OAuth**. Usa **CIMD / Client ID Metadata Document** si aparece la selección de registro de cliente; el servidor publica esa capacidad mediante discovery.
3. Revisa el formulario y selecciona **Create as a plugin**. No introduzcas el secreto de `client_credentials`, claves de Firebase ni claves de Google Cloud.
4. Conecta el plugin, inicia sesión con tu administrador de Manglar y revisa la lista de clientes antes de pulsar **Autorizar ChatGPT**. Regresa a ChatGPT, abre un chat nuevo y selecciona **@Manglar**.

La última vinculación requiere la sesión del usuario en ChatGPT. Computer Use rechazó el control de la aplicación ChatGPT por seguridad; no se intentó eludir esa restricción. El paquete portable está en `plugins/manglar/`, con `plugin.json` y `mcp.json`, sin credenciales. Registrar un servidor privado no publica el plugin en el directorio público.

## Acceso y operación

- Cliente técnico: `chatgpt-work`, conservando su lista explícita y los contratos de automatización existentes.
- Clientes con `status: active` autorizados el 2 de noviembre de 2026: JISHOP, Barbie, VANS, aMessi, under armor y Manglar Automation E2E (TEST ONLY). No hay comodines ni autorización automática de clientes futuros. El documento antiguo “Under Armour” sin estado activo no se incluyó.
- La carpeta SUBIR A SHEIN, FOTOGRAFIAS SHEIN y sus once subcarpetas directas están autorizadas únicamente para JISHOP. Otros clientes no reciben acceso a esas fotografías. La integración admite hijos directos de cada carpeta autorizada; niveles adicionales requieren configuración explícita.
- Herramientas: capacidades/clientes, fotografías de Drive, modelos/poses, preparar plan, consultar plan, ejecutar plan y consultar producción/resultados aprobados.
- Preparar un plan es gratuito. Para ejecutar, el usuario debe autorizar el presupuesto y la herramienta exige que `confirmedBudgetUsd` coincida con el límite del plan. Los presupuestos y permisos se vuelven a comprobar en el flujo existente.
- Conserva `externalId`, `planId` y `jobId`; repetir la ejecución del plan devuelve el mismo trabajo. Cada foto debe tener un `itemId` aportado por el operador. No se infieren artículos a partir de nombres de archivos ni de la carpeta.
- El seguimiento mantiene la cadencia existente: 20 segundos durante cinco minutos y luego 60, con máximo de 30 minutos. Un timeout no crea otro pedido.

## Autenticación y revocación

La conexión usa el inicio de sesión de Firebase de Manglar como identidad del administrador y un flujo OAuth authorization code con PKCE S256. El servidor verifica el documento CIMD real de ChatGPT y sus callbacks exactos, el recurso, el cliente y el verificador PKCE. No hay registro abierto de callbacks ni URLs arbitrarias.

Los códigos duran dos minutos y se consumen transaccionalmente. Los access tokens duran quince minutos; los refresh tokens rotan en cada renovación y vencen al finalizar los treinta días de la conexión. La reutilización de un refresh token revoca toda esa conexión. Firestore guarda hashes de credenciales, nunca sus valores originales. Las reglas deniegan el acceso cliente a `automationOAuth`; la política TTL sobre `expiresAt` elimina los documentos vencidos y la expiración se valida aunque la limpieza se demore.

Solo un administrador activo puede autorizar. Cada operación comprueba de nuevo su estado/rol y la versión, clientes y scopes de la identidad técnica. Desactivar al administrador, revocar la conexión o cambiar la versión del principal invalida el acceso. El plugin no utiliza ni recibe `MANGLAR_WORK_CLIENT_SECRET`; el helper HTTP anterior conserva su autenticación independiente.

Administra y revoca tus conexiones en [Manglar → Conexiones con ChatGPT](https://tutofb-260320-1003.web.app/automation/connect). Revocar bloquea llamadas nuevas; no cancela una petición al proveedor que ya esté en curso.

## Validación y mantenimiento

`npm test`, typechecks y builds de frontend y Functions. Las suites existentes de automatización pasan en emuladores. `tests/manglarMcp.test.ts` verifica discovery, PKCE, callbacks, recurso, scopes, clientes, códigos de un solo uso, rotación, revocación, roles y reglas. `e2e/manglar-connect.spec.ts` prueba consentimiento y revocación en navegador con datos simulados y sin acceso a Firebase real.

Prueba de discovery y autenticación en producción, sin credenciales ni generación pagada:

```bash
node scripts/verify-manglar-plugin.mjs
```

El resultado queda en `docs/MANGLAR_PLUGIN_VERIFICATION.json`. Ese registro distingue las pruebas del servidor de la vinculación efectiva en ChatGPT; no marca la conexión del usuario como completada.

El usuario completó después la vinculación. La comprobación de la concesión activa y las llamadas reales del cliente de OpenAI queda en `docs/MANGLAR_NATIVE_LINK_VERIFICATION.json`; es independiente del smoke test anterior y no contiene credenciales.

Configuración por operador autorizado, después de compilar Functions:

```bash
node scripts/automation-admin.mjs enable-client CLIENT_ID [FOLDER_ID...]
node scripts/automation-admin.mjs set-clients CLIENT_ID...
```

`enable-client` conserva la configuración existente, valida carpetas/modelos/presupuestos con el mismo servicio backend de la aplicación y activa únicamente el cliente indicado. `set-clients` exige IDs explícitos previamente habilitados e invalida los tokens anteriores mediante la versión del principal. El operador usa su sesión de Google Cloud; esa credencial nunca se transfiere a Work.

Referencias: [autenticación de plugins](https://developers.openai.com/plugins/build/auth), [instalación de un servidor MCP privado](https://developers.openai.com/plugins/quickstart), [paquete portable](https://developers.openai.com/plugins/build/plugins).
