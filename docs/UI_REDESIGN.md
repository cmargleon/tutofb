# Evolución visual de Tuto

## Auditoría previa (8 de noviembre de 2026)

Stack comprobado: React 19, React Router 7, Vite 6, Tailwind 4, Lucide y Recharts. Sin biblioteca de componentes externa. `src/components/ui.tsx` reúne botones, encabezados, estados, badges y miniaturas; `FeedbackProvider` mantiene diálogos, confirmaciones y toasts. Las páginas orquestan hooks y wrappers Firebase por feature.

`AppRouter.tsx` conserva rutas protegidas para dashboard, clientes (alta/lista/ficha), usuarios, modelos (alta/generación/catálogo), generación de fotos, catálogo, cola, automatización (trabajos/entrada), organizador, analíticas, finanzas, configuración y seguridad/respaldos. Manglar tiene su página de conexión. No hay un módulo independiente de inventario o pedidos.

El layout existente ya tiene sidebar contraíble a partir de 1280px, drawer móvil, búsqueda global y notificaciones. Clientes ya tiene páginas remotas de 20 elementos, filtros en URL, archivo/reactivación y siete secciones: resumen, productos, marketplaces, fuentes, automatizaciones, configuración e historial. El historial declara que no dispone de fuente de eventos. Los cuatro canales existentes son Amazon, SHEIN, TikTok Shop y Mercado Libre; sus controles administrativos no son conexiones comerciales.

Problemas encontrados: tema oscuro predeterminado; nombre de producto antiguo en sidebar; estilos de botones, inputs, tablas y tabs repetidos; espaciado de encabezados duplicado; padding interior adicional en algunas páginas; estados de cliente dibujados aparte de los badges compartidos; ficha de cliente sin contexto activo en navegación; transiciones globales incluso en elementos que no las necesitan. Las tablas usan desplazamiento horizontal y los formularios grids responsive, pero faltaba una base compartida para nuevos módulos.

Referencias públicas visitadas con navegador: https://www.holded.com, https://www.odoo.com (redirige a /es), https://erpnext.com (redirige a frappe.io/erpnext/egypt-ar). Solo se inspeccionaron páginas públicas y sus vistas promocionales; no se accedió a aplicaciones privadas, demos autenticadas ni tablas administrativas reales. Se toman jerarquía, agrupación modular y patrones conocidos de listas, sin copiar activos.

## Etapa funcional de esta entrega

Identidad propia: superficies blancas, fondo mineral claro, acento verde petróleo, marca tipográfica Tuto, tipografía local Avenir Next con fallbacks, bordes finos y sombras breves. Tokens y clases en `src/styles/design-system.css`; compatibilidad con modo oscuro conservada en `src/index.css`. El tema claro es el valor inicial para usuarios sin preferencia, respetando la preferencia guardada.

Los alias Tailwind `indigo` apuntan al acento de Tuto para mantener compatibles las pantallas existentes. Los componentes consolidados consumen los tokens semánticos. La capa de compatibilidad oscura se mantiene: eliminar sus selectores requeriría migrar y validar cada módulo restante.

Se consolidan componentes utilizados de verdad: botones y enlaces con la misma apariencia, encabezados con acciones, superficie, breadcrumbs, buscador, barra de filtros, contenedor de tabla semántica, skeleton de tabla, paginación y navegación de secciones. Los controles nuevos no sustituyen hooks ni crean operaciones remotas.

Alcance: shell y navegación global, lista/alta/ficha de clientes y presentación de marketplaces. Los componentes compartidos mejoran otras pantallas, pero no equivalen a una migración completa de sus interfaces. Los pasos y las reglas del wizard, la ejecución de Automation y todos los contratos permanecen bajo sus implementaciones actuales.

## Fronteras y validación

No editar Functions, shared, reglas, esquema, permisos, wrappers Firebase, persistencia, costos ni proveedores. Se preservan propiedades públicas, handlers, filtros en URL, borradores por cliente/canal, conflictos de edición, confirmaciones y paginación remota. Las pruebas existentes `clientListState`, `clientDraft`, `clientMarketplace` y `e2e/clients-redesign.spec.ts` cubren estas invariantes. Las pruebas de navegador deben usar dobles locales o intercepción de servicios; localhost por sí solo no aísla Firebase.

Las capturas de QA usan datos de prueba exclusivamente en el entorno de pruebas. La aplicación sigue mostrando datos de sus servicios reales.

Siguientes etapas recomendadas: tablas y detalle de Automation, presentación completa del wizard/catálogo, dashboard y finalmente formularios administrativos de configuración/finanzas. Migrar un módulo completo por etapa y comprobar sus pruebas antes de continuar.

## Inventario de cambios

| Área | Archivos |
| --- | --- |
| Tokens y tema | `src/styles/design-system.css`, `src/index.css`, `src/features/theme/ThemeProvider.tsx`, `index.html` |
| Componentes compartidos | `src/components/ui.tsx` |
| Shell | `src/components/Layout.tsx`, `src/components/layout/Sidebar.tsx`, `Topbar.tsx`, `navigation.ts` |
| Páginas de clientes | `src/pages/Clients.tsx`, `src/pages/ClientDetail.tsx` |
| Presentación de clientes | `src/components/clients/ClientCreateForm.tsx`, `ClientDetailHeader.tsx`, `ClientListItem.tsx`, `ClientOverview.tsx`, `clientUtils.ts` |
| Marketplaces | `src/features/marketplaces/ClientMarketplaces.tsx` (solo presentación) |
| Pruebas | `e2e/ui-shell.spec.ts`, `e2e/clients-redesign.spec.ts`, `e2e/automation-navigation.spec.ts` |

La arquitectura de negocio permanece igual. La presentación añade componentes al punto de entrada UI existente, centraliza estilos y mantiene la firma de los componentes originales. `PageHeader` añade `actions` opcional. No se añadieron dependencias ni se modificaron hooks de clientes, wrappers de servicios, contratos, backend o configuración Firebase.

## Validación ejecutada

- `npm run lint`: correcto (TypeScript; no existe un lint separado en este proyecto).
- `npm run build`: correcto.
- `npm test`: 236 casos, 222 aprobados, 14 omitidos, 0 fallos. Incluye compilación de Functions, sin cambios en sus fuentes. No se ejecutó la suite con emuladores.
- Playwright: 25 casos distintos aprobados entre `clients-redesign` (10), `client-identity-products` (2), `ui-shell` (1), `wizard-products` (11) y `automation-navigation` (1). Después de los últimos ajustes visuales se repitieron `clients-redesign` y `ui-shell`: 11/11.
- Comprobaciones: paginación remota y contexto URL, filtros, alta/archivo/reactivación, formularios y conflictos, borradores independientes, switches y ajustes, aislamiento de identidad, productos embebidos, invariantes del wizard y navegación desde Automation sin cancelación accidental.
- Revisión de capturas con shell real y datos locales de prueba a 1440, 768 y 390 px, temas claro/oscuro; sin desbordamiento horizontal del documento. Las tablas y la navegación de secciones permiten desplazamiento interno.
- Teclado: foco visible, drawer con foco contenido, cierre con Escape y devolución al disparador; menú cerrado inerte. La tabla permite enfoque para desplazamiento por teclado.
- Carga, vacío y error del directorio comprobados explícitamente. Sin errores de aplicación en la prueba del shell; se excluye únicamente el diagnóstico de HMR de Vite producido por el bloqueo deliberado de sockets del entorno aislado.
- Contraste calculado del texto blanco de botones primarios: 6,43:1 en claro y 5,28:1 en oscuro. Esto no equivale a una auditoría integral de accesibilidad de toda la aplicación.
- `git diff --check`: correcto.

En la primera pasada de regresión falló un mock antiguo de navegación de catálogo: apuntaba a la página anterior a la extracción de suscripciones y no exportaba `subscribeToClient`. Se corrigió el test y pasó. Una primera ejecución del wizard se interrumpió por recarga del servidor durante las ediciones; la ejecución posterior completa, sin cambios concurrentes, pasó 11/11.

Capturas revisadas: `/tmp/tuto-ui-clients-desktop.png`, `/tmp/tuto-ui-client-marketplaces-desktop.png`, `/tmp/tuto-ui-client-dark.png`, `/tmp/tuto-ui-client-768.png`, `/tmp/tuto-ui-client-390.png`, `/tmp/tuto-ui-clients-390.png`.

Entrega local, sin despliegue. No hubo cambios con impacto remoto según AGENTS.md. No se verificó una sesión de producción autenticada ni se ejecutaron integraciones reales o generación pagada.
