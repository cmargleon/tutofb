# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Qué es este proyecto

**TutoFB** es una herramienta interna de operación para catalogo de moda. Genera imágenes fotorrealistas de prendas sobre modelos (personas) usando IA, con revisión automática de calidad vía Gemini Vision. El equipo usa la app para crear lotes de generación, revisar resultados y descargar imágenes para el catálogo.

**Stack:**
- Frontend: React 19 + TypeScript + Vite + TailwindCSS
- Backend: Firebase Cloud Functions v2 (Node.js 20)
- Base de datos: Firestore
- Archivos: Google Cloud Storage
- Auth: Firebase Authentication
- IA externa: fal.ai, OpenAI gpt-image-1.5, Google Gemini 3.1 Flash

---

## Comandos principales

Todos los comandos se corren desde `/opt/tuto/tutofb/`.

```bash
# Frontend
npm run dev          # Dev server en localhost:3000
npm run build        # Build de producción (Vite → dist/)
npm run lint         # Type-check TypeScript (tsc --noEmit)
npm test             # Compila functions + corre todos los tests

# Cloud Functions (desde functions/)
npm run lint         # Type-check functions
npm run build        # Compila TypeScript → lib/
npm run build:watch  # Watch mode
npm run serve        # Build + emuladores locales
npm run deploy       # Deploy solo functions
```

**Deploy completo:**
```bash
firebase deploy --project tutofb-260320-1003
```
> Cualquier cambio en `functions/src/` requiere `npm run build` en `functions/` antes de que el cambio sea efectivo. El deploy lo hace automáticamente vía predeploy scripts.

**Correr un test específico:**
```bash
node --import tsx --test tests/createGenerationBatch.test.ts
```

**Node.js**: Usar Node 20 (Node 24 genera bus error con Vite en este server). Activar con:
```bash
source ~/.nvm/nvm.sh && nvm use 20
```

---

## Arquitectura general

```
shared/src/          ← Contrato compartido: tipos, dominio, constantes
src/                 ← Frontend React (pages, features, components)
functions/src/       ← Backend Cloud Functions (callables, triggers, workers)
```

El sistema tiene tres capas:

1. **Frontend** — Crea/consulta datos. Nunca procesa imágenes ni llama a APIs de IA.
2. **Cloud Functions** — Todo el procesamiento ocurre aquí, disparado por eventos de Firestore o llamadas desde el frontend.
3. **Shared** — Tipos y reglas de dominio que frontend y backend comparten. Es el contrato central.

---

## Modelo de datos (Firestore)

### Colecciones principales

```
users/{uid}
clients/{clientId}
models/{modelId}
batches/{batchId}
jobs/{jobId}
  └── outputs/{outputId}      ← historial de todos los resultados
  └── logs/{logId}            ← log de cada intento
analytics_summary
analytics_daily/{YYYY-MM-DD}
analytics_providers/{provider}
analytics_clients/{clientId}
analytics_client_providers/{clientId__{provider}}
analytics_client_models/{clientId__{modelId}}
system_alert_settings
```

### Tipos clave

**User**
```ts
{
  uid: string
  email: string
  displayName: string
  role: 'admin' | 'operador' | 'revisor'
  active: boolean
  status?: 'active' | 'archived'
  createdAt, updatedAt, archivedAt, lastLoginAt
}
```

**Client** — Entidad de catálogo (empresa/marca)
```ts
{ id, name, status, batchCount, lastBatchCreatedAt, createdByUid, ... }
```

**Model** — Persona/modelo visual
```ts
{
  id, clientId, clientNameSnapshot, name, status
  poses: Pose[]          // array embebido de referencias a imágenes
  poseCount: number
  coverPoseId: string | null
  storageRootPath: string
  generatedPhotoCount, generatedPhotoCostUsd
}

Pose { id, storagePath, fileName, previewStoragePath, width, height, createdAt }
```

**Batch** — Lote de generación
```ts
{
  id, clientId, modelId, provider, aspectRatio, promptBase
  poseIds: string[]
  garmentCount: number

  // Experimento A/B
  experimentEnabled: boolean
  experimentId: string | null
  experimentMode: 'ab_paired' | 'ab_interleaved' | null
  experimentArms: ExperimentArm[] | null

  // Contadores (actualizados por triggers en tiempo real)
  totalJobs, pendingJobs, processingJobs, completedJobs, failedJobs
  status: 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed'

  // Snapshots (para lectura sin joins)
  clientNameSnapshot, modelNameSnapshot, modelSnapshot, clientSnapshot
}
```

**Job** — Unidad mínima de procesamiento (1 pose × 1 prenda)
```ts
{
  id, batchId, clientId, modelId

  // Inputs
  poseImageId, poseImagePath
  garmentId, garmentName, garmentFilePath
  garmentIsMultiAngle: boolean       // si la prenda muestra múltiples ángulos
  garmentSourceType: 'single' | 'folder-root' | 'subfolder'

  // Config de generación
  provider: Provider
  aspectRatio: AspectRatio
  promptBase: string                 // puede modificarse por revisión automática
  finalPrompt: string                // el prompt real enviado al proveedor

  // Estado operativo
  status: 'pending' | 'processing' | 'completed' | 'failed'
  queuePriority: number              // mayor = antes

  // Reintentos
  retryCount, maxRetries
  generationAttemptCount: number | null
  autoReviewMaxAttempts: number | null

  // Claim/lock del worker
  claimToken: string | null          // UUID, cambia por intento
  claimedBy: string | null
  claimExpiresAt: Timestamp | null
  timeoutAt: Timestamp | null

  // Outputs
  currentOutputId: string | null
  currentOutput: JobOutput | null
  userSelectedOutputId: string | null   // selección manual del usuario
  userSelectedOutput: JobOutput | null
  completedOutputCount: number

  // Costos y tiempos
  totalCostUsd, totalDurationSeconds
  providerUsage: { [provider]: { completedOutputs, totalCostUsd, totalDurationSeconds } }

  // Revisión automática
  latestAutoReview: JobAutoReview | null

  // Trazabilidad
  manualRegenerationCount: number
  traceability: JobTraceabilitySummary
  lastError: string | null
}
```

**JobOutput** — Resultado de un intento (subcollección `jobs/{jobId}/outputs`)
```ts
{
  id, jobId, batchId, clientId, modelId
  provider, promptBase, finalPrompt, aspectRatio
  resultImagePath: string            // GCS path a la imagen generada
  contentType: string
  remoteUrl: string | null           // URL del proveedor (puede ser efímera)
  costUsd, durationSeconds
  autoReview: JobAutoReview | null
  isCurrent: boolean                 // solo uno por job puede ser true
  generationAttempt: number | null
  storageDeletedAt: Timestamp | null
}
```

**JobAutoReview** — Resultado de la revisión Gemini
```ts
{
  model: string                      // modelo Gemini usado
  verdict: 'approved' | 'rejected'
  summary: string                    // explicación en español
  revisedPrompt: string | null       // si rechazó, Gemini propone corrección
  criteria: JobAutoReviewCriterion[]
  marketplaceData: {
    title, description, brand, gender, garmentType,
    primaryColor, sport, isSportswear
  }
  attemptNumber, reviewedAt
}
```

---

## Flujo de procesamiento de un Job

### 1. Creación (callable `createGenerationBatch`)
- Frontend llama con: clientId, modelId, poseIds, garments[], provider, aspectRatio, promptBase
- Backend valida roles, ownership, límite BATCH_MAX_JOBS (default 100)
- En transacción: crea 1 Batch + N Jobs (1 por cada combinación pose × prenda)
- Si experimento A/B activo: cada job recibe su `experimentArmId`
- Jobs creados en `status='pending'`
- Trigger `processJobOnCreate` se dispara automáticamente

### 2. Claim (worker)
- Worker hace transacción para "tomar" el job
- Verifica `status === 'pending'`
- Asigna: `status='processing'`, `claimToken=UUID`, `claimedBy=workerId`, `timeoutAt=now+5min`
- Sin transacción exitosa → otro worker ya lo tomó, se descarta silenciosamente

### 3. Preparación de imágenes
- Genera signed URLs temporales (1hr) para pose y prenda desde GCS
- Construye `finalPrompt` a partir de `promptBase` + flag multi-ángulo

### 4. Llamada al proveedor

| Proveedor | Flujo | Costo |
|---|---|---|
| `fal-seedream` | Queue → Poll cada 2s → Resultado (timeout 4min) | $0.03/img |
| `fal-banana-pro` | Queue → Poll cada 2s → Resultado (timeout 4min) | $0.15/img |
| `openai-gpt-image-1.5` | POST `/images/edits` → base64 inline | $0.04/img |

### 5. Revisión automática Gemini
Después de cada generación exitosa, se envía a Gemini Vision con:
- Imagen pose original (referencia)
- Imagen prenda original (referencia)
- Imagen generada (resultado)

Gemini evalúa (en español):
- Preservación de pose exacta
- Integridad de la prenda (textura, color, costuras)
- Logos/branding: SOLO si visible en referencia (nunca alucinados)
- Fondo y luz: preservados del original
- Proporciones e identidad del modelo

Retorna: `verdict`, `summary`, `revisedPrompt` (si rechazó), `criteria[]`, `marketplaceData`

### 6. Resultado del intento

**Aprobado:**
- Crea JobOutput (`isCurrent=true`)
- Job: `status='completed'`, `currentOutputId`, counters actualizados
- Triggers: actualiza batch + analytics

**Rechazado (intentos < JOB_AUTO_REVIEW_MAX_ATTEMPTS, default 3):**
- Crea JobOutput igualmente (registro histórico)
- Job: `status='pending'` (re-encola), `promptBase=revisedPrompt`, `queuePriority=1`
- El ciclo se repite desde el paso 2

**Rechazado (sin más intentos):**
- Job: `status='failed'`

**Error del proveedor (retries < JOB_MAX_RETRIES, default 3):**
- Job: `status='pending'`, `retryCount++`, `queuePriority=0`

**Error del proveedor (sin más retries):**
- Job: `status='failed'`

### 7. Jobs atascados
`requeueExpiredJobsOnSchedule` corre cada 5 minutos y busca jobs con `status='processing'` y `claimExpiresAt ≤ now`. Los re-encola si quedan retries, o los falla.

---

## Cloud Functions (lista completa)

### Callables (desde frontend)

| Función | Roles | Propósito |
|---|---|---|
| `createGenerationBatch` | admin, operador | Crear batch + N jobs |
| `regenerateJob` | todos | Re-encolar job individual |
| `cancelJobGeneration` | todos | Cancelar job pendiente/fallido |
| `selectJobOutput` | todos | Seleccionar output entre intentos múltiples |
| `regenerateFailedBatchJobs` | admin, operador | Re-encolar todos los fallidos de un batch |
| `cancelPendingBatchJobs` | admin, operador | Cancelar todos los pendientes de un batch |
| `regenerateJobsBulk` | admin, operador | Re-encolar múltiples jobs con override de proveedor/prompt |
| `searchArchive` | todos | Buscar batches por filtros |
| `createAppUser` | admin | Crear usuario en Firebase Auth + Firestore |
| `updateAppUser` | admin | Cambiar rol/estado de usuario |
| `archiveAppUser` | admin | Soft-delete usuario |
| `restoreAppUser` | admin | Restaurar usuario archivado |
| `permanentlyDeleteAppUser` | admin | Borrado definitivo |
| `permanentlyDeleteClient` | admin | Borrar cliente + cascade |
| `permanentlyDeleteModel` | admin | Borrar modelo + cascade |
| `generateModelPose` | admin, operador | Generar pose IA para modelo |
| `syncUserClaims` | admin | Sincronizar custom claims desde Firestore |
| `rebuildAnalytics` | admin | Reconstruir analytics desde cero |
| `getSystemHealth` | admin | Estado de proveedores + cola + alertas |
| `updateSystemAlertSettings` | admin | Configurar umbrales de alertas |

### HTTP endpoints

| Endpoint | Propósito |
|---|---|
| `downloadBatchZip` | Descargar ZIP de todo un batch |
| `downloadJobImage` | Descargar imagen individual |
| `downloadSelectedJobsZip` | Descargar ZIP de jobs seleccionados |

### Triggers de Firestore

| Trigger | Evento | Propósito |
|---|---|---|
| `processJobOnCreate` | jobs creados | Iniciar procesamiento inmediato |
| `processJobOnRequeue` | jobs status→pending | Procesar cuando se re-encola |
| `onJobStatusChange` | jobs actualizados | Actualizar contadores del batch padre |
| `analyticsTriggers` | jobs creados/actualizados | Actualizar agregados de analytics |
| `onClientDelete` | clients eliminados | Cascade delete batches/jobs |
| `onModelDelete` | models eliminados | Cascade delete batches/jobs |
| `syncClaimsOnUserWrite` | users actualizados | Sincronizar rol a custom claims |

### Scheduled

| Trigger | Frecuencia | Propósito |
|---|---|---|
| `requeueExpiredJobsOnSchedule` | Cada 5 minutos | Detectar y recuperar jobs atascados |

---

## Sistema de analytics

Los analytics son **event-driven**: cada cambio en un Job dispara actualizaciones incrementales en documentos de lectura optimizada.

**Qué se agrega:**
- `analytics_summary`: totales globales, tasa de primer intento aprobado, costo proyectado mensual
- `analytics_daily/{date}`: volumen por día (zona horaria America/Mexico_City)
- `analytics_providers/{provider}`: completados, fallidos, costo promedio, duración promedio
- `analytics_clients/{clientId}`: producción por cliente con desglose de regeneraciones
- `analytics_client_providers/{clientId__{provider}}`: gasto cruzado cliente × proveedor
- `analytics_client_models/{clientId__{modelId}}`: productividad por modelo

**Regla importante (DEC-006):** El estado operativo se calcula desde `jobs`; el costo y outputs se calculan desde `outputs`. Nunca mezclar ambas semánticas para evitar doble conteo por regeneraciones.

---

## Sistema de experimentos A/B

Permite comparar dos proveedores en el mismo lote.

**Configuración:**
- `experimentMode: 'ab_paired'` → cada combinación pose×prenda se genera en TODOS los brazos
- `experimentMode: 'ab_interleaved'` → cada combinación se asigna a un brazo en round-robin
- Solo compatible con `fal-seedream` y `openai-gpt-image-1.5` (NO con `fal-banana-pro`)

**Analytics por experimento:**
- Agrupa jobs por `experimentArmId`
- Calcula eficiencia: 40% costo + 35% duración + 25% tasa de regeneración
- Determina brazo ganador y genera recomendación en español

**Restricción en regeneración:** Si un job tiene `experimentEnabled=true`, NO se puede cambiar proveedor ni prompt al regenerar manualmente (mantiene integridad de la comparación).

---

## Roles y permisos

| Rol | Usuarios | Clientes/Modelos | Generar | Cola/Eval | Analytics |
|---|---|---|---|---|---|
| admin | CRUD | CRUD | ✓ | ✓ | ✓ |
| operador | — | — | ✓ | ✓ | — |
| revisor | — | — | — | Solo lectura + selección | ✓ |

**Reglas Firestore clave:**
- Solo `admin` puede escribir users, clients, models
- `jobs` son write-only para el backend (el frontend solo puede actualizar `userSelectedOutputId`)
- `batches` son completamente read-only desde frontend
- Analytics son read-only para admin y revisor

**Custom claims:** `role` se guarda en el JWT de Firebase Auth vía `syncUserClaims`. Los claims se sincronizan automáticamente cuando cambia el documento del usuario.

---

## Storage (Google Cloud Storage)

```
gs://tutofb-bucket/
├── clients/{clientId}/models/{modelId}/poses/{poseId}.ext   # poses de referencia
├── garments/{garmentId}.ext                                  # prendas individuales
├── garments/{garmentId}/{fileName}.ext                       # prendas multi-ángulo
└── generated/{clientId}/{batchId}/{jobId}/{outputId}.ext    # imágenes generadas
```

Las imágenes generadas **nunca se borran**. Cuando un job tiene una nueva versión, el output anterior mantiene su archivo en Storage pero queda marcado como `isCurrent=false`.

---

## Prompt del sistema

`DEFAULT_TRY_ON_PROMPT` (definido en `shared/src/domain.ts`) es extenso (~120 líneas) y cubre:
- Preservación 100% de identidad, pose, proporciones
- Fondo y luz sin modificaciones
- Ajuste natural de la prenda: pliegues por gravedad, estiramiento en articulaciones
- **Regla estricta de branding**: logos/texto SOLO si visible en la referencia; jamás alucinados
- Áreas no visibles: continuar con tela base neutra

Si `garmentIsMultiAngle=true`, se agrega: *"La prenda de referencia está mostrada desde múltiples ángulos dentro de una sola imagen."*

---

## Configuración de runtime (functions/.env)

```
BATCH_MAX_JOBS=100
JOB_MAX_RETRIES=3
JOB_TIMEOUT_MS=300000          # 5 minutos
JOB_STUCK_SWEEP_LIMIT=50
JOB_AUTO_REVIEW_MAX_ATTEMPTS=3
FAL_POLL_INTERVAL_MS=2000
FAL_POLL_TIMEOUT_MS=240000     # 4 minutos
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_IMAGE_REVIEW_MODEL=gemini-3.1-flash-lite-preview
```

Secrets (via Firebase Secret Manager): `FAL_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`

---

## Frontend: rutas y áreas

| Ruta | Rol mínimo | Área |
|---|---|---|
| `/login` | — | Autenticación |
| `/` | revisor | Dashboard con resumen operativo |
| `/users` | admin | CRUD de usuarios |
| `/clients` | admin | CRUD de clientes |
| `/models` | admin | CRUD de modelos + gestión de poses |
| `/generate` | operador | Wizard de creación de lotes |
| `/cola` | revisor | Vista de cola de jobs |
| `/evaluacion` | revisor | Revisión y regeneración de resultados |
| `/archivo` | revisor | Búsqueda de lotes históricos |
| `/analytics` | revisor | Métricas y reportes |

**Composición de providers:**
```
ErrorBoundary → ThemeProvider → FeedbackProvider → AuthProvider → AppRouter
```

---

## Zonas de riesgo

Estos archivos impactan múltiples capas al mismo tiempo:

- **`shared/src/types.ts`** — Cambiar un tipo rompe frontend, functions y tests simultáneamente
- **`shared/src/domain.ts`** — Cambiar el prompt o reglas de negocio afecta todos los jobs nuevos
- **`functions/src/workers/jobWorker.ts`** — Lógica central del pipeline de procesamiento
- **`functions/src/triggers/analyticsTriggers.ts`** — Errors aquí corrompen métricas históricas
- **`functions/src/callables/createGenerationBatch.ts`** — Validación y creación de toda la cola
- **Cualquier cambio en los estados de `Job` o `Batch`** — Puede romper el procesamiento completo

Después de tocar `shared/src/`, siempre compilar y testear antes de hacer deploy.
