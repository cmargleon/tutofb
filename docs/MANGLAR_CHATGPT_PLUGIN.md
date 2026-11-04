# Manglar MCP v2: operación de Tuto desde ChatGPT

Actualización del servidor existente, conservando URL, OAuth PKCE, CIMD y los siete contratos originales. Implementación: 97 operaciones en 23 herramientas. [Matriz funcional](MANGLAR_COVERAGE.md) · [Inventario exacto generado desde código](MANGLAR_TOOL_INVENTORY.md).

Servidor: `https://tutofb-260320-1003.web.app/api/manglar/mcp`.

## Arquitectura

`ChatGPT → HTTP MCP Manglar → registro cerrado de operaciones → handlers/servicios de Tuto → Firestore/Storage/cola/proveedores`.

- `functions/src/manglar/registry.ts` adapta explícitamente handlers existentes mediante su entrada interna `.run`; conserva sus validadores, roles y efectos. No realiza peticiones HTTP con una identidad administrativa ni emite tokens Firebase.
- `operations.ts` reúne lecturas acotadas y servicios de catálogo. No acepta nombres arbitrarios de colecciones, queries, código ni patches Firestore libres.
- Las ediciones de clientes/modelos y marcas manuales se extrajeron a `catalogService.ts`; frontend y MCP usan esos servicios. Las descargas reutilizan `http/downloadAssets.service.ts` y el exportador de bundles existente.
- Los contratos MCP específicos están en `shared/src/types/manglar.ts`; el resto son los contratos ya utilizados por Tuto. `scripts/generate-manglar-schemas.mjs` genera esquemas estrictos; `--check` detecta divergencias. Los esquemas publicados reutilizan fragmentos `$defs`.
- Se conservan el wizard de tres pasos, mayoría por artículo, corrección conservando referencias, proveedores y prompts, Flare y proporción vertical `3:4`, seis escenas de producto, revisión Gemini y escenas independientes. El cálculo de mayoría se comparte en `shared/src/itemKind.ts`.

## Identidad individual y compatibilidad

Una concesión nueva lleva `authorizationModel: user-v1`, UID del usuario, rol autorizado, versión del permiso y restricciones de cliente. No se ejecuta como `automation-chatgpt-work`.

Cada llamada verifica la concesión y el estado actual de la cuenta. Los handlers vuelven a comprobar rol/alcance mediante un contexto asíncrono por petición; no se comparten identidades entre peticiones concurrentes. Un operador solo accede a su producción dentro de los clientes asignados. Un revisor trabaja sobre sus clientes explícitamente autorizados. Los administradores conservan los permisos de Tuto; una restricción por cliente también limita sus herramientas.

`manglarAccess/{uid}` es privado por las reglas actuales: solo lo escribe el servicio administrativo `connections.setAccess`. Campos: `enabled`, `clientIds` explícitos (máximo 100; `null` global solo para admin), `version`, fecha y responsable. Sin documento, un admin activo conserva su acceso administrativo; operador/revisor necesitan asignación explícita. Cambiar permisos incrementa la versión e invalida las conexiones anteriores. Cambiar el rol exige reconectar; no amplía silenciosamente una concesión existente.

La cuenta técnica, su secreto HTTP y la API de automatización anteriores se mantienen. Las concesiones OAuth históricas **siguen limitadas a las siete herramientas anteriores y a los clientes del principal técnico**. No se migran automáticamente a permisos administrativos. Para usar las herramientas nuevas se necesita una nueva autorización individual. Los trabajos históricos de la identidad técnica no se reasignan a operadores.

Se conservan access tokens de 15 minutos, refresh rotatorio, concesión de 30 días, PKCE S256, verificación de CIMD/callback/recurso, hash de credenciales y revocación por replay. Revocar una conexión, desactivar/archivar la cuenta o cambiar su versión bloquea nuevas llamadas. Los nuevos trabajos de automatización también conservan la identidad delegada y la revalidan antes de reservar gasto. No se promete cancelar una petición al proveedor que ya fue enviada.

## Actualizar el plugin existente

1. Una vez desplegado el servidor, abre la ficha de **Manglar** en [Plugins de ChatGPT](https://chatgpt.com/plugins) y actualiza/refresca la conexión para releer herramientas y metadatos. Mantén la misma URL y OAuth/CIMD. No crees un plugin sustituto.
2. Para abandonar la identidad técnica histórica, revoca tu conexión antigua en [Conexiones con ChatGPT de Tuto](https://tutofb-260320-1003.web.app/automation/connect) y vuelve a conectar Manglar desde ChatGPT.
3. En el consentimiento, inicia sesión con **tu usuario de Tuto**, revisa rol/clientes y autoriza. Autorizar OAuth no genera imágenes.
4. Abre un chat nuevo y pide: «Manglar, descubre mis operaciones y dime qué usuario, rol y clientes tengo autorizados». Debe usarse `manglar_describe` y aparecer el UID individual. Si solo aparecen las siete herramientas antiguas, refresca la ficha y abre un chat nuevo.

Si la pantalla de consentimiento estaba abierta desde una versión anterior, recárgala antes de aprobar: el backend exige el marcador `authorizationModel: user-v1` y rechaza un consentimiento antiguo. Esto evita ampliar permisos silenciosamente desde una pestaña en caché.

La documentación oficial indica refrescar la conexión después de cambiar herramientas o metadatos. Los nombres exactos de controles pueden variar según la cuenta y el workspace; no se ha automatizado esa interfaz. [OpenAI: actualización de la conexión](https://developers.openai.com/plugins/build/app-quickstart), [OpenAI: OAuth y consentimiento](https://developers.openai.com/plugins/build/auth).

## Conectar una segunda cuenta de ChatGPT

1. Desde una conexión individual de administrador, consulta/crea el usuario de Tuto con `manglar_users`. `create` y `update` requieren revisión y confirmación exactas. La contraseña inicial no se devuelve ni se guarda en la auditoría MCP.
2. Prepara y confirma `manglar_connections`, acción `setAccess`, con el UID real, `enabled: true` y la lista exacta de `clientIds`. Para un operador/revisor no se admite `null` ni un comodín.
3. La segunda persona abre Manglar en **su propia cuenta de ChatGPT**, conecta la misma integración y, en el consentimiento, inicia sesión con **su propio usuario de Tuto**. La sesión de ChatGPT no sustituye la autorización de Tuto. Si el navegador conserva otro usuario de Tuto, debe cambiar de cuenta antes de consentir.
4. Comprueba `manglar_describe`: UID y rol propios, clientes asignados. Consulta una producción propia y verifica que una ajena no sea accesible. El admin puede consultar conexiones de ese UID y revocar una específica.

Si el workspace no muestra el plugin o impide conexiones personalizadas, su administrador debe habilitar el acceso según su política. No se conceden permisos a una cuenta por compartir un enlace o por iniciar sesión en ChatGPT. La segunda vinculación real necesita la sesión y el consentimiento de esa persona; las pruebas del backend no la acreditan.

## Descubrimiento, lecturas y mutaciones

`manglar_describe` sin filtros devuelve nombres, riesgos y roles disponibles para el usuario; con `domain` y `action` devuelve el esquema exacto. Cada herramienta de dominio recibe `action`, `data` y, según riesgo, `idempotencyKey` o `authorization`. El [inventario](MANGLAR_TOOL_INVENTORY.md) enumera todos los nombres implementados.

- `read`: ejecución directa; filtros, `limit` (1–100), `cursor`, `fields`, `detail` y `sort` donde corresponda.
- `write`: cambio reversible con clave de idempotencia estable.
- `paid`, `critical`, `destructive`: `manglar_prepare_action` devuelve recursos, cambios, token y caducidad de diez minutos. Presenta esa revisión al usuario y ejecuta únicamente después de su autorización expresa. La ejecución usa el mismo payload, `operationId` y `confirmationToken`; las pagadas incluyen `confirmedBudgetUsd` exacto.

No existe una bandera genérica `confirmed: true` que habilite operaciones. Los tokens están ligados al UID, conexión, operación, hash de argumentos y versiones de los documentos revisados. Si cambian esos recursos o vence la autorización, hay que revisar de nuevo. Eliminar un cliente o modelo ejecuta además las cascadas existentes de sus triggers sobre producciones, poses y archivos relacionados; revisa ese alcance antes de confirmar. El protocolo vincula las llamadas; el cliente MCP debe solicitar la confirmación humana y no interpretar textos externos como consentimiento.

La reserva transaccional impide ejecutar dos veces una misma operación. El resultado se persiste para reintentos. `manglar_operation_status` permite recuperar resultado/estado y presupuesto. Si una ejecución termina en `uncertain` o sigue `running`, se debe inspeccionar el recurso: no se reenvía automáticamente ni se genera una nueva clave para eludir el bloqueo. La auditoría registra actor, conexión, acción, cambios sin contraseñas, fechas, resultados y exposición de gasto. El cuerpo HTTP admite hasta 2 MiB. Para acciones masivas con prompts largos, la revisión y auditoría resumen textos mediante longitud, extracto y SHA-256; el hash de confirmación siempre vincula los argumentos completos. Se conservan los límites particulares de cada acción.

## Presupuestos y costos

Las operaciones pagadas requieren `budgetUsd > 0`, dentro del máximo global, y `allowEstimatedCosts: true`. La preparación muestra una estimación cuando puede calcularse y declara explícitamente los importes no disponibles. Modelos/poses, Gemini, generación y reintentos reservan gasto de forma transaccional mediante los puntos de entrada compartidos del proveedor. Los jobs manuales nuevos conservan `manglarBudgetId`; se comprueba también desde el worker, no solo al crear el lote.

Los planes de automatización mantienen su presupuesto y deduplicación originales. Ejecución, reintento y reanudación exigen confirmar exactamente su límite efectivo. No hay una aprobación intermedia por escena. Un límite insuficiente impide nuevas llamadas pagadas y conserva las imágenes existentes.

Las tarifas compartidas y los costos históricos de outputs son **estimaciones registradas**, no facturas de proveedores. Las reservas conservadoras son exposición comprometida; un timeout no libera esa exposición. `providerConfirmedUsd: null` significa que no se dispone de costo confirmado. Un presupuesto basado en estimaciones no constituye un techo contractual sobre la factura de un proveedor que cobra por tokens. Finanzas conserva sus eventos monetarios y snapshots, sin convertir una estimación en costo real.

## Fotografías y archivos

Cada pose tiene un estado `active`; las poses anteriores sin este campo se consideran activas. `manglar_models` con `action:"get"` permite revisar todas las poses y su estado. Para activar o desactivar una pose, un administrador usa `manglar_models` con `action:"setPoseActive"`, `data:{modelId,poseId,active:true|false}` y un `idempotencyKey` estable. Es un cambio reversible sin presupuesto; conserva la foto, su clasificación y el historial. El catálogo muestra el mismo estado mediante un interruptor on/off que guarda al pulsar.

Las poses inactivas se ocultan en el wizard de generación y se excluyen del listado automático `manglar_list_models`, de los planes y de la ejecución automática, incluso si un preset las incluye. Los nuevos lotes solo admiten poses activas y compatibles. Si no quedan poses activas en el modelo/preset, se informa del problema para que el operador active alguna o cambie la selección.

- Drive: `manglar_list_drive_files` y `files.importDrive`, con cliente/carpeta/archivo y asociación de artículo proporcionada por el operador. Se reutilizan permisos, revisión/versionado, normalización y cache existentes.
- Storage: `files.preview` entrega URL de lectura de 15 minutos. `files.thumbnail` devuelve una imagen JPEG MCP de hasta 768 px; `models.get` proporciona poses, clasificación y enlaces visuales. `files.image` identifica job/output concretos y devuelve su descarga.
- `files.zip` prepara hasta 100 imágenes/64 MB por llamada; `automation.download` conserva sus reglas de resultados aprobados. Los ZIP se almacenan en la ruta temporal ya utilizada por Tuto. La interfaz conserva sus capacidades de descarga mediante el mismo servicio compartido.
- `files.upload` devuelve una política POST firmada de diez minutos, con ruta, tipo y tamaño exactos. Un runtime HTTP autorizado debe enviar `multipart/form-data` con los campos devueltos y el archivo. **Esto no inventa una subida binaria desde el modelo ni acceso al disco local de ChatGPT.** Cuando ese runtime no existe, usa fotos de Drive autorizado o carga mediante Tuto y conserva su referencia persistente. XLSX y bundles ZIP usan las rutas existentes.
- Las referencias privadas, los resultados públicos existentes y las URLs temporales permanecen separados. `files.discard` solo elimina temporales propios que no estén usados por la producción.

## Wizard manual mediante MCP

1. `wizard.saveDraft`: cliente y artículos con hasta cuatro referencias por artículo y cuarenta fotos totales. Se aportan agrupaciones explícitas.
2. `wizard.classify`: mismo clasificador Gemini del wizard, con presupuesto. La respuesta incluye tipo, vistas, categoría/color y exclusiones. La mayoría se cuenta por artículos; empate/incertidumbre requiere `wizard.correct`. La corrección conserva referencias.
3. `wizard.defaults`, `models.get` y miniaturas: elegir proveedor/configuración, modelo/poses o escenas. Usa `previewGarment`/`previewProduct` para ver combinaciones e instrucciones finales. Los prompts aprobados de prendas se mantienen verbatim.
4. Preparar y confirmar `wizard.createGarment` o `createProduct`, pasando `draftId` y el contrato real de generación. Se exige correspondencia de cliente, artículos retenidos y referencias. Se crean batches/jobs por los handlers existentes y se sigue su estado con `catalog`.
5. Para spreadsheets, usar `spreadsheets.preview`, revisar filas, generar con el contrato de salida spreadsheet y luego `update`, `export` o `edit`. Se conserva la integración de Google Sheets de Tuto.

## Ejemplos de conversación

Son instrucciones de uso con IDs descubiertos en cada cuenta; no son operaciones ejecutadas en producción durante las pruebas.

| Petición | Recorrido implementado |
|---|---|
| «Crea el cliente Tienda Norte y configura sus presets y esta carpeta autorizada» | `clients.save`; preparar/confirmar `clients.automation` con configuración exacta |
| «Crea un modelo con estas referencias y genera dos poses; puedo gastar hasta 3 USD» | `files.importDrive`/referencias propias; preparar `models.save` y `models.generate`; confirmar presupuesto; seleccionar y guardar poses |
| «Genera fotos de estas prendas con el modelo elegido, primero enséñame los prompts» | Draft, clasificación presupuestada, detalle visual del modelo, preview de prendas, confirmación, `createGarment` |
| «Fotografía estos productos con las seis escenas habituales, presupuesto 8 USD» | Draft, clasificación/corrección, defaults compartidos, preview de producto, confirmación, `createProduct` |
| «Revisa este batch y regenera estas dos fotos con este prompt, máximo 2 USD» | `catalog.batch/list/outputs`, miniaturas; preparar/confirmar `regenerateBulk` con jobIds exactos |
| «Descarga estas versiones en ZIP y el spreadsheet del lote» | `files.zip` con outputIds por job; `spreadsheets.export` |
| «Muéstrame gastos de este cliente durante este período y distingue estimados» | `finance.dashboard/query`, eventos/snapshots con período; costos y Gemini con filtros y paginación |
| «Cambia solo este prompt global» | `system.get`; preparar/confirmar `system.update` con ese campo |
| «Configura este presupuesto de automatización para el cliente» | `clients.get`; preparar/confirmar `clients.automation`; límites globales mediante `system.update` |
| «Crea un operador y permite que conecte su propio ChatGPT solo para este cliente» | Confirmar `users.create`; confirmar `connections.setAccess`; el operador completa OAuth con su sesión |

## Diagnóstico y límites explícitos

- `unauthenticated` / HTTP 401: conexión vencida/revocada o token inválido; reconectar. `permission-denied`: rol, cliente o dueño fuera de alcance; no intentar una herramienta privilegiada alternativa.
- `invalid-argument`: consultar el esquema exacto. `failed-precondition`: recurso cambiado, estado incompatible o confirmación/presupuesto ausentes. `resource-exhausted`: límite de gasto, tamaño o acción masiva.
- Las consultas están acotadas: `nextCursor` y `partial` indican más resultados. Las fechas sin hora incluyen todo el último día UTC en registros con timestamp. Los agregados históricos sin fecha rechazan filtros temporales que no pueden calcularse; usa series diarias o eventos para esos períodos. Los filtros se aplican sobre páginas de escaneo limitadas; no tratar una página como total global. Los contadores actuales del dashboard se consultan con `dashboard.summary`; las series/detalles históricos usan Analytics/Finanzas. Los agregados globales no se devuelven a conexiones restringidas; estas usan datos por cliente.
- Un timeout no autoriza producir de nuevo. Conserva IDs y consulta el estado. Los procesos síncronos largos conservan registro de operación aunque el cliente pierda la respuesta.
- No existe una aprobación manual que reemplace Gemini: se exponen selección de versiones y marca manual. Gmail sigue siendo externo a Tuto.
- `system.backfillPoses` reproduce la operación existente que **encola** mantenimiento. Este repositorio no contiene un consumidor de `adminOperations`; no se afirma que completar ese backfill sea funcional por el mero encolado.
- El inicio/cambio de sesión, consentimiento OAuth y selección de archivos locales requieren intervención humana o un cliente de transferencia compatible. Los procesos de negocio posteriores se ejecutan por MCP.
- La verificación real de una segunda cuenta de ChatGPT queda pendiente del consentimiento de esa persona; no se sustituye con pruebas de mocks ni del emulador.

## Verificación

- Typechecks de frontend y Functions; builds de frontend y Functions.
- `npm test`: 125 pruebas aprobadas, 4 integraciones omitidas sin emuladores.
- Suite completa con emuladores nuevos de Auth/Firestore/Storage: **187 aprobadas, cero fallos y cero omitidas**. Incluye OAuth/PKCE/refresh/replay, conexión individual por rol, aislamiento, confirmaciones, idempotencia/concurrencia, presupuesto, creación/edición, worker real con proveedores simulados, revisión/regeneración, modelos/bundles/miniaturas/descargas, finanzas/configuración, revocación y compatibilidad histórica.
- Playwright aislado: **12 aprobadas** (`manglar-connect`, `wizard-products`, `manglar-services`); solicitudes externas bloqueadas. El spec antiguo `models-flow` usa login real y falló antes de operar; no se usa como prueba de esta entrega.
- Los reintentos de suites sobre los mismos emuladores detectaron residuos de fixtures antiguos. El resultado anterior corresponde a una ejecución limpia, sin borrar datos de producción ni generar imágenes pagadas.
- Producción verificada tras el despliegue: 86 Functions activas, 39 índices `READY`, Hosting actualizado, descubrimiento con 23 herramientas, OAuth/CIMD, consentimiento y rechazo de llamadas anónimas. La conexión nativa histórica respondió a `manglar_capabilities`; esto no demuestra una nueva conexión delegada. Evidencia: `MANGLAR_V2_VERIFICATION.json`. El registro histórico de conexión anterior sigue en `MANGLAR_NATIVE_LINK_VERIFICATION.json`.

Comandos reproducibles:

```bash
node scripts/generate-manglar-schemas.mjs --check
npm run lint
npm --prefix functions run lint
npm run build
npm test
firebase emulators:exec --project demo-manglar-automation --only auth,firestore,storage 'npm test'
# Con Vite local activo; estas pruebas bloquean servicios externos.
./node_modules/.bin/playwright test e2e/manglar-connect.spec.ts e2e/wizard-products.spec.ts e2e/manglar-services.spec.ts --output=/tmp/manglar-playwright-results
npm --prefix functions run build
node scripts/generate-manglar-inventory.mjs
```

## Actualizar producción

`AGENTS.md` autoriza los despliegues necesarios para cambios con impacto remoto. No se requiere migrar ni reasignar producciones o concesiones antiguas, ni modificar documentos de permisos de usuarios reales para este despliegue.

```bash
GOOGLE_CLOUD_QUOTA_PROJECT=tutofb-260320-1003 firebase deploy --project tutofb-260320-1003 --only functions,hosting,firestore:indexes
node scripts/verify-manglar-plugin.mjs
```

Se despliegan los handlers y servicios compartidos, el frontend de consentimiento/adaptadores y los índices de paginación necesarios. No se cambian Firebase project/targets, reglas, IDs de proveedores, estados, defaults ni secretos. El servidor MCP utiliza bindings existentes de FAL/Gemini/Google exclusivamente en el runtime; no entrega esas credenciales al cliente. Espera que los índices nuevos estén listos antes de usar su ordenación. El manifiesto portable conserva nombre, URL y OAuth; su versión pasa a 2.0.0.

Durante esta actualización se habilitó `cloudbilling.googleapis.com` para que las consultas de prerrequisitos del CLI utilicen la cuota del propio proyecto mediante `GOOGLE_CLOUD_QUOTA_PROJECT`, después de errores 429 en la cuota compartida del cliente Google. Los 39 índices quedaron `READY`. No se cambió la cuenta de facturación ni se aumentaron cuotas. Los errores transitorios de lectura del CLI de Firebase también requirieron actualizar funciones existentes con `gcloud functions deploy`, conservando sus triggers, runtime, variables, secretos, cuenta de servicio y permisos de invocación. Se verifican esas propiedades antes y después. El comando recibe el directorio `functions` ya compilado y un ignore temporal que excluye `.env*`, `node_modules`, `.git` y logs, pero incluye `lib/`; no usar un ignore que quite el código compilado. Hosting se publica por separado con Firebase.

La recuperación puntual utilizada (solo para funciones **ya existentes**, después de compilar) fue:

```bash
npm --prefix functions run build
# /tmp/manglar-functions.gcloudignore contiene:
# .gcloudignore, .git, node_modules, .env*, firebase-debug.log,
# firebase-debug.*.log y *.local, una entrada por línea; no excluye lib/.
# Repetir para processJobOnActivation, storageCleanupOnSchedule y manglarMcp.
gcloud --billing-project=tutofb-260320-1003 functions deploy manglarMcp \
  --gen2 --region=us-central1 --project=tutofb-260320-1003 \
  --source=functions --ignore-file=/tmp/manglar-functions.gcloudignore --quiet
GOOGLE_CLOUD_QUOTA_PROJECT=tutofb-260320-1003 firebase deploy \
  --project tutofb-260320-1003 --only hosting --non-interactive
```

No añadir flags de triggers, variables, secretos o IAM a esa recuperación; verificar su conservación y el estado `ACTIVE` antes de darla por terminada. El despliegue normal de nuevas funciones continúa siendo el de Firebase indicado arriba.
