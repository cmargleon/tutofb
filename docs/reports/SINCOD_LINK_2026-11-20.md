# Vínculo comercial posterior de grupos SINCOD

Base: `main` / `fdf5ea1`, que incluye `PhotoArticle.modelId`. Trabajo aislado en `tutofb-sincod-link-design`; sin commit ni push.

## Comportamiento

- Los avisos también cubren un mismo grupo con artículos de generación históricos separados: aviso en cada prenda y resumen único en el lote.
- Se reutilizan la normalización y las alertas de `b287278`. Las variantes visuales del Excel sin fotos efectivamente asociadas se ofrecen como candidatas, incluyendo todas sus tallas. La aprobación de referencias es independiente.
- Sin candidatas: error que pide agregar una fila y sincronizar. Con candidatas: warning sin coincidencia, con selección humana. Durante una sincronización se espera su finalización.
- Organizador y `/catalogo` comparten la selección y la confirmación de todo el grupo. El drawer de exportación sigue siendo el único editor de producto.
- La previsualización registra revisiones de fotos, Excel, productos, aliases, generaciones y publicaciones. La confirmación transaccional rechaza cambios concurrentes, exige resolver valores manuales incompatibles y admite reintento con el mismo requestId.
- La ficha del Excel es canónica; las provisionales quedan redirigidas. Se conservan jobs, outputs, revisiones, selecciones y publicaciones. Los registros de publicación mantienen su identidad histórica y sus rutas válidas de Storage; la exportación sigue resolviendo esas publicaciones por la generación original.
- Se incorporan datos y evidencia comercial del Excel, se mapean variantes y se resuelve organizer_identity sin regeneración. Otros bloqueantes siguen vigentes.
- skipBlockedProducts reporta los pendientes incluso cuando todos quedan excluidos.
- MCP: linkCandidates / previewLink en manglar_organizer_read y link en manglar_organizer_manage. Contrato e inventario regenerados.

## Validación

- Frontend y Functions: build y lint correctos. Vite usa su binario esbuild 0.25.12; tsx/npm test usan ESBUILD_BINARY_PATH con esbuild 4, como requiere esta máquina. No se instalaron dependencias ni se modificaron lockfiles.
- npm test: 530 pruebas, 490 aprobadas, 40 omitidas, cero fallos.
- Emuladores aislados de Auth, Firestore y Storage, proyecto demo-manglar-automation, proveedores sin red externa: 15 pruebas aprobadas en organizerLink.integration, organizerAutomation y marketplaceExport.integration. Se aisló también TMPDIR para evitar colisiones entre emuladores.
- Circuito nuevo: sin fila / warning con fila nueva / rechazo de previsualización caducada / confirmación y conflictos / fusión con ficha existente / publicación previamente válida conservada / fotos y revisión intactas / datos reales del XLSX / idempotencia / candidata ocupada / concurrencia / acceso denegado.
- Regresión adicional: organizer.integration falla también en una copia limpia de fdf5ea1 (línea 128): espera selectedReferences=1 para una foto 2.jpg sin código, pero obtiene 0. No se modificó ese test ni el clasificador para cambiar la política de b287278.

## Límites

La vinculación es atómica, sin fases parcialmente aplicadas: máximo 5000 documentos por colección consultada y 400 escrituras por grupo. Superar un límite cancela sin aplicar cambios. No se hizo migración ni corrección de datos comerciales reales durante la validación.

## Despliegue

Proyecto `tutofb-260320-1003`: organizerAction, manglarMcp, downloadMarketplaceExports y Hosting. Ajuste final de atribución de avisos históricos: organizerAction y Hosting. No se modificaron reglas ni índices. Se comprobó con git log y ancestry que main contiene fdf5ea1 antes de cada despliegue.

El código sigue sin commit ni push, por instrucción del usuario; un futuro despliegue desde main puede reemplazarlo hasta incorporar este trabajo. La caché local de Hosting y los symlinks de dependencias del worktree son artefactos de preparación/despliegue, no cambios para el commit.

Smoke HTTP sin credenciales: organizerAction y downloadMarketplaceExports devuelven 401 UNAUTHENTICATED; Manglar tools/call con linkCandidates devuelve 401. tools/list mantiene su descubrimiento público.

Despliegue final completado con éxito. El index y los bundles Catalogo/OrganizerCommercialLink servidos por Hosting coinciden byte a byte con el build del worktree. organizerAction mantiene 401 sin credenciales después de la última actualización.
