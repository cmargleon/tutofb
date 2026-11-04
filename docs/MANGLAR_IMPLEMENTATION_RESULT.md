# Entrega de Manglar MCP v2

Se amplía el servidor y el plugin existentes: 23 herramientas, 97 operaciones por dominio, siete herramientas históricas compatibles. Se conserva la URL y el OAuth PKCE/CIMD. No se han creado otro plugin, credenciales de proveedor ni migraciones de producciones.

- [Guía operativa, arquitectura, permisos, segunda cuenta, ejemplos y límites](MANGLAR_CHATGPT_PLUGIN.md).
- [Matriz por funcionalidad y pantalla](MANGLAR_COVERAGE.md).
- [Inventario exacto por operación, rol y servicio](MANGLAR_TOOL_INVENTORY.md).

## Validación

- Frontend/Functions: typechecks y builds aprobados.
- Suite sin emuladores: 125 aprobadas; 4 integraciones omitidas.
- Suite completa en emuladores limpios: 187 aprobadas; cero fallos y cero omitidas.
- Playwright aislado: 12 aprobadas (consentimiento, wizard y adaptadores frontend compartidos).
- No se realizaron generaciones pagadas ni operaciones destructivas sobre datos reales. El spec antiguo de modelos que usa credenciales reales falló en el login; fue excluido y sustituido por validación aislada.
- Producción: despliegue completado el 3 de noviembre de 2026; 86 Functions activas, 39 índices compuestos `READY` y Hosting publicado. Se verificaron descubrimiento, 23 herramientas, OAuth/CIMD, consentimiento, rechazo anónimo y la conexión nativa histórica mediante `manglar_capabilities`. Evidencia: [MANGLAR_V2_VERIFICATION.json](MANGLAR_V2_VERIFICATION.json).

## Alcance de las pruebas

Los tests ejecutan handlers reales y el worker con Firestore/Auth/Storage emulados y proveedores simulados. La tabla de inventario acredita implementación, contrato y compilación; no afirma que cada una de las 97 operaciones se haya ejecutado contra proveedores reales o desde una segunda cuenta de ChatGPT.

La segunda persona debe consentir OAuth desde su sesión. Los archivos locales requieren una transferencia HTTP compatible o las alternativas de Drive/Tuto. Los presupuestos usan reservas conservadoras y no sustituyen facturas de proveedores. El backfill de poses conserva su encolado existente; este repo no tiene su consumidor. Las conexiones históricas permanecen acotadas hasta una nueva autorización individual.

## Archivos modificados o añadidos

- [docs/AUTOMATION.md](../docs/AUTOMATION.md)
- [docs/AUTOMATION_AUTH.md](../docs/AUTOMATION_AUTH.md)
- [docs/MANGLAR_CHATGPT_PLUGIN.md](../docs/MANGLAR_CHATGPT_PLUGIN.md)
- [docs/MANGLAR_COVERAGE.md](../docs/MANGLAR_COVERAGE.md)
- [docs/MANGLAR_IMPLEMENTATION_RESULT.md](../docs/MANGLAR_IMPLEMENTATION_RESULT.md)
- [docs/MANGLAR_TOOL_INVENTORY.md](../docs/MANGLAR_TOOL_INVENTORY.md)
- [docs/MANGLAR_V2_VERIFICATION.json](../docs/MANGLAR_V2_VERIFICATION.json)
- [e2e/manglar-connect.spec.ts](../e2e/manglar-connect.spec.ts)
- [e2e/manglar-services.spec.ts](../e2e/manglar-services.spec.ts)
- [e2e/wizard-products.spec.ts](../e2e/wizard-products.spec.ts)
- [firestore.indexes.json](../firestore.indexes.json)
- [functions/src/analytics/geminiUsage.ts](../functions/src/analytics/geminiUsage.ts)
- [functions/src/auth/roles.ts](../functions/src/auth/roles.ts)
- [functions/src/automation/budget.ts](../functions/src/automation/budget.ts)
- [functions/src/automation/mcp.ts](../functions/src/automation/mcp.ts)
- [functions/src/automation/mcpOAuth.ts](../functions/src/automation/mcpOAuth.ts)
- [functions/src/automation/persistence.ts](../functions/src/automation/persistence.ts)
- [functions/src/automation/queries.ts](../functions/src/automation/queries.ts)
- [functions/src/automation/recovery.ts](../functions/src/automation/recovery.ts)
- [functions/src/callables/createGenerationBatch.ts](../functions/src/callables/createGenerationBatch.ts)
- [functions/src/callables/createProductGenerationBatch.ts](../functions/src/callables/createProductGenerationBatch.ts)
- [functions/src/callables/generateModelPose.ts](../functions/src/callables/generateModelPose.ts)
- [functions/src/callables/importModelBundle.ts](../functions/src/callables/importModelBundle.ts)
- [functions/src/callables/regenerateJob.helpers.ts](../functions/src/callables/regenerateJob.helpers.ts)
- [functions/src/http/downloadAssets.service.ts](../functions/src/http/downloadAssets.service.ts)
- [functions/src/http/downloadBatchZip.ts](../functions/src/http/downloadBatchZip.ts)
- [functions/src/http/downloadJobImage.ts](../functions/src/http/downloadJobImage.ts)
- [functions/src/http/downloadModelBundle.ts](../functions/src/http/downloadModelBundle.ts)
- [functions/src/http/downloadSelectedJobsZip.ts](../functions/src/http/downloadSelectedJobsZip.ts)
- [functions/src/index.ts](../functions/src/index.ts)
- [functions/src/manglar/access.ts](../functions/src/manglar/access.ts)
- [functions/src/manglar/budget.ts](../functions/src/manglar/budget.ts)
- [functions/src/manglar/catalogService.ts](../functions/src/manglar/catalogService.ts)
- [functions/src/manglar/connections.ts](../functions/src/manglar/connections.ts)
- [functions/src/manglar/context.ts](../functions/src/manglar/context.ts)
- [functions/src/manglar/contracts.json](../functions/src/manglar/contracts.json)
- [functions/src/manglar/estimates.ts](../functions/src/manglar/estimates.ts)
- [functions/src/manglar/execution.ts](../functions/src/manglar/execution.ts)
- [functions/src/manglar/files.ts](../functions/src/manglar/files.ts)
- [functions/src/manglar/models.ts](../functions/src/manglar/models.ts)
- [functions/src/manglar/operations.ts](../functions/src/manglar/operations.ts)
- [functions/src/manglar/reads.ts](../functions/src/manglar/reads.ts)
- [functions/src/manglar/registry.ts](../functions/src/manglar/registry.ts)
- [functions/src/manglar/request.ts](../functions/src/manglar/request.ts)
- [functions/src/manglar/schema.ts](../functions/src/manglar/schema.ts)
- [functions/src/manglar/tools.ts](../functions/src/manglar/tools.ts)
- [functions/src/manglar/wizard.ts](../functions/src/manglar/wizard.ts)
- [functions/src/providers/index.ts](../functions/src/providers/index.ts)
- [functions/src/triggers/onModelWrite.ts](../functions/src/triggers/onModelWrite.ts)
- [functions/src/utils/modelPhotoGeneration.ts](../functions/src/utils/modelPhotoGeneration.ts)
- [functions/src/workers/jobWorker.ts](../functions/src/workers/jobWorker.ts)
- [playwright.config.ts](../playwright.config.ts)
- [plugins/manglar/plugin.json](../plugins/manglar/plugin.json)
- [scripts/generate-manglar-inventory.mjs](../scripts/generate-manglar-inventory.mjs)
- [scripts/generate-manglar-schemas.mjs](../scripts/generate-manglar-schemas.mjs)
- [scripts/verify-manglar-plugin.mjs](../scripts/verify-manglar-plugin.mjs)
- [shared/src/itemKind.ts](../shared/src/itemKind.ts)
- [shared/src/types/automation.ts](../shared/src/types/automation.ts)
- [shared/src/types/index.ts](../shared/src/types/index.ts)
- [shared/src/types/job.ts](../shared/src/types/job.ts)
- [shared/src/types/manglar.ts](../shared/src/types/manglar.ts)
- [shared/src/types/manglarConnection.ts](../shared/src/types/manglarConnection.ts)
- [shared/src/types/model.ts](../shared/src/types/model.ts)
- [src/components/wizard/ProviderSelection.tsx](../src/components/wizard/ProviderSelection.tsx)
- [src/features/automation/useManglarConnection.ts](../src/features/automation/useManglarConnection.ts)
- [src/features/clients/firebase.ts](../src/features/clients/firebase.ts)
- [src/features/evaluation/firebase.ts](../src/features/evaluation/firebase.ts)
- [src/features/generate/wizard/state.ts](../src/features/generate/wizard/state.ts)
- [src/features/models/firebase.ts](../src/features/models/firebase.ts)
- [src/pages/ManglarConnect.tsx](../src/pages/ManglarConnect.tsx)
- [tests/manglarExpanded.test.ts](../tests/manglarExpanded.test.ts)
- [tests/manglarMcp.test.ts](../tests/manglarMcp.test.ts)
- [tests/manglarSerialization.test.ts](../tests/manglarSerialization.test.ts)
