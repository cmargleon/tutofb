# Automatización multicliente: implementación y operación

Fecha: 1 de noviembre de 2026. Base local auditada: `051449a`. Esta entrega incorpora la modificación posterior: **todas las escenas se procesan independientemente**. No hay una primera escena condicionante ni controles para aprobar la continuación.

## 1. Funcionalidades existentes reutilizadas

Se conservaron OAuth `client_credentials`, `machineAuth`, tokens de 15 minutos, scopes, listas explícitas de clientes y tipos, `/uploads`, claves de idempotencia, reservas de intake, recuperación programada y el cliente HTTP con polling 20 s durante cinco minutos y 60 s después, hasta 30 minutos.

Las generaciones siguen pasando por los cores de creación de batches, los documentos `jobs`, los adapters actuales, `jobWorker`, Gemini y `jobs/{jobId}/outputs` y `logs`. Se reutilizan el catálogo de proveedores y costos, configuración de imagen, prompts globales, escenas compartidas, resolución de Storage y funciones de descarga. Las finanzas siguen recibiendo outputs y `analytics_gemini_usage` mediante sus triggers habituales; las reservas de automatización sirven para controlar admisión de gasto y no son otra contabilidad.

## 2. Funcionalidades implementadas

- Configuración de automatización por cliente, carpetas Drive y presets con modelo, poses, proveedor, parámetros de imagen, prompts y escenas.
- Drive API v3: autorización por carpeta y cliente, metadatos, revisiones/versiones, normalización JPEG/PNG/WebP, caché de referencias y errores por archivos movidos, eliminados o modificados.
- Planes persistentes sin generación ni clasificación pagada durante su preparación; ejecución idempotente de todo el pedido.
- Reservas de capacidad de gasto transaccionales antes de generación, revisión y clasificación; conciliación idempotente y pausa persistente si una operación no cabe.
- Escenas independientes con tres intentos de calidad por defecto y reintentos operativos separados. Un rechazo definitivo conserva sus outputs y permite continuar a las otras escenas y artículos.
- Revisión contra el prompt final exacto de cada intento y todas las referencias originales aplicables, correcciones completas sin añadir nuevamente instrucciones.
- Análisis pagado de prendas autorizado explícitamente y reutilizado en reintentos con las mismas referencias. La clave de caché incluye la huella de la imagen normalizada.
- Reanudación por presupuesto; si solo falta revisar una imagen guardada, se reutiliza el mismo output, sin otra generación ni otro cargo de generación.
- Respuestas compactas por artículo/escena, costos, presupuesto, incidencias, acceso al lote exacto y ZIP de aprobadas con manifiesto.
- Configuración y seguimiento en las pantallas existentes de Clientes, Sistema y Automatización.

## 3. Archivos modificados

Los módulos principales nuevos son:

- `shared/src/automationPolicy.ts`.
- `functions/src/automation/budget.ts`, `clientConfig.ts`, `drive.ts`, `plans.ts`, `recovery.ts`, `results.ts`.
- `src/features/automation/useAutomationBudgetSettings.ts`, `useClientAutomationConfig.ts`.
- `src/components/automation/AutomationBudgetSettings.tsx`, `src/components/clients/ClientAutomationSection.tsx`.
- `tests/automationPolicy.test.ts`, `tests/automationAdvanced.integration.test.ts`.
- `e2e/automation-navigation.spec.ts`, `e2e/automation-settings.spec.ts`.

Se ampliaron los contratos de automatización, cliente, job y SystemConfig; los módulos existentes de automatización; los cores de batches con overrides exclusivos para automatización; worker, helpers de regeneración, revisión y registro Gemini; configuración global; reglas; cliente HTTP y script administrativo. Se modificaron las pantallas de Automatización, Configuración y Catálogo, junto a sus accesos Firebase y componentes de clientes. El registro completo de archivos está en `reports/AUTOMATION_V2_VERIFICATION.json`.

No se editaron los componentes, hooks, estado, submit, prompts, defaults ni pasos del wizard. La prueba E2E de prompts ahora espera la persistencia efectiva antes de recargar, en vez de reutilizar un toast anterior como señal.

## 4. Contratos y endpoints

Base: `https://tutofb-260320-1003.web.app/api/automation`.

| Método | Ruta | Scope técnico | Resultado |
| --- | --- | --- | --- |
| POST | `/token` | Credencial del cliente | Bearer corto; no Firebase ID token |
| GET | `/capabilities` | `jobs:read` | Clientes expresamente permitidos, proveedores, presupuestos y límites de entrada |
| GET | `/clients/:clientId/drive/:folderId` | `jobs:read` | Archivos y versiones de una carpeta autorizada; requiere asociación explícita con itemId |
| POST | `/plans` | `jobs:create` | Preparar/deduplicar un plan sin llamadas pagadas |
| GET | `/plans/:id` | `jobs:read` | Resumen guardado, configuración, escenas y estimación |
| POST | `/plans/:id/execute` | `jobs:create` | Crear/deduplicar un solo pedido y devolver datos de polling |
| POST | `/uploads` | `uploads:write` | Alternativa de subida de bytes |
| POST | `/jobs` | `jobs:create` | Intake directo existente, ahora con política de presupuesto |
| GET | `/jobs/:id` | `jobs:read` | Estado agregado, artículos, escenas, outputs aprobados, presupuesto e incidencias |
| POST | `/jobs/:id/retry` | `jobs:retry` | Reintentar intake sin batch, dentro de límites operativos |
| POST | `/jobs/:id/resume` | `jobs:retry` | Reanudar escenas detenidas por presupuesto, sin reiniciar escenas aprobadas |
| GET | `/jobs/:id/download` | `jobs:read` | ZIP autenticado de resultados aprobados y `manifest.json` |

`GET /plans/:id?includePrompts=true` incluye el prompt configurado y las instrucciones de escenas. Por defecto no se devuelven prompts extensos, bytes ni base64. En prendas, el prompt final por escena se compone después de la clasificación autorizada; el plan identifica esa operación pendiente y las poses candidatas. La compatibilidad real entre vistas y poses se determina en el core existente.

Callables internos: `createAutomationJob`, `retryAutomationJob`, `createAutomationPlan`, `getAutomationPlan`, `executeAutomationPlanCallable`, `resumeAutomationJob`, `updateClientAutomation`, además de `updateSystemConfig` y los controles actuales de Catálogo.

### Entrada de fotografías

```json
{
  "itemId": "articulo-explicito-001",
  "fileName": "referencia.jpg",
  "driveFile": {
    "folderId": "CARPETA_AUTORIZADA",
    "fileId": "ARCHIVO_DRIVE",
    "revisionId": "REVISION_OPCIONAL",
    "version": "VERSION_OPCIONAL"
  }
}
```

Cada imagen admite exactamente una fuente: `driveFile`, `storagePath` propio del caller o URL HTTPS de un host permitido. Máximo 40 referencias y cuatro por artículo. Un enlace de carpeta sin asociación de archivos con `itemId` produce una incidencia; no se infieren SKC ni se agrupan artículos por nombres.

Los endpoints anteriores conservan sus rutas, autenticación y respuestas básicas. Los clientes que creen nuevos pedidos deben enviar `allowEstimatedCosts: true` cuando autoricen expresamente las tarifas estimadas y `authorizeClassification: true` para la clasificación pagada de prendas. La omisión no autoriza gasto incierto: el pedido queda detenido con una incidencia clara. La idempotencia prevalece sobre cambios de payload; un trabajo nuevo requiere un externalId nuevo. Un cambio de cliente o tipo con un identificador ya ocupado no da acceso al trabajo anterior.

## 5. Configuración de Sistema

Ruta: **Sistema → Configuración → Presupuesto de automatización**. Persistencia: `system_config/main.automationBudget`.

```json
{
  "defaultBudgetUsd": 10,
  "maxBudgetUsd": 100,
  "maxReviewAttempts": 3,
  "maxOperationalRetries": 2
}
```

Solo administradores pueden guardar estos valores. Presupuestos positivos, default ≤ máximo, máximo USD 10 000, entre uno y diez intentos de calidad y entre cero y diez reintentos operativos. Los valores iniciales son fallbacks del contrato y no implican que se haya cambiado la configuración de clientes reales.

Las reservas leen los máximos actuales directamente en una transacción, sin depender del caché de cinco minutos ni de un nuevo deploy. Los cambios no cancelan retroactivamente operaciones ya enviadas a proveedores. Una configuración de automatización malformada no bloquea la lectura de la configuración manual; las operaciones automáticas validan sus límites antes de gastar.

## 6. Configuración de Clientes y precedencia

En cada cliente activo se ofrece una sección **Automatización** con activación, una o más carpetas Drive por ID/enlace, modelo humano, presupuesto, intentos y presets. Los presets permiten proveedor, configuración de imagen, prompts, poses y escenas. No se añade una pantalla por cliente. Las carpetas se verifican al guardar y al acceder a cada archivo.

Ejemplo conceptual de `clients/:id.automation`:

```json
{
  "enabled": true,
  "driveFolderIds": ["CARPETA_1", "CARPETA_2"],
  "defaultModelId": "MODELO_DEL_CLIENTE",
  "defaultPreset": "habitual",
  "defaultBudgetUsd": 20,
  "maxReviewAttempts": 3,
  "presets": {
    "habitual": {
      "provider": "fal-gpt-image-2.5-flare",
      "aspectRatio": "3:4"
    }
  }
}
```

Precedencia: parámetros explícitos del pedido → valores del cliente/preset → defaults globales y compartidos. Un parámetro explícito no puede superar el máximo global ni los límites de intentos del cliente. Se puede pedir un presupuesto inferior al default. Los límites incompatibles con una reducción global se rechazan hasta corregir la configuración; nunca se ignoran para permitir gasto. El presupuesto autorizado queda guardado en el pedido y cada nueva operación respeta también los máximos globales actuales.

La ausencia histórica de `enabled` conserva la compatibilidad anterior y se muestra como activada; al guardar se persiste un booleano explícito. La autorización técnica sigue separada de la configuración del cliente. Habilitar automatización o asociar una carpeta **no** concede a ChatGPT Work acceso a ese cliente. Un operador autorizado puede establecer la lista exacta mediante:

```bash
node scripts/automation-admin.mjs set-clients ID_CLIENTE_A ID_CLIENTE_B
```

El comando valida clientes activos con automatización habilitada, sustituye la lista explícita y revoca tokens anteriores. No se ejecutó para ampliar permisos de clientes reales durante esta entrega.

## 7. Ejemplo completo multicliente con Drive

Ejemplo para una herramienta HTTP confiable; los IDs son placeholders y el mapeo artículo→archivo debe venir del pedido o del sistema autorizado de SKC.

```js
import { ManglarAutomationClient } from './scripts/manglar-work-client.mjs';

const manglar = new ManglarAutomationClient({
  getClientSecret: () => credentialStore.read('MANGLAR_CLIENT_SECRET'),
});

const pedidos = [
  { clientId: 'CLIENTE_A', externalId: 'pedido:cuenta:A:001',
    inputImages: [{ itemId: 'A-001', fileName: 'referencia.jpg',
      driveFile: { folderId: 'CARPETA_A', fileId: 'ARCHIVO_A' } }] },
  { clientId: 'CLIENTE_B', externalId: 'pedido:cuenta:B:001',
    inputImages: [{ itemId: 'B-001', fileName: 'referencia.jpg',
      driveFile: { folderId: 'CARPETA_B', fileId: 'ARCHIVO_B' } }] },
];

for (const pedido of pedidos) {
  const plan = await manglar.preparePlan({
    ...pedido, source: 'api', jobType: 'product', budgetUsd: 20,
    allowEstimatedCosts: true,
  });
  const inicio = await manglar.executePlan(plan.planId);
  const resultado = await manglar.waitForJob(inicio);
  if (resultado.outputs?.length) {
    const zip = await manglar.downloadResults(resultado.jobId);
    // La herramienta entrega estos bytes como archivo descargable al usuario.
  }
}
```

La herramienta puede consultar `/capabilities` y listar una carpeta autorizada antes de preparar. Una lista de archivos no define qué fotos pertenecen a cada artículo: sin ese mapeo debe devolver una incidencia. Cada cliente conserva sus modelos, prompts, referencias, batch y presupuesto. Las referencias de `/uploads` quedan asociadas al cliente en su primer uso automático; su reutilización desde otro cliente se rechaza aunque la identidad técnica tenga acceso a ambos. Repetir la ejecución del mismo plan devuelve el mismo pedido.

## 8. Ejemplo de escenas independientes

La preparación de prendas también aísla incidencias por artículo: una clasificación incierta, un tipo distinto de prenda, un error de análisis o la ausencia de poses compatibles deja ese artículo en `items` con estado `needs_attention`, `issue.code`, `issue.message` y sin escenas. Sus referencias y análisis disponibles se conservan. Los artículos válidos continúan en el mismo batch y sus incidencias no desaparecen al actualizar el progreso. El pedido permanece activo mientras se procesan los válidos y termina en `needs_attention` si algún artículo quedó excluido, aunque todas las escenas generadas se aprueben. Si ninguno puede prepararse, no se crea un batch vacío. La API expone las incidencias con `itemId` y Automation muestra sus motivos. Los errores de presupuesto, autorización o configuración común siguen deteniendo el pedido; una reanudación reutiliza los análisis ya guardados.

Tres artículos con seis escenas producen 18 jobs en el batch habitual. Todos quedan activos desde la creación. Cada escena genera y revisa su propia imagen. Si la primera escena de B falla tras tres intentos, B conserva esos tres outputs y sus revisiones; sus otras cinco escenas, y las doce de A y C, continúan normalmente.

El resultado puede ser 17 imágenes aprobadas, una escena fallida y estado general `needs_attention`. Mientras queden escenas en curso, el pedido mantiene un estado activo y muestra fallos parciales. El ZIP final contiene únicamente las 17 aprobadas; los intentos rechazados siguen en Catálogo. No se necesita una petición de Work por escena ni aprobación humana para continuar.

## 9. Ejemplo y límites del presupuesto

Antes de cada generación se usa el catálogo existente de costos. Las tarifas de precio fijo se reservan por su estimación; los proveedores con precios variables reservan como mínimo USD 0,50 o cuatro veces su estimación, el mayor. Antes de cada llamada Gemini se reserva USD 0,05. Son decisiones de admisión conservadoras y **no garantías contractuales de facturación**. La preparación incluye capacidad conservadora para intentos de calidad, reintentos operativos y clasificación autorizada.

Con límite USD 1 y ocho solicitudes simultáneas de reserva de USD 0,30, solo caben tres. El rechazo por capacidad insuficiente pausa nuevas reservas del pedido. Una conciliación repetida del mismo operationId no vuelve a sumar gasto. Las reservas usan precisión de seis decimales y una transacción sobre el pedido.

`budget` distingue:

- `limitUsd`: presupuesto autorizado del pedido.
- `effectiveLimitUsd` en la API: el menor entre ese presupuesto y el máximo global actual.
- `reservedUsd`: operaciones reservadas todavía no conciliadas.
- `spentUsd`: capacidad comprometida; incluye exposición conservada cuando no hay un cobro confirmado.
- `recordedUsd`: costos estimados registrados por el pipeline existente, con tokens reportados para Gemini.
- `providerConfirmedUsd`: `null` mientras no se disponga de facturación confirmada.
- `remainingUsd`: capacidad disponible bajo los límites efectivos.

Una respuesta incierta o timeout no libera dinero suponiendo costo cero. Los precios variables y Gemini conservan la exposición reservada aun cuando su costo estimado registrado sea inferior; un precio fijo conocido libera la diferencia al conciliar. Las reservas que queden pendientes después de un crash siguen consumiendo capacidad. No se ha implementado conciliación automática contra facturas de fal/Gemini ni liberación automática de importes inciertos.

Por ejemplo, con USD 0,06, una generación fija de USD 0,027 puede guardarse y quedar sin revisión porque no cabe la reserva Gemini de USD 0,05. El pedido bloquea nuevas operaciones, conserva esa imagen y permite reanudación autorizada. Tras elevar el presupuesto, se revisa el mismo output y no se repite la generación.

Las tarifas de referencia no acotan todos los cargos posibles, por lo que se bloquea gasto sin `allowEstimatedCosts` explícito. Los presupuestos cubren las operaciones de IA descritas; no afirman limitar la facturación general de Firebase, almacenamiento, transferencia o Google Cloud.

## 10. Cómo Gemini revisa el prompt exacto

El worker envía `job.finalPrompt` al proveedor y ese mismo texto al revisor de cada intento. En automatización, la revisión reutiliza la estructura del formato aprobado: el prompt final es la fuente de requisitos, prioridades y transformaciones permitidas. No se añaden criterios predeterminados de fondo, identidad o color cuando el prompt no los exige. Los criterios contienen notas/evidencia y las condiciones ambiguas o no verificables se marcan para atención.

Se incluyen las referencias originales del artículo; para prendas también la referencia de modelo/pose. Se guardan prompt solicitado, prompt final utilizado, imagen, revisión, criterios, motivo, revisedPrompt y costo. Al rechazar, el siguiente intento usa la corrección completa, sin envolverla otra vez en instrucciones previas. Cada revisión utiliza el texto de ese intento.

Las llamadas de automatización limitan la salida Gemini a 4096 tokens y registran también tokens de razonamiento cuando se reportan. La aprobación exige criterios aplicables presentes y todos aprobados. El operador conserva los controles de selección, revisión y regeneración en Catálogo. La regeneración explícitamente manual conserva `automationJobId` e historial pero sale del control de gasto automático y restaura los límites manuales.

## 11. Conexión de ChatGPT Work

La conexión externa no se da por terminada. Se debe instalar/actualizar `scripts/manglar-work-client.mjs` y `shared/src/automationPolling.json` en el runtime de la herramienta HTTP confiable, conectar `getClientSecret` al almacén seguro y exponer operaciones de alto nivel para preparar, ejecutar, supervisar y descargar.

La credencial larga permanece fuera de prompts, respuestas y logs. El helper renueva bearers automáticamente, comparte renovaciones simultáneas y puede esperar un pedido completo dentro de la herramienta. El agente recibe estados compactos; no revisa imágenes ni consulta cada escena. El polling mantiene el deadline original al reanudar. Una revisión periódica de Gmail es independiente de ese polling.

No se creó un conector MCP, scheduler Gmail ni herramienta externa de Work desde el repositorio. No se ampliaron automáticamente scopes ni clientes de la identidad técnica. `jobs:retry` debe concederse expresamente si se quiere permitir reanudación desde esa herramienta; los controles internos autorizados siguen disponibles.

## 12. Validación

Validación final: **121 pruebas generales aprobadas**, dos integraciones omitidas en esa ejecución y ejecutadas aparte; **34 pruebas de integración aprobadas** en emuladores; **13 pruebas de navegador aprobadas**. Typechecks frontend/Functions y builds correctos. Los comandos y evidencia se registran en `reports/AUTOMATION_V2_VERIFICATION.json`. Las integraciones usan exclusivamente `demo-manglar-automation`, emuladores de Auth/Firestore/Storage y proveedores simulados. No se ejecutaron generaciones pagadas reales.

Cobertura: multicliente/scopes, carpetas por ID, pertenencia de archivos, versiones y caché; planificación gratuita y concurrencia de ejecución; reservas simultáneas y conciliación idempotente; lectura inmediata de límites globales; clasificación autorizada y caché; escenas independientes con fallo parcial; prompts sucesivos exactos; costos Gemini; ZIP y manifiesto; pausa/reanudación; reintento de revisión sin regenerar; regresión manual y protección de automatizaciones antiguas sin presupuesto.

Los tests de navegador aíslan Firebase y proveedores. Se verifican configuración persistente y ausencia de controles eliminados, navegación a un lote fuera de la lista inicial, ausencia de cancelación al navegar, los tres pasos manuales, detección, poses, escenas y prompts existentes. Se observó una aserción móvil intermitente de overflow en el test heredado, también reproducida contra una copia limpia de `051449a`; no se modificó el wizard para corregirla.

## 13. Despliegues

El registro definitivo figura en `reports/AUTOMATION_V2_VERIFICATION.json`. No se realizaron commits, pushes, instalaciones, cambios de dependencias, migraciones ni cambios de permisos de clientes reales. Despliegue completado de **24 Functions afectadas**, reglas de Firestore y Hosting en `tutofb-260320-1003`. Se actualizaron nuevamente cinco de esas Functions y Hosting tras los últimos controles de aislamiento. La API desplegada respondió con versión 2, rechazó una consulta anónima con HTTP 401 y no expuso controles eliminados; el HTML servido coincide con el build local. Firebase CLI guardó el parámetro no secreto de Drive como `disabled`. La identidad técnica mantiene acceso únicamente a `automation-e2e-test`, sin ampliación de permisos.

## 14. Configuración externa pendiente

Actualización del 2 de noviembre de 2026: la identidad dedicada de Drive, APIs, permiso de emisión de tokens y despliegue ya están configurados. JISHOP tiene trece carpetas autorizadas y la identidad técnica admite los cinco clientes con estado activo y el de pruebas, según la elección explícita del usuario. Se añadió el servidor del plugin nativo de ChatGPT con OAuth PKCE; queda la vinculación personal en la interfaz de ChatGPT. Ver [estado actual](AUTOMATION_CONNECTION_STATUS.md) e [instalación del plugin](MANGLAR_CHATGPT_PLUGIN.md). La lista original siguiente conserva los requisitos de configuración, no su estado actual.

1. Preparar una identidad de servicio dedicada para importar Drive, compartida como lectora solo en carpetas autorizadas. Establecer `AUTOMATION_DRIVE_SERVICE_ACCOUNT` en la configuración de despliegue de Functions; su default `disabled` falla cerrado.
2. Habilitar Drive API e IAM Service Account Credentials API y permitir a las identidades runtime necesarias emitir tokens de esa cuenta concreta. Usar el permiso específico `iam.serviceAccounts.getAccessToken`, sin conceder roles de proyecto adicionales ni delegación de dominio. La API utilizada acepta un scope de lectura y vida corta: [generateAccessToken](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken).
3. Guardar y verificar carpetas y preferencias desde Clientes; ajustar presupuestos desde Sistema. Añadir clientes no requiere cambios de código ni otro deploy una vez configurada la integración.
4. Establecer explícitamente los clientes y scopes autorizados de `chatgpt-work`, y conectar el almacén de credenciales y la herramienta HTTP de Work.
5. Proporcionar la asociación definitiva artículo→archivos mediante la solución de SKC que aportará el usuario.

El helper previo de Google Sheets usa acceso de escritura y puede delegar un usuario de Workspace. No se reutiliza ese token para importar fotografías: el nuevo acceso solicita solo lectura y no impersona usuarios. Metadatos y descargas siguen [files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) y [revisions.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/get).

## 15. Limitaciones y operación

- La integración Drive implementada admite hijos directos de las carpetas autorizadas; las subcarpetas deben autorizarse explícitamente. Se excluyen atajos y documentos no fotográficos. El listado está limitado a 1000 archivos y el intake a 40 referencias.
- El acceso real a Drive y la herramienta externa de Work requieren los pasos anteriores; las pruebas usaron adaptadores simulados.
- El presupuesto transaccional limita admisión de operaciones bajo tarifas estimadas autorizadas. No sustituye topes/facturas del proveedor ni promete cobro exactamente una vez cuando un proveedor completa una petición y se pierde su respuesta.
- El ZIP está limitado a 64 MB de imágenes antes de comprimir; para pedidos mayores se usan URLs individuales temporales. No se incluyen rechazos como entregables aprobados.
- Las revisiones pueden equivocarse. Catálogo conserva la intervención del operador. Las escenas con calidad agotada se recuperan expresamente desde sus controles existentes; `/resume` no reinicia intentos ni duplica aprobadas.
- Automatizaciones antiguas que carezcan de un presupuesto autorizado se detienen antes de otra operación pagada; pueden recuperarse expresamente desde Catálogo o mediante un pedido nuevo con política válida. Las regeneraciones manuales conservan sus asociaciones y quedan fuera del presupuesto automático.
- La cola muestra los 100 lotes activos/fallidos más recientes. Se eliminó el truncamiento de 200 jobs por lote y los contadores se recalculan transaccionalmente para impedir sobrescrituras de snapshots antiguos. No se hizo una migración masiva de contadores históricos. Catálogo ya no cancela trabajos al navegar para intentar corregir contadores.

## 16. Seguimiento: incidencias de preparación por artículo

Implementado y desplegado el aislamiento descrito en la sección 8. Validación: typechecks de frontend y Functions, builds de ambos, 121 pruebas generales aprobadas (las dos suites de emuladores se ejecutan aparte), 37 pruebas de integración aprobadas y una prueba de navegador para mostrar la incidencia junto a un artículo completado. Las pruebas usan emuladores y proveedores simulados. No se generaron imágenes pagadas en producción.

Se desplegaron primero `automationApi` y `automationGenerationProgress`, y luego `automationIntakeWorker` y Hosting. Las tres Functions quedaron `ACTIVE`; el HTML publicado coincide con el build local y la API sigue rechazando consultas anónimas con HTTP 401. El registro `classificationIsolation` en `reports/AUTOMATION_V2_VERIFICATION.json` conserva los resultados de este seguimiento. El wizard manual no cambió.
