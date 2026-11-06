# Clientes: lista y ficha

Implementación en `codex/redisenar-clientes`, sobre la referencia
`c7f0484083680207d05e3809622e41b3315d1928` (sin commits posteriores al comenzar).

## Comportamiento y rutas

- `/clients/lista`: tabla compacta, búsqueda por nombre, estado `active`/`archived`,
  opción de incluir archivados y un máximo de 20 filas. Archivar requiere la
  confirmación existente; reactivar conserva el documento. No hay borrado físico
  de clientes en esta interfaz. El backend de borrado existente no se modifica.
- `/clients/crear`: conserva formulario, callable y validaciones existentes.
- `/clients/:clientId`: ruta diferida y limitada a administradores, con los mismos
  límites de error. Las rutas estáticas tienen prioridad.
- Las pestañas usan `tab`; el contexto de lista (`q`, `status`, `archived`, `page`)
  viaja en `list` y se restaura al volver. Los enlaces `#client-ID` desde
  `/clients` y `/clients/lista` redirigen a la ficha, también para archivados.
- La selección se carga por documento y las plantillas por subcolección del
  cliente, sin suscripción global a plantillas. Abrir páginas y pestañas solo lee.
- Productos enlaza al catálogo existente con `clientId`, conservando sus
  operaciones. No hay segundo catálogo. Historial presenta un estado vacío:
  no existe una fuente adecuada de eventos para esta ficha.
- No se muestra cantidad de productos: `batchCount` solo representa lotes.
  La actividad mostrada se etiqueta expresamente como último lote creado.

## Paginación y escala

Se conserva la búsqueda por subcadena sobre **todos** los clientes recibidos,
antes de paginar. Firestore no ofrece esta búsqueda por subcadena sin otro
índice/buscador; limitar la consulta antes de buscar ocultaría resultados.
La suscripción de lista incluye archivados y los filtros se combinan localmente.
Cambiar cualquier filtro reinicia la página y la reducción de resultados la ajusta.
El coste de lectura y la memoria son O(N): para un volumen grande se deberá
acordar una estrategia de búsqueda indexada antes de paginar en servidor.
No se añaden índices ni dependencias.

## Persistencia y permisos

`shared/src/marketplaces.ts` registra Amazon, SHEIN, TikTok Shop y Mercado Libre.
Los identificadores son `amazon`, `shein`, `tiktok-shop`, `mercado-libre`.

Se añade el mapa opcional `clients/{clientId}.marketplaces.{marketplaceId}`:

- `enabled`: habilitación administrativa; ausencia equivale a deshabilitado.
- `settings.region` y `settings.sellerId`: ajustes no sensibles opcionales.
- `updatedAt`: timestamp del servidor.

Se usa el documento del cliente para que la tabla pueda mostrar canales sin
consultas por fila. No hay migración ni creación masiva de configuración.
La callable tipada `updateClientMarketplace` exige administrador, valida IDs,
rechaza campos desconocidos y credenciales estructuradas, y modifica mediante
transacción únicamente el canal solicitado y `updatedAt`. Preserva otros canales,
ajustes previos y metadatos futuros. Las reglas bloquean introducir o cambiar
`marketplaces` mediante escrituras directas, igual que `automation`.

Los switches no autentican, publican, modifican automatizaciones ni crean trabajos.
La interfaz distingue habilitación, conexión pendiente y publicación no disponible.
Quedan preparados el registro y la estructura para integrar canales después;
las autorizaciones y sus secretos requerirán un diseño específico en esa fase.
No hay cambios en Storage, claims, estados de dominio o controles globales.

## Conservación de configuración

Fuentes y Automatizaciones comparten una instancia de
`useClientAutomationConfig`, con guardado y descarte independientes por pestaña:

- **Guardar fuentes de datos** actualiza únicamente `automation.driveFolderIds`.
  No guarda presupuestos, modelos o presets pendientes, ni infiere modelos.
  Las plantillas siguen guardándose mediante sus propias acciones existentes.
- **Guardar automatizaciones** valida y guarda activación, presupuestos, límites,
  presets, proveedor, escenas, prompts, poses y modelos. Conserva las carpetas
  actuales de Firestore, aunque se hayan modificado en otra sesión.
- Guardar o descartar una pestaña conserva el borrador pendiente de la otra.

El parámetro opcional `section` limita los campos aceptados y escritos.
`expectedAutomation` comprueba concurrencia dentro de la sección solicitada:
se permiten cambios concurrentes en la otra pestaña, pero se rechazan cambios
obsoletos sobre los mismos ajustes. Los clientes anteriores sin `section` siguen
pudiendo guardar la configuración completa como antes.

Se conserva el bloqueo de carpetas usadas por el Organizador, su validación de
acceso, normalización, deduplicación y asignación exclusiva entre clientes.
Automatizaciones mantiene las validaciones de modelos y límites globales y sigue
reutilizando `shared/src/automationModels.ts`; no cambia el motor de generación.

Las pestañas permanecen montadas. Los borradores por cliente de automatización,
datos generales y ajustes de canales se conservan además en `sessionStorage`
durante la sesión de esa pestaña del navegador. Sobreviven a navegación y recarga;
se limpian al guardar o descartar. No son un respaldo entre sesiones. La salida
con cambios usa también la protección nativa `beforeunload`. Los snapshots no
reemplazan borradores sucios. Ante conflicto, se conserva el borrador y se ofrece
cargar la configuración actual. El prompt vacío sigue heredando el global.

No se modifican módulos, identidades, horarios, originales de Drive, asociaciones
de plantillas ni fronteras de Organizador/respaldos. Las operaciones de plantillas
conservan sus callables y confirmaciones; no se probaron sobre producción.

## Archivos principales

- `src/pages/Clients.tsx`, `src/pages/ClientDetail.tsx`, `src/app/AppRouter.tsx`.
- `src/components/clients/`: fila, cabecera, resumen, fuentes, automatización,
  configuración y marketplaces.
- `src/features/clients/`: consultas específicas, estado de lista y borradores;
  `src/features/automation/useClientAutomationConfig.ts`: estado compartido.
- `shared/src/marketplaces.ts`, `shared/src/types/marketplace.ts`.
- `functions/src/callables/updateClientMarketplace.ts`,
  `functions/src/automation/clientConfig.ts`, `firestore.rules`.

## Verificación

- `npm run lint`: aprobado.
- `npm --prefix functions run lint`: aprobado.
- `npm --prefix functions run build`: aprobado.
- `npm run build`: aprobado.
- `npm test`: 199 aprobadas, 10 omitidas por condiciones de entorno/integración,
  sin fallos (209 pruebas).
- Playwright: 8 pruebas de `clients-redesign` y `client-gender-models` repetidas
  tras separar los botones, todas aprobadas. Las 2 de
  `organizer-automation-settings` y `drive-backups` habían pasado en la fase
  anterior y sus módulos no cambian. APIs simuladas y solicitudes
  HTTPS bloqueadas. Se verificaron rutas reales y autorización frontend,
  paginación, filtros, enlaces antiguos, creación/edición/archivado/reactivación,
  borradores tras navegación/recarga, errores, ajustes independientes y móvil.
  Capturas revisadas en tema oscuro y claro.
- Emuladores locales de Auth, Firestore y Storage, proyecto `demo-clients-redesign`:
  28 pruebas existentes de integración aprobadas en `automationAdvanced`,
  `organizer` y `driveBackups`, y 1 nueva de marketplaces/reglas aprobada en una
  repetición específica. La primera ejecución de esta última falló porque el
  fixture omitía el claim de rol; el fixture se corrigió y pasó. Drive, proveedores
  y Gemini están simulados, sin costes ni operaciones sobre datos reales.
- Las nuevas pruebas unitarias cubren aislamiento, rechazo de IDs/campos
  manipulados, ausencia de trabajos, conservación de campos y rechazo de
  conflictos de automatización y retirada de orígenes del Organizador.

Limitaciones: historial sin fuente; productos mediante acceso filtrado; búsqueda
local con coste O(N); borradores limitados a la sesión. No se verificó conectividad
real de marketplaces, ni se ejecutaron operaciones de clientes o Drive reales.

## Despliegue

Despliegue completado correctamente el 6 de noviembre de 2026 en
`tutofb-260320-1003`: `updateClientMarketplace` creada y
`updateClientAutomation` actualizada en `us-central1`; reglas de Firestore
publicadas. Comando ejecutado: `firebase deploy --only
functions:updateClientMarketplace,functions:updateClientAutomation,firestore:rules
--project tutofb-260320-1003 --non-interactive`.
La interfaz no se publica en Hosting como parte de este trabajo en rama.
No se ejecutan commit ni push.

### Ajuste posterior: botones independientes

Se añadieron pruebas unitarias y de navegador para ambos órdenes de guardado:
Fuentes → Automatizaciones y Automatizaciones → Fuentes. Se verifica que cada
acción conserva tanto los valores persistidos como los borradores de la otra
pestaña. El guardado de fuentes omite las validaciones y la inferencia de modelos;
conserva las validaciones específicas de Drive y Organizador.
El nuevo contrato es compatible con las llamadas anteriores.

En la repetición de `automationAdvanced.integration.test.ts` apareció una
comparación que asumía un orden fijo de artículos tras agrupar por modelo.
Las asignaciones eran idénticas; se corrigió la prueba para ordenar por ID antes
de comparar, manteniendo la verificación completa de artículo y modelo.
No se cambió la lógica de generación ni de selección de modelos.

Verificación del ajuste: 199 pruebas unitarias aprobadas y 10 omitidas;
8 pruebas de navegador aprobadas, más una repetición específica del guardado
independiente; 23 pruebas de integración aprobadas en emuladores locales,
incluyendo la comparación corregida y el guardado parcial real en Firestore.
Los chequeos de tipos y el build de frontend y Functions pasan.
`updateClientAutomation` se volvió a desplegar correctamente en
`tutofb-260320-1003` (`us-central1`). No se publicó Hosting ni se hizo commit/push.
