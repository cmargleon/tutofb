Informe de extracción de estimateGenerationHold — 6 de noviembre de 2026

La política pura vive en `functions/src/costs/generationEstimates.ts`. Reutiliza `shared/src/constants/providerCosts.ts` sin modificar tarifas. También contiene `GEMINI_OPERATION_HOLD_USD = 0.05`, compartido por Automation y Manglar. `automation/budget.ts` reexporta ambos símbolos para conservar compatibilidad.

El cálculo extraído coincide literalmente, mediante comparación de AST, con el de HEAD. Conserva los cinco proveedores fijos, el conteo de referencias recibido, los redondeos del cálculo compartido, el mínimo de US$0.50, el multiplicador ×4 y los campos `estimateUsd`, `holdUsd` y `fixed`. No añade normalización ni redondeo al hold.

Antes de editar se localizaron `providers/index.ts`, `manglar/estimates.ts`, `workers/jobWorker.ts`, `analytics/geminiUsage.ts`, `automation/plans.ts`, `utils/modelPhotoGeneration.ts` y review. Los seis consumidores importan ahora desde costes. Review conserva `AutomationBudgetError` y la llamada instrumentada a Gemini; no se editó.

En el snapshot desplegado, los siete módulos modificados conservan idéntico código operativo después de excluir imports/reexports y las dos declaraciones extraídas. Automation sigue reservando/liquidando sus operaciones. Manglar mantiene autorización delegada y presupuesto; ambos libros permanecen separados. No se movió ninguna reserva respecto de llamadas externas, ni se alteraron errores ambiguos o holds inciertos.

Las pruebas y el despliegue se aislaron sobre HEAD `8694f8057e399ad8d5ffc4e17e874100bf9d6312` más los nueve archivos siguientes. Se excluyeron cambios concurrentes ajenos de Catálogo, Organizer y compresión de imágenes, incluidos cambios concurrentes en el mismo worker. Esos cambios permanecen intactos en el workspace.

| Archivo de esta tarea | Cambio |
| --- | --- |
| `functions/src/costs/generationEstimates.ts` | Nuevo módulo puro de estimaciones |
| `functions/src/automation/budget.ts` | Reexportación compatible; libro sin cambios operativos |
| `functions/src/automation/plans.ts` | Import de costes |
| `functions/src/providers/index.ts` | Import de costes |
| `functions/src/manglar/estimates.ts` | Import de costes |
| `functions/src/workers/jobWorker.ts` | Separar import de estimación del de operaciones |
| `functions/src/analytics/geminiUsage.ts` | Separar import de constante del de operaciones |
| `functions/src/utils/modelPhotoGeneration.ts` | Import de costes |
| `tests/providerCosts.test.ts` | Paridad, configuración histórica, import puro y compatibilidad |

Validación:

- `npm --prefix functions run lint` y `npm --prefix functions run build`: aprobados en el snapshot aislado y en el workspace actual.
- `npm test`: snapshot aislado 210 aprobadas y 13 omitidas; workspace actual 219 aprobadas y 13 omitidas. Las omitidas requieren emuladores.
- `tests/providerCosts.test.ts` y `tests/providers.test.ts`: aprobadas. La matriz comprueba los 11 proveedores, cuatro estados de configuración y nueve conteos de referencias (396 combinaciones), más ocho casos explícitos con opciones no predeterminadas.
- `tests/falImageModels.test.ts`, `tests/automationAdvanced.integration.test.ts`, `tests/manglarExpanded.test.ts`, `tests/manglarMcp.test.ts`, `tests/manglarSerialization.test.ts` y `tests/manglarModelPersistence.test.ts`: aprobadas por suite con emuladores y proveedores simulados. El conjunto específico cubre 79 comprobaciones, sin omisiones.
- El proceso hijo de la prueba de importación rechaza cualquier carga de un módulo Firebase: importar y usar la estimación funciona sin cargar ni inicializar Firebase.
- `git diff --check`: aprobado.

Incidencias de infraestructura/fixtures resueltas: los puertos habituales estaban ocupados, por lo que se usaron puertos y TMPDIR privados. Solo en la copia temporal del fixture Manglar se sustituyó su URL Storage fija por FIREBASE_STORAGE_EMULATOR_HOST; no se cambió el fixture del repo ni firebase.json. El primer grupo combinado dejó cinco casos de persistencia fallidos (y su suite padre) porque Automation termina estableciendo un máximo demo de US$0.01 y persistencia pide US$1. Persistencia se repitió en emuladores recién iniciados: 11/11 aprobadas. No se repararon saldos ni se modificó la política para hacer pasar las pruebas.

Despliegue selectivo en `tutofb-260320-1003`, región `us-central1`, Node.js 22, segunda generación. El grafo de imports identifica 23 consumidores, incluidos los transitivos de Organizer. El primer intento tuvo errores 429 de cuota y solo confirmó 16 actualizaciones aunque terminó con código 0. Se detectaron siete pendientes mediante metadatos y se completaron en grupos de cuatro y tres; ambos reintentos finalizaron con Deploy complete.

Verificación final mediante Firebase Functions y metadatos Cloud Run: las 23 funciones están ACTIVE; sus hashes corresponden al código desplegado, cambiaron de revisión respecto de la captura previa y reciben el 100% del tráfico en su nueva revisión lista. Verificado a 2026-11-06 20:57:19 UTC.

| Consumidor | Revisión previa | Revisión final | Estado/tráfico |
| --- | --- | --- | --- |
| `automationApi` | `automationapi-00017-cad` | `automationapi-00018-yoz` | ACTIVE / 100% |
| `automationGenerationProgress` | `automationgenerationprogress-00013-xay` | `automationgenerationprogress-00014-bom` | ACTIVE / 100% |
| `automationIntakeWorker` | `automationintakeworker-00021-noz` | `automationintakeworker-00022-vuc` | ACTIVE / 100% |
| `classifyGarmentViewsWithGemini` | `classifygarmentviewswithgemini-00078-lad` | `classifygarmentviewswithgemini-00079-kag` | ACTIVE / 100% |
| `createAutomationJob` | `createautomationjob-00012-yis` | `createautomationjob-00013-nen` | ACTIVE / 100% |
| `createAutomationPlan` | `createautomationplan-00009-zuq` | `createautomationplan-00010-kuy` | ACTIVE / 100% |
| `createGenerationBatch` | `creategenerationbatch-00102-car` | `creategenerationbatch-00103-rog` | ACTIVE / 100% |
| `executeAutomationPlanCallable` | `executeautomationplancallable-00009-dib` | `executeautomationplancallable-00010-lok` | ACTIVE / 100% |
| `generateModelPose` | `generatemodelpose-00098-vik` | `generatemodelpose-00099-yux` | ACTIVE / 100% |
| `getAutomationPlan` | `getautomationplan-00008-hok` | `getautomationplan-00009-zuc` | ACTIVE / 100% |
| `manglarMcp` | `manglarmcp-00017-vim` | `manglarmcp-00018-yuw` | ACTIVE / 100% |
| `onModelWrite` | `onmodelwrite-00069-wix` | `onmodelwrite-00070-neb` | ACTIVE / 100% |
| `organizerAction` | `organizeraction-00010-beq` | `organizeraction-00011-yoc` | ACTIVE / 100% |
| `organizerScheduler` | `organizerscheduler-00013-zuc` | `organizerscheduler-00015-mok` | ACTIVE / 100% |
| `previewProductDrafts` | `previewproductdrafts-00066-viz` | `previewproductdrafts-00067-yoz` | ACTIVE / 100% |
| `processJobOnActivation` | `processjobonactivation-00030-xuq` | `processjobonactivation-00031-qoz` | ACTIVE / 100% |
| `processJobOnCreate` | `processjoboncreate-00104-hib` | `processjoboncreate-00105-zaq` | ACTIVE / 100% |
| `processJobOnRequeue` | `processjobonrequeue-00104-les` | `processjobonrequeue-00105-sem` | ACTIVE / 100% |
| `recoverAutomationImports` | `recoverautomationimports-00011-pip` | `recoverautomationimports-00012-wic` | ACTIVE / 100% |
| `requeueExpiredJobsOnSchedule` | `requeueexpiredjobsonschedule-00103-zuk` | `requeueexpiredjobsonschedule-00104-sew` | ACTIVE / 100% |
| `resumeAutomationJob` | `resumeautomationjob-00007-sin` | `resumeautomationjob-00008-vuh` | ACTIVE / 100% |
| `retryAutomationJob` | `retryautomationjob-00012-buw` | `retryautomationjob-00013-yah` | ACTIVE / 100% |
| `retryJobAutoReview` | `retryjobautoreview-00076-nup` | `retryjobautoreview-00077-deq` | ACTIVE / 100% |

No se desplegaron Hosting, reglas, índices ni otros targets. No se cambiaron tarifas, dependencias, contratos o secretos. No se invocaron operaciones de negocio ni proveedores pagados en producción; no se modificaron documentos existentes de producción ni se repararon saldos. Las escrituras de pruebas se limitaron a fixtures sintéticos en emuladores demo. No se hicieron commits ni pushes.

Este informe documenta únicamente esta extracción y su snapshot desplegado; el workspace conserva otros trabajos concurrentes.
