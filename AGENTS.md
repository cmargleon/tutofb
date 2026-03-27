# AGENTS

Documento regenerado desde la estructura actual del repositorio.

La asignacion de responsabilidades sale de carpetas, paginas, features y entry points que existen hoy en el repo. Si este archivo contradice al codigo, manda el codigo.

## Regla General

Cada agente:
- puede leer todo el repo para entender contexto
- debe editar solo su scope principal salvo coordinacion explicita
- debe escalar cambios en `shared/src/`, reglas de Firebase, permisos, rutas globales, `functions/src/index.ts` o contratos entre frontend y backend
- debe proponer la validacion minima relacionada con su cambio

Validacion recomendada:
- cambio de frontend o hooks: `npm run lint`
- cambio en `functions/src/`: `npm --prefix functions run build`
- cambio en contratos, auth, jobs, analytics o flujos transversales: `npm test`

Reglas operativas:
- si un cambio afecta `functions/src/`, no alcanza con editar TypeScript: hay que compilar Functions
- si ademas se quiere ver el cambio en Firebase remoto, tambien hace falta deploy
- `functions/lib/` es salida generada de build, no fuente de verdad para editar a mano
- si un cambio requiere cualquier paso adicional para funcionar de verdad en el entorno del usuario, el agente debe hacerlo el mismo
- esto incluye build, deploy, reinicios, regeneracion de artefactos, migraciones u otros pasos operativos equivalentes
- no dejar cambios solo en codigo si la app local o remota sigue ejecutando una version vieja
- este proyecto debe asumirse por defecto sobre Firebase real, no sobre emuladores
- correr el frontend en `localhost:3000` no cambia eso por si solo
- antes de responder o ejecutar cambios con impacto en datos, reglas, storage, functions o auth, revisar esta premisa y confirmar si el cambio necesita deploy o una validacion sobre el proyecto remoto

Cambios transversales:
- si una tarea toca frontend + functions + `shared/`, debe pasar por un agente coordinador
- si una tarea modifica colecciones de Firestore, subcolecciones, storage paths o custom claims, requiere revision extra

## 1. Coordinador

Nombre: `planner-orchestrator`

Responsabilidad:
- entender la tarea antes de asignarla
- coordinar cambios que cruzan dominios
- mantener documentacion, shell de la app e infraestructura compartida
- decidir cuando un cambio deja de ser local a un dominio

Scope principal:
- `AGENTS.md`
- `ARCHITECTURE.md`
- `CLAUDE.md`
- `README.md`
- `DECISIONS.md`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `firebase.json`
- `.firebaserc`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `src/app/`
- `src/firebase.ts`
- `src/components/Layout.tsx`
- `src/components/layout/`
- `src/components/ui.tsx`
- `src/features/feedback/`
- `src/features/notifications/`
- `src/features/search/`
- `src/features/storage/`
- `src/features/theme/`
- `src/utils/`

Debe coordinar:
- cambios de rutas globales
- cambios de navegacion
- cambios de infraestructura o configuracion Firebase
- cambios que mezclen varios agentes

## 2. Agente de Generacion

Nombre: `generation-agent`

Responsabilidad:
- flujo del wizard de generacion
- subida de prendas draft
- configuracion de provider, aspect ratio y experimentos
- creacion de batches y jobs desde el frontend y la callable asociada

Scope principal:
- `src/pages/Wizard.tsx`
- `src/components/WizardStepper.tsx`
- `src/components/wizard/`
- `src/features/generate/`
- `src/features/wizard/`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/createGenerationBatch.helpers.ts`

No deberia tocar:
- analytics agregados
- auth, usuarios o claims
- pipeline interno del worker salvo que la tarea lo exija

## 3. Agente de Modelos

Nombre: `models-agent`

Responsabilidad:
- alta y edicion de modelos
- biblioteca de modelos
- carga y mantenimiento de poses
- wizard IA para candidatos y poses derivadas
- generacion de fotos temporales para modelos

Scope principal:
- `src/pages/Models.tsx`
- `src/components/models/`
- `src/features/models/`
- `functions/src/callables/generateModelPose.ts`
- `functions/src/providers/textToImage.ts`

No deberia tocar:
- cola operativa de jobs de batch
- analytics globales salvo lectura puntual para contexto

## 4. Agente de Evaluacion

Nombre: `evaluation-agent`

Responsabilidad:
- revision de batches y jobs
- seleccion manual de outputs
- regeneraciones individuales o masivas
- cancelaciones operativas
- descargas
- cola
- archivo operativo e historial

Scope principal:
- `src/pages/Evaluacion.tsx`
- `src/pages/Cola.tsx`
- `src/pages/Archive.tsx`
- `src/components/evaluation/`
- `src/features/evaluation/`
- `src/features/queue/`
- `src/features/archive/`
- `functions/src/callables/regenerateJob.ts`
- `functions/src/callables/regenerateJob.helpers.ts`
- `functions/src/callables/regenerateFailedBatchJobs.ts`
- `functions/src/callables/regenerateJobsBulk.ts`
- `functions/src/callables/cancelJobGeneration.ts`
- `functions/src/callables/cancelPendingBatchJobs.ts`
- `functions/src/callables/selectJobOutput.ts`
- `functions/src/callables/searchArchive.ts`
- `functions/src/http/downloadBatchZip.ts`
- `functions/src/http/downloadJobImage.ts`
- `functions/src/http/downloadSelectedJobsZip.ts`

No deberia tocar:
- creacion de usuarios o claims
- integraciones de providers
- agregados globales de analytics

## 5. Agente de Backend Core

Nombre: `backend-core-agent`

Responsabilidad:
- ejecucion real de jobs
- triggers y workers
- integraciones con providers
- revision automatica
- reintentos, timeouts y recuperacion de jobs
- consistencia del pipeline server-side

Scope principal:
- `functions/src/workers/`
- `functions/src/workers/PROCESSING_FLOW.md`
- `functions/src/triggers/processJobOnCreate.ts`
- `functions/src/triggers/processJobOnRequeue.ts`
- `functions/src/triggers/requeueExpiredJobs.ts`
- `functions/src/triggers/onJobStatusChange.ts`
- `functions/src/providers/index.ts`
- `functions/src/providers/fal.ts`
- `functions/src/providers/openai.ts`
- `functions/src/providers/types.ts`
- `functions/src/review/`
- `functions/src/config/`
- `functions/src/firebase/`
- `functions/src/utils/`

Debe tener cuidado especial con:
- estados de `jobs`
- subcolecciones `jobs/{jobId}/outputs` y `jobs/{jobId}/logs`
- escrituras en Storage
- requeue y expiracion de claims
- costos por output y auto review

## 6. Agente de Analytics y Salud

Nombre: `analytics-health-agent`

Responsabilidad:
- dashboard operativo
- analytics agregados
- experimentos A/B
- salud de sistema
- alertas compartidas
- reconstruccion de agregados

Scope principal:
- `src/pages/Dashboard.tsx`
- `src/pages/Analytics.tsx`
- `src/features/dashboard/`
- `src/features/analytics/`
- `src/features/system/`
- `functions/src/admin/`
- `functions/src/analytics/`
- `functions/src/triggers/analyticsTriggers.ts`

No deberia tocar:
- wizard de generacion
- CRUD de usuarios salvo que el cambio afecte alertas o permisos de lectura

## 7. Agente de Administracion

Nombre: `admin-agent`

Responsabilidad:
- login y acceso interno
- usuarios
- clientes
- roles y activacion
- archivado y borrado permanente de entidades administrativas
- sincronizacion de claims

Scope principal:
- `src/pages/Login.tsx`
- `src/pages/Users.tsx`
- `src/pages/Clients.tsx`
- `src/features/auth/`
- `src/features/users/`
- `src/features/clients/`
- `functions/src/auth/`
- `functions/src/callables/createAppUser.ts`
- `functions/src/callables/updateAppUser.ts`
- `functions/src/callables/archiveAppUser.ts`
- `functions/src/callables/restoreAppUser.ts`
- `functions/src/callables/permanentlyDeleteAppUser.ts`
- `functions/src/callables/permanentlyDeleteClient.ts`
- `functions/src/callables/permanentlyDeleteModel.ts`
- `functions/src/callables/syncUserClaims.ts`
- `functions/src/callables/userManagement.helpers.ts`
- `functions/src/triggers/deletePlans.ts`
- `functions/src/triggers/syncClaimsOnUserWrite.ts`
- `functions/src/triggers/onClientDelete.ts`
- `functions/src/triggers/onModelDelete.ts`

No deberia tocar:
- pipeline de generacion
- agregados de analytics salvo para revisar impacto de permisos

## 8. Zona Compartida

Archivos especiales:
- `shared/src/types.ts`
- `shared/src/domain.ts`
- `shared/src/constants/`
- `shared/src/experiments.ts`
- `shared/src/utils/`

Regla:
- ningun agente de dominio deberia cambiar estos archivos sin justificarlo
- cambios aqui implican impacto potencial en frontend, functions y tests

## 9. Criterio de Asignacion

Usa este criterio rapido:
- si el cambio empieza en shell, rutas globales, docs o config Firebase: `planner-orchestrator`
- si el cambio empieza en login, usuarios, clientes o claims: `admin-agent`
- si el cambio empieza en modelos, poses o generacion IA de modelos: `models-agent`
- si el cambio empieza en wizard, drafts de prendas o creacion de batches/jobs: `generation-agent`
- si el cambio empieza en cola, evaluacion, archivo, descargas o regeneraciones: `evaluation-agent`
- si el cambio empieza en worker, trigger, provider, runtime o auto review: `backend-core-agent`
- si el cambio empieza en dashboard, analytics, salud o alertas: `analytics-health-agent`
- si toca varios dominios o `shared/`: `planner-orchestrator`

## 10. Siguiente Paso

Si mas adelante quieres volver esto ejecutable, el siguiente paso natural seria:
- mover esta definicion a `docs/agents/`
- crear un archivo por agente con prompt, limites y validaciones
- automatizar el enrutado usando esta misma division
