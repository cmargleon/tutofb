# Sistema de diseño de Tuto

Guía corta para construir pantallas nuevas sin inventar estilos. Fuente de verdad: el código.

- Tokens y estilos de componentes: `src/styles/design-system.css`
- Primitivas React: `src/components/ui.tsx`
- Tema oscuro (overrides de utilidades Tailwind heredadas): `src/index.css`

## Principios

Inspiración visual: ERP SaaS moderno (lienzo gris claro, superficies blancas con borde sutil, sombras mínimas, color de marca usado con moderación). Identidad propia: teal de Tuto (`--color-accent`), monogramas en lugar de ilustraciones, sin fuentes de red.

## Tokens (`:root`)

| Grupo | Tokens |
|---|---|
| Superficies | `--color-bg-base` (lienzo), `--color-bg-surface` (tarjetas), `--color-bg-elevated` (cabeceras de tabla, zonas secundarias), `--color-bg-hover`, `--color-bg-active` |
| Bordes | `--color-border-subtle`, `--color-border-default`, `--color-border-strong`, `--color-border-focus` |
| Texto | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-dim` |
| Marca | `--color-accent`, `--color-accent-hover`, `--color-accent-soft` |
| Estados | `--color-{success,warning,danger,info}` y su variante `-soft` |
| Forma | `--tuto-radius-control` (8px), `--tuto-radius-panel` (12px), `--tuto-shadow`, `--tuto-shadow-popover` |
| Tamaños | `--tuto-control-height` (36px; 40px en móvil), `--tuto-topbar-height`, `--tuto-content-width` |

El bloque `@theme` remapea `slate-*`/`gray-*` a un único neutro, `indigo-*` al teal de marca y suaviza `rounded-*`/`shadow-*`. Por eso las utilidades Tailwind existentes ya siguen el sistema; en código nuevo prefiere los componentes o las variables semánticas.

Los estilos de componentes viven en `@layer components`: cualquier utilidad Tailwind (`hidden`, `w-auto`, `mt-4`…) puede sobreescribirlos.

## Componentes (`ui.tsx`)

| Necesidad | Componente |
|---|---|
| Página | `Page` (`width="narrow"` para formularios de ajustes) + `PageHeader` (`title`, `description`, `icon`, `actions`, `meta`) |
| Contenedor | `Card`/`Surface`, `CardHeader`, `CardBody`, `CardFooter`, `SectionHeading` |
| Navegación interna | `SectionNav` (pestañas), `Segmented`, `Breadcrumbs`, `WizardStepper` |
| Datos | `DataTable` (+ clases `is-numeric`, `tuto-table-actions`), `Pagination`, `TableSkeleton`, `StatCard`, `Badge`, `StatusBadge` |
| Filtros | `FilterBar`, `SearchInput` |
| Formularios | `Field`, `INPUT_CLASS` (`tuto-field`, válido para input/select/textarea), `Switch` |
| Acciones | `Button` (`primary`, `secondary`, `ghost`, `danger`, `warning`; `sm`/`md`/`lg`), `IconButton` (requiere `label`), `buttonClasses()` para `<Link>` |
| Feedback | `Alert` (`info`, `success`, `warning`, `danger`), `EmptyState`, `LoadingBlock`, `Skeleton`; toasts y confirmaciones vía `FeedbackProvider` |

## Reglas

1. Una página = `Page` + `PageHeader`. No añadas `max-w-*`, `mx-auto` ni `p-8` en la raíz: el layout ya fija ancho y márgenes.
2. Evita tarjetas dentro de tarjetas; separa secciones internas con `border-t` y `tuto-overline`/`tuto-section-title`.
3. Estados con `StatusBadge`/`Badge`; errores y avisos con `Alert`, no con cajas rojas ad hoc.
4. Botones icon-only siempre con `IconButton label=…`. Los controles de formulario deben tener etiqueta (visible o `sr-only`).
5. Un único botón primario por zona. Acciones de fila: `ghost`/`secondary` en tamaño `sm`.
6. Navegación lateral: agrega módulos en `src/components/layout/navigation.ts` indicando su `section` (`production`, `catalog`, `admin`).
