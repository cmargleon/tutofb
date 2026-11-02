# Conexión externa — 2 de noviembre de 2026

## Drive: identidad y permisos configurados

- Proyecto: `tutofb-260320-1003`.
- Identidad dedicada: `automation-drive-reader@tutofb-260320-1003.iam.gserviceaccount.com`, sin claves privadas de usuario.
- APIs Drive e IAM Service Account Credentials habilitadas.
- Rol personalizado `projects/tutofb-260320-1003/roles/automationDriveTokenMinter`: únicamente `iam.serviceAccounts.getAccessToken`.
- El runtime `1003939376366-compute@developer.gserviceaccount.com` tiene ese rol únicamente sobre la identidad dedicada. La concesión temporal al operador para las pruebas fue retirada.
- Carpeta `1g0Z4tXAdhPanKWSGwTUFdv8SdfAGng-K` (SUBIR A SHEIN) compartida explícitamente como `reader` con la identidad dedicada; permiso `08630489120702843332`. Se preservaron los permisos anteriores de la carpeta.
- Parámetro no secreto `AUTOMATION_DRIVE_SERVICE_ACCOUNT` actualizado en la configuración local de despliegue. El importador solicita exclusivamente `drive.readonly` y tokens de diez minutos.
- Despliegue de las once Functions de automatización: API, configuración de clientes, callables de planes/jobs, workers y recuperación.

Prueba del módulo real de Drive contra las APIs reales: validación de la carpeta principal y `1PMPW2YDIbTQ1LwxInkLqR6IDUXbY9NPr` (FOTOGRAFIAS SHEIN), listado de 29 hijos directos (18 imágenes y 11 subcarpetas), descarga y decodificación de una fotografía WebP de 71.550 bytes y 1200 × 800 píxeles. No se generaron imágenes pagadas ni se imprimieron credenciales.

**Asociación completada:** la carpeta principal, FOTOGRAFIAS SHEIN y sus once subcarpetas directas están autorizadas para JISHOP (`5RPUrQKfkERh4josuuvX`). Son trece carpetas. El contrato existente exige autorizar explícitamente cada carpeta que contenga fotografías, sin recorrido recursivo implícito. No se compartieron estas fotografías con otros clientes de negocio.

## ChatGPT Work: servidor del plugin y clientes configurados

El usuario eligió autorizar todos los clientes activos y el de pruebas, y crear un plugin propio. Se habilitaron JISHOP, Barbie, VANS, aMessi, under armor y Manglar Automation E2E (TEST ONLY), conservando preferencias y presupuestos existentes. La lista explícita de `chatgpt-work` contiene esos seis IDs; su cambio de versión revocó los tokens anteriores. El principal conserva los scopes `uploads:write jobs:create jobs:read`.

Se utilizó el servicio backend de configuración para validar carpetas, modelos y presupuestos; la autorización se actualizó con `scripts/automation-admin.mjs set-clients`. El documento antiguo “Under Armour” que no tiene estado activo no se incluyó. Los clientes futuros requieren autorización explícita.

El plugin añade siete herramientas MCP y un flujo OAuth con PKCE, consentimiento de un administrador activo, access tokens de quince minutos, renovación rotatoria y conexiones revocables de treinta días. El plugin no necesita recibir ni copiar el secreto técnico anterior. El paquete, instrucciones y resultados de producción se encuentran en [MANGLAR_CHATGPT_PLUGIN.md](MANGLAR_CHATGPT_PLUGIN.md) y `MANGLAR_PLUGIN_VERIFICATION.json`.

Despliegue completado de `manglarMcp`, las cuatro callables de consentimiento/listado/revocación, `automationApi`, `updateClientAutomation`, Hosting y reglas/TTL de Firestore. Verificación pública en producción: discovery OAuth, inicialización MCP, siete herramientas, rechazo HTTP 401 sin conexión, verificación del CIMD real de ChatGPT y acceso a la pantalla de consentimiento. Una aprobación anónima fue rechazada con HTTP 401.

Verificación autenticada del helper HTTP en producción: los seis clientes aparecen habilitados; JISHOP lista dieciocho fotografías reales en FOTOGRAFIAS SHEIN. Intentar consultar esa misma carpeta para Barbie devuelve HTTP 403. No se enviaron pedidos ni se generaron imágenes durante estas comprobaciones.

**Vinculación personal completada y verificada:** el usuario añadió y autorizó el plugin. Firestore confirma una concesión activa de administrador para el recurso y la versión vigentes, y credenciales de acceso y renovación válidas. Los logs de producción confirman el intercambio OAuth de OpenAI con HTTP 200 y las llamadas posteriores de su cliente MCP con respuestas correctas. No hubo errores de servidor en los treinta minutos revisados. Evidencia sin credenciales: `MANGLAR_NATIVE_LINK_VERIFICATION.json`.

La comprobación de la vinculación usa los registros reales de autorización y del servidor. No se efectuó desde este chat una llamada de negocio con las credenciales del plugin ni se inició una generación pagada. Las pruebas anteriores de clientes y Drive se conservan por separado. El informe `MANGLAR_PLUGIN_VERIFICATION.json` corresponde al smoke test histórico previo a la vinculación; el informe nativo posterior registra su finalización.

## Validación local

Typechecks y builds de frontend y Functions correctos. Suite general: 123 pruebas aprobadas y tres suites que requieren emuladores omitidas; se ejecutaron aparte las 37 pruebas existentes de integración y diez comprobaciones OAuth/MCP, todas aprobadas. La prueba de navegador de consentimiento y revocación también pasó y se revisó su captura móvil. Functions se compiló antes de las pruebas. No se modificaron dependencias ni secretos, y no hubo generaciones pagadas en producción.
