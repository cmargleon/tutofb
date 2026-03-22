# AGENTS

Definicion inicial de agentes para trabajar sobre este repositorio.

Objetivo:
- dividir responsabilidades por dominio real de la app
- evitar que un mismo agente toque cualquier parte del sistema
- dejar un contrato simple en Markdown antes de automatizar ejecucion

## Regla General

Cada agente:
- tiene un alcance claro de negocio
- puede leer todo el repo para entender contexto
- solo debe editar archivos dentro de su scope principal
- debe escalar cambios en `shared/` o flujos transversales
- debe proponer pruebas o validaciones relacionadas con su cambio

Regla operativa de deploy:
- si un cambio afecta codigo ejecutado en `functions/src/`, no alcanza con editar TypeScript: hay que hacer `build` de Functions y, cuando se necesite verlo en Firebase/produccion, tambien `deploy` de Functions
- si el frontend solo muestra datos persistidos por una Function, verificar si hace falta generar una nueva ejecucion para ver el cambio reflejado

Cambios transversales:
- si una tarea toca frontend + functions + `shared/`, debe pasar por un agente coordinador
- si una tarea modifica tipos compartidos, contratos de Firestore o permisos, requiere revision extra

## 1. Coordinador

Nombre: `planner-orchestrator`

Responsabilidad:
- entender la tarea
- decidir que agente debe encargarse
- partir trabajo grande en subtareas
- detectar dependencias entre dominios

Puede tocar:
- este archivo
- documentacion de arquitectura

Debe delegar cuando el cambio pertenezca a un dominio especifico.

## 2. Agente de Generacion

Nombre: `generation-agent`

Responsabilidad:
- wizard de creacion de lotes
- subida de prendas
- configuracion de proveedor, aspect ratio y experimentos
- creacion de `batches` y `jobs`

Scope principal:
- `src/pages/Wizard.tsx`
- `src/components/wizard/`
- `src/features/generate/`
- `src/features/wizard/`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/createGenerationBatch.helpers.ts`

No deberia tocar:
- analytics
- auth/usuarios
- pipeline interno del worker salvo que la tarea lo exija

## 3. Agente de Modelos

Nombre: `models-agent`

Responsabilidad:
- alta de modelos
- biblioteca de modelos
- poses base
- wizard IA para generar candidatos y poses

Scope principal:
- `src/pages/Models.tsx`
- `src/components/models/`
- `src/features/models/`
- `functions/src/callables/generateModelPose.ts`
- `functions/src/providers/textToImage.ts`

No deberia tocar:
- cola operativa
- analytics global

## 4. Agente de Evaluacion

Nombre: `evaluation-agent`

Responsabilidad:
- revision de lotes
- regeneraciones manuales o masivas
- descargas
- historial de outputs
- trazabilidad operativa por job

Scope principal:
- `src/pages/Evaluacion.tsx`
- `src/pages/Cola.tsx`
- `src/components/evaluation/`
- `src/features/evaluation/`
- `src/features/queue/`
- `functions/src/callables/regenerateJob.ts`
- `functions/src/callables/regenerateFailedBatchJobs.ts`
- `functions/src/callables/regenerateJobsBulk.ts`
- `functions/src/callables/cancelPendingBatchJobs.ts`
- `functions/src/http/downloadBatchZip.ts`
- `functions/src/http/downloadJobImage.ts`
- `functions/src/http/downloadSelectedJobsZip.ts`

No deberia tocar:
- creacion de usuarios
- configuracion de alertas

## 5. Agente de Backend Core

Nombre: `backend-core-agent`

Responsabilidad:
- ejecucion real de jobs
- workers
- triggers
- integraciones con proveedores
- reintentos, timeouts y consistencia del pipeline

Scope principal:
- `functions/src/workers/`
- `functions/src/triggers/`
- `functions/src/providers/`
- `functions/src/review/`
- `functions/src/config/`
- `functions/src/firebase/`

Tambien puede tocar:
- `functions/src/index.ts`

Debe tener cuidado especial con:
- estados de `jobs`
- escritura en Storage
- costos por output
- requeue y recuperacion de jobs atascados

## 6. Agente de Analytics y Salud

Nombre: `analytics-health-agent`

Responsabilidad:
- metricas operativas
- dashboards
- costos
- experimentos
- alertas y salud del sistema

Scope principal:
- `src/pages/Analytics.tsx`
- `src/features/analytics/`
- `src/features/system/`
- `functions/src/admin/`
- `functions/src/analytics/`
- `functions/src/triggers/analyticsTriggers.ts`

No deberia tocar:
- wizard de generacion
- CRUD de usuarios salvo permisos ligados a analytics

## 7. Agente de Administracion

Nombre: `admin-agent`

Responsabilidad:
- usuarios
- roles
- clientes
- archivado
- borrado permanente
- permisos y claims

Scope principal:
- `src/pages/Users.tsx`
- `src/pages/Clients.tsx`
- `src/pages/Archive.tsx`
- `src/features/users/`
- `src/features/clients/`
- `src/features/archive/`
- `src/features/auth/`
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
- `functions/src/triggers/syncClaimsOnUserWrite.ts`
- `functions/src/triggers/onClientDelete.ts`
- `functions/src/triggers/onModelDelete.ts`

## 8. Zona Compartida

Archivos especiales:
- `shared/src/types.ts`
- `shared/src/domain.ts`
- `shared/src/constants.ts`
- `shared/src/experiments.ts`

Regla:
- ningun agente de dominio deberia cambiar estos archivos sin justificarlo
- cambios aqui implican impacto potencial en frontend, functions y tests

## 9. Criterio de Asignacion

Usa este criterio rapido:
- si el cambio empieza en el wizard o crea jobs: `generation-agent`
- si el cambio empieza en modelos o poses IA: `models-agent`
- si el cambio empieza en cola, evaluacion, descarga o regeneracion: `evaluation-agent`
- si el cambio empieza en worker, trigger o proveedor: `backend-core-agent`
- si el cambio empieza en metricas, alertas o salud del sistema: `analytics-health-agent`
- si el cambio empieza en usuarios, roles, clientes o archivo: `admin-agent`
- si toca varios dominios: `planner-orchestrator`

## 10. Fase Siguiente

Si mas adelante quieres volver esto ejecutable, el siguiente paso seria:
- crear una carpeta `docs/agents/` con un archivo por agente
- definir prompt, herramientas permitidas y limites por agente
- agregar un coordinador que enrute tareas usando esta misma division
