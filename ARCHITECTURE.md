# ARCHITECTURE

Documento regenerado desde la estructura y el codigo actual del repositorio.

Objetivo:
- describir lo que hoy se puede verificar en el repo
- reducir supuestos heredados de otras apps
- dejar un mapa util para ubicar responsabilidades y zonas sensibles

Si este archivo contradice al codigo, manda el codigo.

## 1. Snapshot del repositorio

El repo esta organizado en tres capas principales:

- `src/`: frontend SPA con React 19, TypeScript y Vite
- `functions/src/`: backend con Firebase Cloud Functions v2
- `shared/src/`: contrato compartido entre frontend y backend

Infraestructura visible en el repo:
- `firebase.json`: Hosting, Firestore, Storage, Functions y emuladores
- `.firebaserc`: proyecto por defecto
- `firestore.rules`, `firestore.indexes.json`, `storage.rules`
- `firebase-applet-config.json`: configuracion del cliente Firebase usada por `src/firebase.ts`
- `tests/`: suite de pruebas del repo

Herramientas y scripts observados:
- raiz: `npm run dev`, `npm run build`, `npm run lint`, `npm test`
- functions: `npm --prefix functions run build`, `serve`, `deploy`, `logs`

## 2. Mapa del frontend

### Shell y providers

- `src/app/App.tsx`: monta `ErrorBoundary`, `ThemeProvider`, `FeedbackProvider` y `AuthProvider`
- `src/app/AppRouter.tsx`: define rutas protegidas y chequeo de roles
- `src/components/Layout.tsx` y `src/components/layout/`: shell principal, sidebar y busqueda global
- `src/components/ui.tsx`: componentes UI reutilizables

### Rutas observadas

| Ruta | Pagina | Roles permitidos |
| --- | --- | --- |
| `/login` | `src/pages/Login.tsx` | publica |
| `/` | `src/pages/Dashboard.tsx` | autenticado y activo |
| `/users` | `src/pages/Users.tsx` | `admin` |
| `/clients` | `src/pages/Clients.tsx` | `admin` |
| `/models` | `src/pages/Models.tsx` | `admin` |
| `/generate` | `src/pages/Wizard.tsx` | `admin`, `operador` |
| `/cola` | `src/pages/Cola.tsx` | `admin`, `operador`, `revisor` |
| `/evaluacion` | `src/pages/Evaluacion.tsx` | `admin`, `operador`, `revisor` |
| `/archivo` | `src/pages/Archive.tsx` | `admin`, `operador`, `revisor` |
| `/analytics` | `src/pages/Analytics.tsx` | `admin`, `revisor` |

### Features del frontend

Dominios visibles por carpeta:
- `src/features/auth/`: estado de sesion, lectura de `users/{uid}` y sync de claims
- `src/features/clients/`: CRUD y archivado de clientes
- `src/features/models/`: catalogo de modelos, poses y generacion IA de fotos de modelo
- `src/features/generate/` y `src/features/wizard/`: wizard, subida de prendas draft y envio de batches
- `src/features/evaluation/`: evaluacion, traceabilidad, output history, regeneracion y descargas
- `src/features/queue/`: lectura de batches y jobs para la cola
- `src/features/archive/`: busqueda historica y apertura de batches archivados
- `src/features/dashboard/`: resumen operativo para la home
- `src/features/analytics/`: dashboard de analytics y experimentos
- `src/features/system/`: salud del sistema y alertas
- `src/features/search/`, `src/features/notifications/`, `src/features/feedback/`, `src/features/theme/`, `src/features/storage/`: soporte transversal del shell

## 3. Mapa del backend

### Entry points exportados

`functions/src/index.ts` exporta estas areas:

- Callables:
  - `createGenerationBatch`
  - `regenerateJob`
  - `cancelJobGeneration`
  - `selectJobOutput`
  - `regenerateFailedBatchJobs`
  - `cancelPendingBatchJobs`
  - `regenerateJobsBulk`
  - `searchArchive`
  - `syncUserClaims`
  - `createAppUser`
  - `updateAppUser`
  - `archiveAppUser`
  - `restoreAppUser`
  - `permanentlyDeleteAppUser`
  - `permanentlyDeleteClient`
  - `permanentlyDeleteModel`
  - `generateModelPose`
- Admin:
  - `rebuildAnalytics`
  - `getSystemHealth`
  - `updateSystemAlertSettings`
- HTTP:
  - `downloadBatchZip`
  - `downloadJobImage`
  - `downloadSelectedJobsZip`
- Triggers:
  - `onJobStatusChange`
  - `onClientDelete`
  - `onModelDelete`
  - `processJobOnCreate`
  - `processJobOnRequeue`
  - `requeueExpiredJobs`
  - `analyticsTriggers`
  - `syncClaimsOnUserWrite`

### Carpetas backend

- `functions/src/callables/`: acciones invocadas desde frontend
- `functions/src/http/`: descargas de imagenes y ZIPs
- `functions/src/workers/`: worker de jobs y documentacion del flujo
- `functions/src/triggers/`: procesamiento, analytics, borrados y sync de claims
- `functions/src/providers/`: integraciones con providers de imagen
- `functions/src/review/`: auto review con Gemini
- `functions/src/admin/`: rebuild de analytics, salud y alertas
- `functions/src/auth/`: autorizacion por rol
- `functions/src/config/`: runtime params y secrets
- `functions/src/firebase/`: acceso compartido a Firebase Admin

## 4. Contrato compartido

`shared/src/` es la capa comun entre frontend y backend.

Piezas principales:
- `shared/src/types.ts`: entidades, requests, responses, analytics y salud
- `shared/src/domain.ts`: enums, labels, helpers de dominio y prompt base de generacion
- `shared/src/constants/`: costos por provider y otras constantes
- `shared/src/experiments.ts`: configuracion de experimentos
- `shared/src/utils/dateUtils.ts`: helpers de fecha usados en varias capas

Cambiar `shared/src/` implica revisar frontend, Functions y tests.

## 5. Modelo de datos observable

Colecciones y documentos que aparecen en el codigo:

- `users`
- `clients`
- `models`
- `batches`
- `jobs`
- `jobs/{jobId}/outputs`
- `jobs/{jobId}/logs`
- `analytics_summary/global`
- `analytics_daily/{date}`
- `analytics_providers/{provider}`
- `analytics_clients/{clientId}`
- `analytics_client_providers/{clientId__provider}`
- `analytics_client_models/{clientId__modelId}`
- `system_alert_settings/global`
- `model_generation_logs`

Entidades principales visibles en `shared/src/types.ts`:
- `User`
- `Client`
- `Model`
- `Pose`
- `Batch`
- `Job`
- `JobOutput`
- `JobLog`
- `Analytics*`
- `SystemHealthSnapshot`

Semantica confirmada por tipos y worker:
- `Batch` agrega estado por lote
- `Job` representa el estado operativo actual
- `JobOutput` representa outputs persistidos por job
- `JobLog` guarda eventos operativos y de traceabilidad
- auth usa roles `admin`, `operador`, `revisor`

## 6. Storage observable

Paths que aparecen en el codigo:

- drafts de prendas: `garments/drafts/{uid}/{draftBatchId}/{garmentId}.jpg`
- outputs generados: `generated/{clientId}/{batchId}/{jobId}/{outputId}.{ext}`
- modelos y poses: `models/{clientId}/{modelId}/poses/{poseId}-{fileName}`
- fotos IA de modelos: `model_generations/{clientId}/...`

## 7. Flujos confirmados por codigo

### Auth y acceso

- login con email/password en `src/pages/Login.tsx`
- despues del login se consulta `users/{uid}`
- si el usuario existe y esta activo, se llama `syncUserClaims`
- `AppRouter` protege rutas usando el usuario autenticado y su rol
- backend valida roles con `functions/src/auth/roles.ts`

### Generacion de batches

- el frontend sube prendas a Storage desde `src/features/generate/storage.ts`
- el wizard arma `CreateGenerationBatchRequest`
- `createGenerationBatch` valida cliente, modelo, poses y prendas
- la callable crea un documento `batch` y uno o varios `jobs`
- si hay experimento, una combinacion pose/prenda puede expandirse en varios brazos

### Pipeline de jobs

- `processJobOnCreate` y `processJobOnRequeue` disparan el worker
- `functions/src/workers/jobWorker.ts` reclama el job, llama al provider y guarda el output en Storage
- el worker escribe `jobs/{jobId}/outputs/{outputId}` y logs operativos
- el mismo worker ejecuta auto review con Gemini
- `requeueExpiredJobs` recupera jobs atascados por timeout o claim vencido
- `onJobStatusChange` actualiza agregados del batch

### Evaluacion y archivo

- evaluacion y archivo leen `batches`, `jobs`, `outputs` y `logs`
- hay callables para regenerar, cancelar, seleccionar output y buscar archivo
- las descargas salen por endpoints HTTP que arman imagenes individuales o ZIPs

### Analytics y salud

- `analyticsTriggers.ts` mantiene agregados a partir de `jobs` y `outputs`
- `rebuildAnalytics` recompone agregados leyendo `jobs` y `collectionGroup('outputs')`
- `getSystemHealth` combina checks de providers, estado de cola y alertas compartidas
- `updateSystemAlertSettings` escribe la configuracion de alertas

### Generacion IA de modelos

- `generateModelPose` genera imagenes temporales para modelos
- esas imagenes se guardan en Storage bajo `model_generations/...`
- el callable registra costo estimado en `model_generation_logs`

## 8. Zonas sensibles

Archivos y areas con impacto transversal:
- `src/app/AppRouter.tsx`
- `src/firebase.ts`
- `shared/src/types.ts`
- `shared/src/domain.ts`
- `functions/src/index.ts`
- `functions/src/auth/roles.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/regenerateJob.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/triggers/analyticsTriggers.ts`
- `functions/src/admin/getSystemHealth.ts`

## 9. Como leer este repo sin asumir de mas

Orden recomendado:
1. `src/app/AppRouter.tsx` para ver rutas y roles
2. `shared/src/types.ts` para ver entidades y contratos
3. `functions/src/index.ts` para ver entry points reales
4. `functions/src/workers/jobWorker.ts` para entender el pipeline central
5. `tests/` para ver que comportamientos ya estan cubiertos
