# Auditoría de cobertura MCP — 3 de noviembre de 2026

Inventario iniciado antes de implementar y actualizado con el registro ejecutable final. [Detalle de las 97 operaciones y sus fuentes](MANGLAR_TOOL_INVENTORY.md). Fuente: rutas, páginas, componentes y hooks de `src/`, handlers de `functions/src/`, contratos de `shared/src/`, reglas y pruebas. `code > tests > docs`. Implementación local validada por builds, contratos y las suites descritas en MANGLAR_CHATGPT_PLUGIN.md; la prueba externa de una segunda cuenta se distingue de esos resultados.

| Operación real | Pantalla / módulo | Backend / lógica actual | Roles actuales | Equivalente MCP | Estado final de código |
|---|---|---|---|---|---|
| Clientes: listar, buscar, detalle | Dashboard, Clients, Wizard | clients, features/clients/firebase | lectura A/O/R; edición A | clients list/get/create/update/archive/restore | implementado; ver inventario |
| Eliminar cliente archivado | Clients | permanentlyDeleteClient, deletePlans | A | clients delete | implementado; ver inventario |
| Automatización, carpetas Drive, presets, límites por cliente | Clients, Automation | saveClientAutomation | A | clients automation | implementado; ver inventario |
| Plantillas XLSX, categorías, categoría activa | Clients, Wizard | import/deleteClientSpreadsheetTemplate, updateClientSpreadsheetTemplateCategory | A; lectura A/O/R | spreadsheets templates/categories/import/delete/selectCategory | implementado; ver inventario |
| Modelos: listar, detalle visual, crear desde fotos o generaciones, editar, mover, añadir/quitar poses, rasgos | Models, ModelsCatalog, ModelsGenerate | features/models/firebase, onModelWrite | A; selección A/O/R | models list/get/create/update | gestión y selección implementadas |
| Archivar/restaurar/eliminar modelo | ModelsCatalog | features/models/firebase, permanentlyDeleteModel | A | models archive/restore/delete | implementado; ver inventario |
| Generar identidad, variantes y poses con referencia, sustituir pose | ModelsGenerate, ModelsCatalog | generateModelPose, replaceModelPoseWithGeneratedPhoto | A en UI | models generate/replacePose | implementado; ver inventario |
| Clasificar poses automáticamente | onModelWrite | classifyPoseWithGemini, buildPoseAiClassification | backend | models classify | automática y explícita implementadas |
| Importar/exportar bundle ZIP | ModelsCatalog | importModelBundle, downloadModelBundle | A | models import/export | implementado; ver inventario |
| Wizard: referencias, agrupación por artículo, vistas, detección ropa/objetos, mayoría, corrección manual | Wizard | garments, garmentClassification, classifyGarmentViewsWithGemini | A/O | wizard drafts/classify/correct | implementado; ver inventario |
| Wizard: proveedor, encuadre/calidad/formato, poses compatibles, prompts aprobados, escenas | Wizard | wizard/state, submit; shared/domain, approvedTryOnPrompt, productGeneration | A/O | wizard defaults/preview/createGarment/createProduct | implementado; ver inventario |
| Previsualizar drafts spreadsheet con XLSX fuente | Wizard | previewProductDrafts | A/O | spreadsheets preview | implementado; ver inventario |
| Automatización: capacidades, Drive, modelos, preparar/leer/ejecutar plan, estado/resultados | Automation | automation/mcp, plans, queries | A/O; identidad técnica acotada | siete herramientas históricas | conservadas y probadas |
| Historial, entradas/errores, informes, prompts, presupuesto, reintentar/reanudar, ZIP | Automation | automationJobs, retryAutomation, resumeAutomation, automationResultsZip | A/O propios | automation list/get/retry/resume/download | ampliado; ver inventario |
| Cola/catálogo: filtros cliente/lote/estado/proveedor, paginación, historial versiones/logs, prompts, Gemini y costos | Cola, Catalogo, evaluation | batches, jobs/{id}/outputs/logs | A/O/R | catalog batches/jobs/get/outputs/logs/drafts | implementado; ver inventario |
| Selección de versión; marcar/desmarcar revisión manual | Catalogo, evaluation | selectJobOutput; setJobManualFlag | A/O/R | catalog select/flag | implementado; ver inventario |
| Regenerar individual, selección o fallidos, prompt/proveedor; reintentar Gemini | Cola, Catalogo | regenerateJob, regenerateJobsBulk, regenerateFailedBatchJobs, retryJobAutoReview | A/O/R | catalog regenerate/regenerateBulk/retryFailed/review | implementado; ver inventario |
| Cancelar job/lote/pendientes; eliminar job | Cola, Catalogo | cancelJobGeneration, cancelBatchProcessing, cancelPendingBatchJobs, deleteJob | A/O; cancelar job también R | catalog cancel/cancelBatch/cancelPending/delete | implementado; ver inventario |
| Editar filas draft; exportar XLSX; crear/actualizar Google Sheet | Catalogo | updateBatchProductDraft, exportBatchSpreadsheet, editBatchSpreadsheet | A/O/R | spreadsheets update/export/edit | implementado; ver inventario |
| Descargar imagen/versiones, ZIP lote/selección | Catalogo, evaluation | downloadJobImage, downloadBatchZip, downloadSelectedJobsZip | A/O/R | files image/batch/selection | implementado; ver inventario |
| Dashboard/actividad/estadísticas | Dashboard | dashboard/firebase, analytics_summary | A/O/R (analytics A/R) | dashboard summary/activity | implementado; ver inventario |
| Analytics: producción diaria, proveedor/cliente/modelo, costos, Gemini, modelos IA, períodos y alertas | Analytics | analytics_*, model_generation_logs, analytics_gemini_usage | A/R | analytics query | implementado; ver inventario |
| Salud/alertas, configuración de alertas | Analytics, Configuracion | getSystemHealth, updateSystemAlertSettings | lectura A/R, edición A | system health/alerts | implementado; ver inventario |
| Configuración global/proveedores/prompts/revisión/reintentos/presupuestos | Configuracion | get/updateSystemConfig | A | system get/update | implementado; ver inventario |
| Recalcular analytics; completar poses | mantenimiento admin | rebuildAnalytics, backfillModelPoses | A | system rebuildAnalytics/backfillPoses | implementado; ver inventario |
| Finanzas: dashboard, costos/márgenes/precios/eventos/snapshots por período/cliente/proveedor/job/batch/modelo | Finanzas | getFinanceDashboard, finance_* | A | finance dashboard/query | implementado; ver inventario |
| Configuración financiera, precios, movimientos, reconstruir snapshots | Finanzas | updateFinanceSettings, upsertFinanceClientPricing, createFinanceManualEvent, rebuildFinanceSnapshots | A | finance settings/pricing/event/rebuild | implementado; ver inventario |
| Usuarios: listar/buscar/crear/editar/rol/activar/desactivar/archivar/restaurar/eliminar | Users | *AppUser, syncUserClaims | A | users list/get/create/update/archive/restore/delete/syncClaims | implementado; ver inventario |
| Conexiones OAuth: consentimiento, listar/revocar; acceso individual | ManglarConnect | mcpOAuth | A actualmente | connections list/revoke/access | identidad individual; legacy acotado |
| Archivos privados: cargar, importar Drive, previsualizar/borrar temporales | Wizard, Models, Clients | Firebase Storage, automation/imports | según dominio | files upload/import/preview/discard | implementado; ver inventario |
| Login/logout, cambio de cuenta, consentimiento OAuth, recuperación de contraseña, diálogo local de guardar archivo | Auth/navegador/SO | Firebase Auth / OAuth / filesystem local | humano | intervención humana justificada | no son operaciones delegables con tokens MCP |

A=admin, O=operador, R=revisor. No existe aprobación manual que sustituya el veredicto de Gemini: existen selección de outputs y marca manual. No existe CRUD arbitrario de proveedores/secretos ni lector Gmail dentro de Tuto. Los proveedores son IDs y contratos compartidos; el sistema permite habilitar/deshabilitar y configurar parámetros existentes. El MCP no inventará esas operaciones.

Las pruebas y la conexión externa se reportarán por separado. No se harán generaciones pagadas, migraciones destructivas ni cambios de permisos sobre datos reales para validar.

La intervención humana se limita a identidad/consentimiento, confirmaciones y transferencias que el cliente MCP no soporte. El backfill administrativo ya existente solo encola; no hay consumidor en este repositorio. Los agregados globales están sujetos a restricciones de cliente. Esas condiciones no se presentan como funcionalidades nuevas terminadas.
