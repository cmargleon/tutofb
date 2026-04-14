# ARCHITECTURE

Documento regenerado desde la estructura y el codigo actual del repositorio.

Objetivo:
- describir lo que hoy se puede verificar en el repo
- reducir supuestos heredados de iteraciones anteriores
- dejar un mapa util para ubicar responsabilidades, contratos y zonas sensibles

Si este archivo contradice al codigo, manda el codigo.

## 1. Snapshot del repositorio

El repo esta organizado en tres capas principales:

- `src/`: frontend SPA con React 19, TypeScript y Vite
- `functions/src/`: backend con Firebase Cloud Functions v2
- `shared/src/`: contrato compartido entre frontend y backend

Infraestructura y config visibles:
- `firebase.json`: Hosting, Firestore, Storage, Functions y emuladores
- `.firebaserc`: proyecto Firebase por defecto
- `firestore.rules`, `firestore.indexes.json`, `storage.rules`
- `firebase-applet-config.json`: configuracion del cliente Firebase usada por `src/firebase.ts`
- `.env.example`: flags locales para frontend y referencia de params/secrets de Functions
- `playwright.config.ts`: configuracion E2E
- `tests/` y `e2e/`: validacion automatizada

Scripts observados:
- raiz: `npm run dev`, `npm run build`, `npm run preview`, `npm run clean`, `npm run lint`, `npm test`
- functions: `npm --prefix functions run build`, `serve`, `shell`, `deploy`, `logs`

## 2. Mapa del frontend

### Shell y providers

- `src/app/App.tsx`: monta `ErrorBoundary`, `ThemeProvider`, `FeedbackProvider` y `AuthProvider`
- `src/app/AppRouter.tsx`: define rutas protegidas, lazy loading y chequeo de roles
- `src/components/Layout.tsx`: shell principal con sidebar, header y outlet
- `src/components/layout/Sidebar.tsx`: navegacion lateral por permisos
- `src/components/layout/GlobalSearch.tsx`: busqueda global de clientes, modelos y batches
- `src/components/ui.tsx`: componentes UI reutilizables

### Rutas observadas

| Ruta | Pagina | Roles permitidos |
| --- | --- | --- |
| `/login` | `src/pages/Login.tsx` | publica |
| `/` | `src/pages/Dashboard.tsx` | autenticado y activo |
| `/users` | redirect a `/users/crear` | `admin` |
| `/users/crear` | `src/pages/Users.tsx` (`view="create"`) | `admin` |
| `/users/lista` | `src/pages/Users.tsx` (`view="list"`) | `admin` |
| `/clients` | redirect a `/clients/crear` o `/clients/lista` | `admin` |
| `/clients/crear` | `src/pages/Clients.tsx` (`view="create"`) | `admin` |
| `/clients/lista` | `src/pages/Clients.tsx` (`view="list"`) | `admin` |
| `/models` | redirect a `/models/catalogo` | `admin` |
| `/models/generar` | `src/pages/ModelsGenerate.tsx` | `admin` |
| `/models/catalogo` | `src/pages/ModelsCatalog.tsx` | `admin` |
| `/generate` | `src/pages/Wizard.tsx` | `admin`, `operador` |
| `/cola` | `src/pages/Cola.tsx` | `admin`, `operador`, `revisor` |
| `/catalogo` | `src/pages/Catalogo.tsx` | `admin`, `operador`, `revisor` |
| `/analytics` | `src/pages/Analytics.tsx` | `admin`, `revisor` |
| `/configuracion` | `src/pages/Configuracion.tsx` | `admin` |

### Features del frontend

Dominios visibles por carpeta:
- `src/features/auth/`: sesion, lectura de `users/{uid}` y capacidades por rol
- `src/features/users/`: CRUD y filtros operativos de usuarios internos
- `src/features/clients/`: CRUD de clientes y gestion de spreadsheet templates
- `src/features/models/`: catalogo de modelos, poses, wizard IA y carga de referencias
- `src/features/generate/` y `src/features/wizard/`: wizard, uploads draft, clasificacion de vistas y envio de batches
- `src/features/evaluation/`: seleccion manual de outputs, traceabilidad, output history, product drafts, regeneracion y descargas
- `src/features/queue/`: vista operativa de batches activos
- `src/features/catalog/`: catalogo visual de jobs completados agrupados por prenda y batch, con acciones operativas
- `src/features/dashboard/`: snapshot operativo para la home
- `src/features/analytics/`: analytics agregados y uso de Gemini
- `src/features/system/`: salud del sistema, alertas y config operativa compartida
- `src/features/search/`, `src/features/notifications/`, `src/features/feedback/`, `src/features/theme/`, `src/features/storage/`: soporte transversal

## 3. Mapa del backend

### Entry points exportados

`functions/src/index.ts` exporta estas areas:

- Callables de generacion:
  - `createGenerationBatch`
  - `classifyGarmentViewsWithGemini`
  - `previewProductDrafts`
- Callables operativas de cola y catalogo:
  - `regenerateJob`
  - `deleteJob`
  - `retryJobAutoReview`
  - `cancelJobGeneration`
  - `cancelBatchProcessing`
  - `selectJobOutput`
  - `updateBatchProductDraft`
  - `exportBatchSpreadsheet`
  - `regenerateFailedBatchJobs`
  - `cancelPendingBatchJobs`
  - `regenerateJobsBulk`
- Callables de administracion, clientes y modelos:
  - `syncUserClaims`
  - `createAppUser`
  - `updateAppUser`
  - `archiveAppUser`
  - `restoreAppUser`
  - `permanentlyDeleteAppUser`
  - `permanentlyDeleteClient`
  - `permanentlyDeleteModel`
  - `generateModelPose`
  - `importClientSpreadsheetTemplate`
  - `deleteClientSpreadsheetTemplate`
  - `updateClientSpreadsheetTemplateCategory`
  - `importModelBundle`
- Admin:
  - `rebuildAnalytics`
  - `getSystemHealth`
  - `updateSystemAlertSettings`
  - `tagModelPosesWithGemini`
  - `backfillModelPoses`
  - `updateSystemConfig`
  - `getSystemConfig`
- HTTP:
  - `downloadBatchZip`
  - `downloadJobImage`
  - `downloadModelBundle`
  - `downloadSelectedJobsZip`
  - `publicGeneratedImage`
- Triggers:
  - `onJobStatusChange`
  - `processJobOnActivation`
  - `onClientDelete`
  - `onModelDelete`
  - `processJobOnCreate`
  - `processJobOnRequeue`
  - `requeueExpiredJobsOnSchedule`
  - `analyticsTriggers`
  - `onModelWrite`
  - `syncClaimsOnUserWrite`
  - `storageCleanupOnSchedule`
  - `onJobCompletedSquareCrop`

Notas operativas visibles:
- `admin.initializeApp()` se ejecuta en `functions/src/index.ts`
- `setGlobalOptions({ maxInstances: 10 })` limita concurrencia global de Functions

### Carpetas backend

- `functions/src/callables/`: acciones invocadas desde frontend
- `functions/src/http/`: descargas de imagenes y ZIPs
- `functions/src/http/publicGeneratedImage.ts`: proxy publico restringido para servir solo assets bajo `generated/`
- `functions/src/workers/`: worker de jobs y documentacion del flujo
- `functions/src/triggers/`: procesamiento, analytics, borrados, sync de claims y cleanup
- `functions/src/providers/`: integraciones con providers de imagen
- `functions/src/review/`: auto review con Gemini
- `functions/src/admin/`: rebuild de analytics, salud, alertas y config operativa
- `functions/src/auth/`: autorizacion por rol
- `functions/src/config/`: runtime params y secrets
- `functions/src/firebase/`: acceso compartido a Firebase Admin
- `functions/src/spreadsheets/`: parseo de templates y generacion/export de product drafts
- `functions/src/utils/`: helpers server-side varios

## 4. Contrato compartido

`shared/src/` es la capa comun entre frontend y backend.

Piezas principales:
- `shared/src/types/`: entidades, requests, responses, analytics, system config y salud
- `shared/src/domain.ts`: enums, labels, validadores y prompt base de generacion
- `shared/src/constants.ts` y `shared/src/constants/providerCosts.ts`: constantes de dominio y costos
- `shared/src/providerImageConfig.ts`: tipos de configuracion por provider
- `shared/src/reviewMetrics.ts`: metricas derivadas de review
- `shared/src/utils/dateUtils.ts`: helpers de fecha
- `shared/src/utils/garmentViewMatching.ts`: matching pose-prenda por vistas compatibles
- `shared/src/utils/poseAiClassification.ts`: normalizacion de tagging IA de poses

Cambiar `shared/src/` implica revisar frontend, Functions y tests.

## 5. Modelo de datos observable

Colecciones y documentos que aparecen en el codigo:

- `users`
- `clients`
- `clients/{clientId}/spreadsheetTemplates`
- `clients/{clientId}/spreadsheetTemplates/{templateId}/categories`
- `models`
- `batches`
- `batches/{batchId}/productDrafts`
- `jobs`
- `jobs/{jobId}/outputs`
- `jobs/{jobId}/logs`
- `analytics_summary/global`
- `analytics_daily/{date}`
- `analytics_providers/{provider}`
- `analytics_clients/{clientId}`
- `analytics_client_providers/{clientId__provider}`
- `analytics_client_models/{clientId__modelId}`
- `analytics_gemini_usage/{logId}`
- `system_alert_settings/global`
- `system_config/main`
- `model_generation_logs`
- `adminOperations`

Entidades principales visibles en `shared/src/types/`:
- `User`
- `Client`
- `SpreadsheetTemplate`
- `SpreadsheetTemplateCategory`
- `Model`
- `Pose`
- `Batch`
- `Job`
- `JobOutput`
- `JobLog`
- `ProductDraft`
- `Analytics*`
- `GeminiUsageRecord`
- `SystemHealthSnapshot`
- `SystemConfig`

Semantica confirmada por tipos y worker:
- `Batch` agrega estado por lote y puede operar en `photos_only` o `spreadsheet`
- `Job` representa el estado operativo actual
- `JobOutput` representa outputs persistidos por job
- `ProductDraft` vive por lote y por prenda cuando el batch sale en modo spreadsheet
- auth usa roles `admin`, `operador`, `revisor`

## 6. Storage observable

Paths que aparecen en el codigo:

- poses de modelo: `models/{clientId}/{modelId}/poses/{fileName}`
- drafts multi-archivo: `garments/drafts/{uid}/{draftBatchId}/{garmentId}/{fileName}`
- source spreadsheets del wizard: `wizard_source_spreadsheets/{uid}/{uuid}/{fileName}`
- outputs generados: `generated/{clientId}/{batchId}/{jobId}/{outputId}.{ext}`
- square crops de outputs: `generated/{clientId}/{batchId}/{jobId}/square_crops/{outputId}.jpg`
- templates de cliente: `client_spreadsheets/{clientId}/{templateId}/{fileName}`
- exports de spreadsheet: `client_spreadsheet_exports/{clientId}/{batchId}/{fileName}`
- fotos IA de modelos: `model_generations/{clientId}/{sessionId}/{fileName}`
- fotos IA de modelos por stage: `model_generations/{clientId}/{modelId}/{stage}/{sessionId}/{fileName}`

## 7. Flujos confirmados por codigo

### Auth y acceso

- login con email/password en `src/pages/Login.tsx`
- despues del login se consulta `users/{uid}`
- si el usuario existe y esta activo, la UI toma rol desde Firestore/claims
- `AppRouter` protege rutas usando usuario autenticado, `active` y `role`
- backend valida roles con `functions/src/auth/roles.ts`
- `syncClaimsOnUserWrite` y `syncUserClaims` mantienen custom claims sincronizados

### Clientes y templates de spreadsheet

- admins crean y archivan clientes desde `src/pages/Clients.tsx`
- cada cliente puede tener templates XLSX importados a `clients/{clientId}/spreadsheetTemplates`
- `importClientSpreadsheetTemplate` parsea workbook, detecta hojas categoria y persiste metadata + categorias
- `updateClientSpreadsheetTemplateCategory` define la categoria default operativa por template

### Generacion de batches

- el wizard soporta dos modos: `photos_only` y `spreadsheet`
- el frontend sube prendas a Storage desde `src/features/generate/storage.ts`
- si una prenda tiene varias fotos, `classifyGarmentViewsWithGemini` clasifica `front/back/side` y `garmentBodyArea`
- las poses del modelo usan `pose.aiClassification` para sugerir compatibilidades pose-prenda
- si el modo es `spreadsheet`, `previewProductDrafts` genera drafts previos por prenda usando template + categoria + Gemini
- `useSystemConfig` inyecta prompt global, proveedores deshabilitados y parametros operativos leidos desde `system_config/main`
- `createGenerationBatch` valida cliente, modelo, poses, prendas, template/categoria y crea `batch` + `jobs`
- si el modo es `spreadsheet`, la callable tambien persiste `batches/{batchId}/productDrafts`

### Pipeline de jobs

- `processJobOnCreate` y `processJobOnRequeue` disparan el worker
- `processJobOnActivation` retoma retries diferidos o jobs reactivados por scheduler sin cambiar de estado
- `functions/src/workers/jobWorker.ts` reclama el job, llama al provider, guarda output en Storage y persiste `jobs/{jobId}/outputs/{outputId}`
- el worker registra logs operativos y ejecuta auto review con Gemini
- `retryJobAutoReview` permite reprocesar manualmente la revision del output vigente
- `requeueExpiredJobsOnSchedule` recupera jobs atascados por timeout o claim vencido
- `onJobStatusChange` actualiza agregados del batch
- `onJobCompletedSquareCrop` sincroniza square crops hacia `productDrafts` cuando cambia el output efectivo de un job con spreadsheet
- `storageCleanupOnSchedule` ejecuta limpieza periodica de outputs viejos en Storage

### Cola y catalogo operativo

- no hay rutas separadas `/evaluacion` ni `/archivo` en el router actual; esa operativa vive hoy entre `/cola` y `/catalogo`
- `Cola` muestra batches vivos, ETA, estados, retries y cancelaciones/regeneraciones masivas
- `Catalogo` concentra seleccion manual de output, requeue, cancelacion, edicion de `productDrafts` y export XLSX del batch
- el catalogo agrupa jobs completados por prenda para exploracion visual y descarga puntual
- `deleteJob` borra trabajos terminales y recompone los contadores del batch
- las descargas salen por endpoints HTTP que devuelven imagenes individuales o ZIPs

### Analytics, salud y config operativa

- `analyticsTriggers.ts` mantiene agregados a partir de `jobs` y `outputs`
- `rebuildAnalytics` recompone agregados leyendo `jobs` y `collectionGroup('outputs')`
- cada uso de Gemini se registra en `analytics_gemini_usage`
- `getSystemHealth` combina checks de OpenAI, fal.ai y Gemini con estado de cola y alertas compartidas
- `updateSystemAlertSettings` persiste umbrales de alertas
- `system_config/main` guarda config operativa compartida; frontend la lee por snapshot y Functions la cachea para runtime

### Generacion IA de modelos y tagging de poses

- `generateModelPose` genera imagenes temporales para modelos
- esas imagenes se guardan en Storage bajo `model_generations/...`
- el callable registra costo estimado en `model_generation_logs`
- `downloadModelBundle` exporta poses + manifest de un modelo en ZIP y `importModelBundle` rehidrata ese bundle en otro cliente
- `onModelWrite` clasifica automaticamente poses nuevas con Gemini y completa `pose.aiClassification`
- `tagModelPosesWithGemini` permite reprocesar o sanear tagging de poses desde backend
- `backfillModelPoses` encola operaciones administrativas para completar poses faltantes en modelos existentes

## 8. Zonas sensibles

Archivos y areas con impacto transversal:
- `src/app/AppRouter.tsx`
- `src/firebase.ts`
- `src/features/generate/wizard/hooks/useGenerateWizard.ts`
- `src/features/system/useSystemConfig.ts`
- `shared/src/types/`
- `shared/src/domain.ts`
- `shared/src/utils/garmentViewMatching.ts`
- `functions/src/index.ts`
- `functions/src/auth/roles.ts`
- `functions/src/admin/systemConfig.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/exportBatchSpreadsheet.ts`
- `functions/src/spreadsheets/templateWorkbook.ts`
- `functions/src/spreadsheets/productDrafts.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/triggers/analyticsTriggers.ts`
- `functions/src/admin/getSystemHealth.ts`

## 9. Como leer este repo sin asumir de mas

Orden recomendado:
1. `src/app/AppRouter.tsx` para ver rutas y roles
2. `src/features/generate/wizard/hooks/useGenerateWizard.ts` para ver el flujo principal del frontend
3. `shared/src/types/` para ver entidades y contratos reales
4. `functions/src/index.ts` para ver entry points exportados hoy
5. `functions/src/callables/createGenerationBatch.ts` para entender creacion de batches y `productDrafts`
6. `functions/src/workers/jobWorker.ts` para entender el pipeline central
7. `tests/` y `e2e/` para ver que comportamientos ya estan cubiertos
