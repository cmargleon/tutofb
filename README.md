# Tuto Firebase

App interna de catalogo sobre Firebase para operar un flujo completo de virtual try-on.

Hoy el sistema cubre:
- login interno con roles `admin`, `operador`, `revisor`
- alta de clientes y modelos
- importacion y exportacion de bundles de modelos
- wizard de generacion con clasificacion de prendas, sugerencia de poses y batches reales
- dos modos de salida: `photos_only` y `spreadsheet`
- cola operativa, seleccion manual de outputs, reintentos, cancelaciones, descargas y catalogo visual
- analytics operativos, uso/costo de Gemini, salud del sistema y configuracion compartida

## Stack

Frontend:
- React 19 + TypeScript + Vite
- UI interna en espanol
- `src/firebase.ts` usa `firebase-applet-config.json`
- solo conecta a emuladores si `VITE_USE_FIREBASE_EMULATORS=true`

Backend:
- Firebase Auth
- Firestore
- Cloud Storage
- Cloud Functions v2 sobre Node 22

Contrato compartido:
- `shared/src/types/`
- `shared/src/domain.ts`
- `shared/src/utils/`

Providers de imagen activos en codigo:
- `fal-seedream`
- `fal-banana-pro`
- `openai-gpt-image-1.5`
- `fal-nano-banana-2`
- `fal-seedream-5`

## Arquitectura funcional

Frontend:
- `Dashboard`, `Analytics` y `Configuracion` para operacion, salud y config global
- `Clients` y `Users` con vistas separadas de crear/lista
- `ModelsGenerate` y `ModelsCatalog` para alta, biblioteca y mantenimiento de poses
- `Wizard` para crear batches
- `Cola` y `Catalogo` para el ciclo operativo posterior

Backend:
- `createGenerationBatch` crea `batches` + `jobs`
- `classifyGarmentViewsWithGemini` clasifica fotos multiangulo de prendas
- `previewProductDrafts` arma drafts de spreadsheet antes de crear el batch
- `processJobOnCreate` / `processJobOnRequeue` disparan el worker real
- `processJobOnActivation` retoma retries diferidos y activaciones por scheduler
- `retryJobAutoReview` permite reejecutar review Gemini sobre la salida vigente
- `exportBatchSpreadsheet` exporta el batch a XLSX desde los `productDrafts`
- `downloadModelBundle` / `importModelBundle` mueven modelos completos con manifest + poses
- `publicGeneratedImage` sirve solo assets generados bajo `generated/`
- `getSystemHealth`, `updateSystemAlertSettings`, `getSystemConfig`, `updateSystemConfig` exponen salud y config compartida

Modelo operativo:
- `jobs` representa estado actual del trabajo
- `jobs/{jobId}/outputs` representa cada output completado real
- `currentOutput` apunta al resultado vigente
- el costo se acumula por `outputs`
- los contadores operativos se calculan por estado actual de `jobs`
- `batches/{batchId}/productDrafts` existe cuando el lote sale en modo `spreadsheet`

Flujos IA visibles hoy:
- review de imagen generada con Gemini
- clasificacion de vistas de prenda con Gemini
- tagging de poses de modelos con Gemini
- enriquecimiento de `productDrafts` con Gemini

## Setup local

### 1. Instalar dependencias

```bash
npm install
npm --prefix functions install
```

### 2. Configurar frontend

Usa `.env.local` o `.env`:

```bash
VITE_USE_FIREBASE_EMULATORS="true"
DISABLE_HMR="false"
```

Notas:
- si `VITE_USE_FIREBASE_EMULATORS=false` o no esta definido, el frontend usa el proyecto Firebase configurado en `firebase-applet-config.json`
- correr el frontend en `localhost:3000` no implica usar Firebase local

### 3. Configurar secrets y params de Functions

Secrets:

```bash
firebase functions:secrets:set FAL_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
```

Params runtime:

```bash
firebase functions:params:set BATCH_MAX_JOBS=100
firebase functions:params:set JOB_MAX_RETRIES=3
firebase functions:params:set JOB_TIMEOUT_MS=300000
firebase functions:params:set JOB_STUCK_SWEEP_LIMIT=50
firebase functions:params:set JOB_RETRY_DELAY_MS=300000
firebase functions:params:set JOB_AUTO_REVIEW_MAX_ATTEMPTS=3
firebase functions:params:set FAL_POLL_INTERVAL_MS=2000
firebase functions:params:set FAL_POLL_TIMEOUT_MS=240000
firebase functions:params:set OPENAI_BASE_URL=https://api.openai.com/v1
firebase functions:params:set GEMINI_IMAGE_REVIEW_MODEL=gemini-3.1-flash-lite-preview
firebase functions:params:set GEMINI_POSE_CLASSIFICATION_MODEL=gemini-3.1-flash-lite-preview
firebase functions:params:set GEMINI_GARMENT_VIEW_CLASSIFICATION_MODEL=gemini-3.1-flash-lite-preview
```

Emuladores:
- usa `.secret.local` dentro de `functions/` para `FAL_KEY`, `OPENAI_API_KEY` y `GEMINI_API_KEY`
- exporta params como env vars o configuralos via Firebase params localmente

### 4. Levantar emuladores

```bash
firebase emulators:start
```

Puertos por defecto:
- Auth: `9099`
- Firestore: `8080`
- Functions: `5001`
- Storage: `9199`

### 5. Ejecutar frontend

```bash
npm run dev
```

## Config operativa en tiempo real

Ademas de los params runtime, la app usa `system_config/main` para cambios operativos sin redeploy.

Hoy ahi viven:
- `jobMaxRetries`
- `jobRetryDelayMs`
- `batchMaxJobs`
- `geminiImageReviewModel`
- `disabledProviders`
- `systemPromptOverride`
- `systemPromptFullOutfit`
- `systemPromptTopOnly`
- `systemPromptBottomOnly`

Lectura/escritura:
- frontend la lee por snapshot con `src/features/system/useSystemConfig.ts`
- Functions la cachea desde `functions/src/admin/systemConfig.ts`
- solo `admin` puede mutarla desde `/configuracion` o callables asociados

## Auth y roles

Roles soportados:
- `admin`
- `operador`
- `revisor`

Reglas principales:
- login interno con email/password
- el documento `users/{uid}` define `role` y `active`
- `syncClaimsOnUserWrite` y `syncUserClaims` mantienen custom claims sincronizados

Permisos principales:
- `admin`: usuarios, clientes, modelos, configuracion y borrados permanentes
- `operador`: generar, evaluar, regenerar y exportar
- `revisor`: cola, catalogo y analytics

## Storage y datos

Rutas activas de Storage:
- poses: `models/{clientId}/{modelId}/poses/{fileName}`
- drafts multiarchivo: `garments/drafts/{uid}/{draftBatchId}/{garmentId}/{fileName}`
- source spreadsheets del wizard: `wizard_source_spreadsheets/{uid}/{uuid}/{fileName}`
- outputs generados: `generated/{clientId}/{batchId}/{jobId}/{outputId}.{ext}`
- square crops: `generated/{clientId}/{batchId}/{jobId}/square_crops/{outputId}.jpg`
- templates de cliente: `client_spreadsheets/{clientId}/{templateId}/{fileName}`
- exports de spreadsheet: `client_spreadsheet_exports/{clientId}/{batchId}/{fileName}`
- fotos IA de modelos: `model_generations/...`

Colecciones relevantes:
- `users`
- `clients`
- `clients/{clientId}/spreadsheetTemplates`
- `models`
- `batches`
- `batches/{batchId}/productDrafts`
- `jobs`
- `jobs/{jobId}/outputs`
- `jobs/{jobId}/logs`
- `analytics_*`
- `analytics_gemini_usage`
- `system_alert_settings`
- `system_config`
- `model_generation_logs`

## Pruebas y validacion

Chequeo frontend y tipos:

```bash
npm run lint
```

Compilacion de Functions:

```bash
npm --prefix functions run build
```

Suite principal:

```bash
npm test
```

Cobertura visible en el repo:
- `createGenerationBatch`
- `jobWorker`
- `providers`
- `analytics`
- `regeneration`
- `downloads`
- `deletePlans`
- matching de vistas de prenda
- tagging/clasificacion de poses

Smoke E2E:

```bash
npx playwright test
```

## Referencias rapidas

- arquitectura detallada: [ARCHITECTURE.md](/Users/claudiomatias/Documents/projects/tuto/app/privada/tutofb/tutofb/ARCHITECTURE.md)
- decisiones tecnicas: [DECISIONS.md](/Users/claudiomatias/Documents/projects/tuto/app/privada/tutofb/tutofb/DECISIONS.md)
- flujo server-side: [PROCESSING_FLOW.md](/Users/claudiomatias/Documents/projects/tuto/app/privada/tutofb/tutofb/functions/src/workers/PROCESSING_FLOW.md)

## Automatización de producción

API autenticada, intake y panel: [docs/AUTOMATION.md](docs/AUTOMATION.md).

Identidad técnica de Work y renovación automática: [docs/AUTOMATION_AUTH.md](docs/AUTOMATION_AUTH.md). Polling de jobs: cada 20 s durante 5 min, después cada 60 s; timeout total de 30 min. Revisión de Gmail configurable por separado en su scheduler externo.
