# ARCHITECTURE

Resumen practico de la arquitectura actual del proyecto.

Este archivo sirve para:
- entender rapido como esta dividido el sistema
- ubicar donde vive cada responsabilidad
- identificar los flujos criticos
- reducir cambios fuera de contexto

## 1. Vision General

La app es una herramienta interna de operacion para catalogo ecommerce montada sobre Firebase.

Capacidades principales:
- autenticacion interna con roles
- administracion de clientes y usuarios
- alta de modelos y poses
- wizard para crear lotes de generacion
- procesamiento server-side de jobs con proveedores externos
- evaluacion, regeneracion, descarga y archivo
- analytics operativos y de costo

Stack principal:
- frontend: React 19 + TypeScript + Vite
- backend: Firebase Cloud Functions v2
- base de datos: Firestore
- archivos: Cloud Storage
- auth: Firebase Auth

## 2. Capas del Sistema

### Frontend

Ubicacion:
- `src/app/`
- `src/pages/`
- `src/components/`
- `src/features/`

Responsabilidad:
- renderizar la UI interna
- manejar navegacion y permisos por rol
- leer y escribir datos a Firestore y Functions
- reflejar estado operativo de lotes, jobs, analytics y archivo

Patron dominante:
- paginas en `src/pages/`
- logica de dominio en `src/features/`
- componentes visuales en `src/components/`

### Backend Functions

Ubicacion:
- `functions/src/`

Responsabilidad:
- exponer callables y endpoints HTTP
- ejecutar procesamiento real de jobs
- reaccionar a eventos de Firestore
- mantener consistencia operativa y analytics

Subareas:
- `callables/`: acciones invocadas desde frontend
- `http/`: descargas y endpoints directos
- `workers/`: pipeline de ejecucion de jobs
- `triggers/`: reaccion a cambios en Firestore
- `providers/`: integracion con proveedores de IA
- `admin/`: salud del sistema y tareas administrativas
- `review/`: revision automatica de imagenes

### Shared

Ubicacion:
- `shared/src/`

Responsabilidad:
- tipos de dominio
- constantes compartidas
- reglas y helpers de negocio que frontend y backend deben compartir

Pieza critica:
- `shared/src/types.ts`

## 3. Dominios Funcionales

### Auth y permisos

Archivos principales:
- `src/features/auth/`
- `functions/src/auth/`
- `functions/src/callables/syncUserClaims.ts`
- `functions/src/triggers/syncClaimsOnUserWrite.ts`

Modelo:
- el usuario autentica por Firebase Auth
- Firestore guarda el documento `users/{uid}`
- el rol y estado activo se sincronizan a custom claims

Roles actuales:
- `admin`
- `operador`
- `revisor`

### Catalogo operativo

Dominios:
- clientes
- modelos
- poses
- prendas temporales
- batches
- jobs
- outputs

Entidades clave:
- `Client`
- `Model`
- `Batch`
- `Job`
- `JobOutput`

Los contratos viven en:
- `shared/src/types.ts`

### Generacion

Frontend:
- `src/pages/Wizard.tsx`
- `src/features/generate/`
- `src/components/wizard/`

Backend:
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/providers/`
- `functions/src/triggers/processJobOnCreate.ts`
- `functions/src/triggers/processJobOnRequeue.ts`

Responsabilidad:
- seleccionar cliente, modelo, poses y prendas
- crear un lote
- crear un job por combinacion
- disparar procesamiento automatico

### Modelos con IA

Frontend:
- `src/pages/Models.tsx`
- `src/features/models/`
- `src/components/models/`

Backend:
- `functions/src/callables/generateModelPose.ts`
- `functions/src/providers/textToImage.ts`

Responsabilidad:
- generar candidatos de identidad
- generar poses derivadas
- convertir poses aceptadas en un modelo usable para el flujo de catalogo

### Evaluacion y cola

Frontend:
- `src/pages/Evaluacion.tsx`
- `src/pages/Cola.tsx`
- `src/features/evaluation/`
- `src/features/queue/`
- `src/components/evaluation/`

Backend:
- `functions/src/callables/regenerateJob.ts`
- `functions/src/callables/regenerateFailedBatchJobs.ts`
- `functions/src/callables/regenerateJobsBulk.ts`
- `functions/src/callables/cancelPendingBatchJobs.ts`
- `functions/src/http/`

Responsabilidad:
- revisar resultados por lote
- descargar imagenes
- reintentar jobs
- cancelar pendientes
- visualizar la cola operativa

### Analytics y salud

Frontend:
- `src/pages/Analytics.tsx`
- `src/features/analytics/`
- `src/features/system/`

Backend:
- `functions/src/analytics/`
- `functions/src/admin/`
- `functions/src/triggers/analyticsTriggers.ts`

Responsabilidad:
- volumen operativo
- costo por proveedor
- clientes y modelos mas activos
- experimentos
- salud de proveedores y cola
- alertas compartidas

### Archivo y administracion

Frontend:
- `src/pages/Archive.tsx`
- `src/pages/Users.tsx`
- `src/pages/Clients.tsx`
- `src/features/archive/`
- `src/features/users/`
- `src/features/clients/`

Backend:
- callables de usuarios y borrado
- triggers de cascada para clientes y modelos

Responsabilidad:
- administrar usuarios y clientes
- archivar entidades
- borrar definitivamente cuando aplique

## 4. Flujo Principal de Generacion

Secuencia resumida:

1. El usuario arma un lote desde el wizard.
2. El frontend sube prendas draft a Storage.
3. `createGenerationBatch` valida entrada y crea un `batch`.
4. La misma callable crea un `job` por combinacion pose-prenda.
5. Un trigger detecta jobs pendientes y llama al worker.
6. El worker reclama el job por transaccion.
7. El worker genera URLs o descarga assets necesarios.
8. El worker invoca al proveedor configurado.
9. El resultado se guarda en Storage.
10. Se crea un `output` historico bajo `jobs/{jobId}/outputs`.
11. Gemini revisa el resultado.
12. El job queda `completed`, vuelve a `pending` para otro intento o termina en `failed`.
13. Triggers actualizan agregados y analytics.

## 5. Modelo de Datos Operativo

Principio central:
- `jobs` representa el estado actual
- `outputs` representa el historial real de resultados generados

Implicaciones:
- una regeneracion no borra el historial
- el output vigente se refleja en `currentOutput`
- el costo acumulado debe calcularse sobre outputs
- la operacion actual de la cola debe calcularse sobre jobs

Colecciones importantes:
- `users`
- `clients`
- `models`
- `batches`
- `jobs`
- `jobs/{jobId}/outputs`
- `jobs/{jobId}/logs`
- `analytics_summary`
- `analytics_daily`
- `analytics_clients`
- `analytics_providers`
- `analytics_client_providers`
- `analytics_client_models`
- `model_generation_logs`

## 6. Routing y permisos

La navegacion principal vive en:
- `src/app/AppRouter.tsx`

Rutas clave:
- `/users`
- `/clients`
- `/models`
- `/generate`
- `/cola`
- `/evaluacion`
- `/archivo`
- `/analytics`

Permisos:
- `admin`: gestion completa
- `operador`: generar y operar lotes
- `revisor`: evaluacion, archivo y analytics

## 7. Integraciones Externas

Actualmente hay integraciones con:
- fal.ai
- OpenAI
- Gemini

Uso general:
- fal.ai y OpenAI: generacion o edicion de imagen
- Gemini: revision automatica del resultado

La configuracion vive en:
- `functions/src/config/runtime.ts`

## 8. Patrones Importantes

### Frontend por feature

Evitar logica grande dentro de paginas.
Preferir:
- hooks y acceso a datos en `src/features/`
- componentes en `src/components/`
- pagina como ensamblaje de secciones

### Backend orientado a eventos

El backend no depende solo de requests directos.
Gran parte del comportamiento nace de:
- creacion de documentos
- cambios de estado
- triggers de Firestore

### Tipos compartidos como contrato

Cuando cambia un tipo en `shared/`, puede romper:
- formularios frontend
- callables
- workers
- analytics
- tests

Por eso `shared/` debe tocarse con cuidado.

## 9. Zonas de Riesgo

Las areas mas sensibles del sistema son:
- `shared/src/types.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/triggers/analyticsTriggers.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/regenerateJob.ts`
- reglas de borrado en cascada
- cualquier cambio en estados de `Job` y `Batch`

Riesgos frecuentes:
- doble conteo de costos
- romper regeneracion conservando historial
- inconsistencias entre `jobs` y `outputs`
- permisos desalineados entre frontend y backend
- cambios transversales sin actualizar tests

## 10. Como usar este archivo

Antes de cambiar algo:
- ubicar el dominio funcional
- revisar si afecta frontend, functions o ambos
- verificar si toca `shared/`
- validar si impacta jobs, outputs, analytics o permisos

Si una tarea toca varias capas:
- empezar por este archivo
- luego revisar `AGENTS.md`
- despues entrar a los archivos del dominio especifico

## 11. Documentos Relacionados

- `README.md`
- `AGENTS.md`
- `functions/src/workers/PROCESSING_FLOW.md`

