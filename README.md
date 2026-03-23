# Tuto Firebase

Migración incremental de la app interna de catálogo ecommerce hacia Firebase.

Backend definitivo:
- Firebase Auth
- Firestore
- Cloud Storage
- Cloud Functions v2

Objetivo funcional:
- mantener paridad con el flujo original de catálogo
- crear lotes desde wizard
- procesar jobs reales con fal.ai seedream, fal.ai banana-pro y OpenAI gpt-image-1.5
- evaluar, regenerar, descargar y archivar resultados
- medir operación y costo sin dobles conteos por regeneraciones

## Arquitectura

Frontend:
- React 19 + TypeScript + Vite
- UI interna en español
- conexión opcional a emuladores con `VITE_USE_FIREBASE_EMULATORS=true`

Functions:
- `createGenerationBatch`: valida wizard real y crea `batches` + `jobs`
- `regenerateJob`: reencola un job conservando la imagen actual hasta que termine la nueva
- `processJobOnCreate` / `processJobOnRequeue`: worker server-side real
- `requeueExpiredJobsOnSchedule`: detecta jobs atascados y los reencola o falla
- triggers de analytics: separan estado actual de `jobs` vs costo acumulado por `outputs`
- triggers de cascada: limpian jobs/subcolecciones/storage al borrar clientes o modelos

Modelo operativo:
- `jobs` representan estado actual del trabajo
- `jobs/{jobId}/outputs` representa cada output completado real
- `currentOutput` apunta al resultado vigente del job
- el costo se acumula por `outputs`
- los contadores operativos se calculan por estado actual de `jobs`

Flujo server-side documentado:
- ver [PROCESSING_FLOW.md](/Users/claudiomatias/Documents/projects/tuto/app/privada/tutofb/tutofb/functions/src/workers/PROCESSING_FLOW.md)

## Setup local

## Estado actual de entorno

Importante:
- correr el frontend en `localhost:3000` no implica usar Firebase local
- hoy este repo está configurado para trabajar contra Firebase en la nube cuando `VITE_USE_FIREBASE_EMULATORS=false`
- en este workspace, [`.env.local`](/Users/claudiomatias/Documents/projects/tuto/app/privada/tutofb/tutofb/.env.local#L1) tiene `VITE_USE_FIREBASE_EMULATORS="false"`, así que el frontend local usa Firestore, Functions y Storage remotos
- solo se usan emuladores si cambias esa variable a `true` y además levantas `firebase emulators:start`

### 1. Instalar dependencias

```bash
npm install
npm --prefix functions install
```

### 2. Configurar frontend

Usa `.env.local` o `.env`:

```bash
VITE_USE_FIREBASE_EMULATORS=true
DISABLE_HMR=false
```

### 3. Configurar secrets y params de Functions

Producción:

```bash
firebase functions:secrets:set FAL_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:params:set BATCH_MAX_JOBS=100
firebase functions:params:set JOB_MAX_RETRIES=3
firebase functions:params:set JOB_TIMEOUT_MS=300000
firebase functions:params:set JOB_STUCK_SWEEP_LIMIT=50
firebase functions:params:set FAL_POLL_INTERVAL_MS=2000
firebase functions:params:set FAL_POLL_TIMEOUT_MS=240000
firebase functions:params:set OPENAI_BASE_URL=https://api.openai.com/v1
```

Emuladores:
- usa `.secret.local` dentro de `functions/` para `FAL_KEY` y `OPENAI_API_KEY`
- exporta params como env vars o configúralos vía Firebase params localmente

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

## Auth y roles

Roles soportados:
- `admin`
- `operador`
- `revisor`

Reglas principales:
- login interno con email/password
- no existe autocreación libre por Google
- el documento `users/{uid}` define `role` y `active`
- `syncClaimsOnUserWrite` mantiene custom claims sincronizados con Firestore
- `syncUserClaims` permite autosincronizar claims al iniciar sesión y a admins sincronizar terceros

Permisos:
- `admin`: clientes, modelos, borrados, configuración
- `operador`: generar, evaluar, regenerar, archivo
- `revisor`: evaluar, archivo, analytics

## Storage y rutas

Rutas activas:
- poses: `models/{clientId}/{modelId}/poses/{fileName}`
- drafts de wizard: `garments/drafts/{uid}/{draftBatchId}/{garmentId}.jpg`
- outputs generados: `generated/{clientId}/{batchId}/{jobId}/{outputId}.{ext}`

## Pruebas y validación

Compilación frontend:

```bash
npm run lint
```

Compilación functions:

```bash
npm --prefix functions run build
```

Suite de tests:

```bash
npm test
```

Cobertura mínima actual:
- validación de `createGenerationBatch`
- reglas de agrupado de prendas del wizard
- composición multiángulo
- regeneración
- dispatch y mapeo de providers
- analytics/rebuild por estado actual y outputs reales
- planes de cascada para delete
- naming de descargas

## Notas de analytics

Semántica explícita:
- `completedJobs`, `failedJobs`, `pendingJobs`, `processingJobs`: estado actual de `jobs`
- `totalCompletedOutputs` y `totalCostUsd`: outputs completados reales
- `analytics_providers` y `analytics_clients` acumulan outputs reales
- `analytics_daily.completed` y `analytics_daily.costUsd` reflejan outputs completados
- `analytics_daily.failed` refleja jobs actualmente fallidos agrupados por fecha de actualización
