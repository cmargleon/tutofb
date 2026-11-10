# CLAUDE.md — TutoFB

Herramienta interna para generación de imágenes fotorrealistas de prendas sobre modelos via IA (fal.ai, OpenAI, Gemini Vision). Stack: React 19 + TypeScript + Vite · Firebase Cloud Functions v2 (Node 22) · Firestore · GCS.

---

## Reglas operativas (SIEMPRE aplicar)

1. **Asumir Firebase real** — `localhost:3000` no implica emuladores. Solo usar emuladores si `VITE_USE_FIREBASE_EMULATORS=true` confirmado.
2. **Aplicar cambios end-to-end** — Si un cambio tiene impacto remoto en Firebase, el trabajo no queda terminado hasta hacer el deploy correspondiente. Si se toca `functions/src/`, hacer build + deploy. Si se toca `shared/src/`, compilar y testear antes de deploy. No dejar el sistema corriendo versión vieja.
3. **Node 22** — Versión del proyecto: `.nvmrc` (22), `functions/package.json` (`engines.node: 22`) y `firebase.json` (`runtime: nodejs22`). Con nvm/fnm: `nvm use` en la raíz. El dev server (`npm run dev`) también arranca correctamente con Node 25.
4. **Firebase CLI** — Instalado globalmente (`firebase` en el PATH); no requiere cargar nvm.

---

## Comandos

```bash
# Desde la raíz del repo
npm run dev                    # Dev server localhost:3000
npm run build                  # Build producción
npm run lint                   # Type-check TypeScript
npm test                       # Compila functions + tests

# Functions
npm --prefix functions run build          # Compilar functions
npm --prefix functions run build:watch    # Watch mode

# Deploy
firebase deploy --project tutofb-260320-1003   # Deploy completo
firebase deploy --only functions               # Solo functions

# Test específico
node --import tsx --test tests/createGenerationBatch.test.ts
```

---

## Arquitectura

```
shared/src/     → Contrato compartido: tipos, dominio (DEFAULT_TRY_ON_PROMPT), constantes
src/            → Frontend React: pages/ · features/ · components/
functions/src/  → Backend: callables/ · triggers/ · workers/ · review/ · providers/
```

**Capas:** Frontend (UI, nunca IA) → Cloud Functions (todo el procesamiento) → Shared (contrato).

---

## Menú de Generación (`/generate`) ← ÁREA CENTRAL

**Wizard de 3 pasos** para crear lotes de generación (componentes en `src/components/wizard/`):

| Paso | Nombre (`state.ts`) | Componentes |
|------|--------------------|-------------|
| 1 | Cliente y fotos | `ClientModelStep.tsx` (cliente, modelo, modo salida) · `GarmentsStep.tsx` (subir prendas) |
| 2 | Preparar fotos | Prendas: `PoseSelectionStep.tsx` (poses, con sugerencia Gemini) · Productos: `ProductScenesStep.tsx` |
| 3 | Revisar y generar | `BatchStep.tsx` (proveedor, prompt, submit) |

**Archivos clave:**
- `src/pages/Wizard.tsx` — Página principal (renderiza cada paso según `state.step`)
- `src/features/generate/wizard/hooks/useGenerateWizard.ts` — Lógica central: estado, clientes, modelos, navegación entre pasos
- `src/features/generate/wizard/hooks/useGenerateWizardCatalog.ts` — Carga de clientes/modelos/poses
- `src/features/generate/wizard/hooks/useGarmentPreparation.ts` + `garmentClassification.ts` — Subida y clasificación de prendas
- `src/features/generate/wizard/hooks/useProductGeneration.ts` — Flujo de productos (escenas)
- `src/features/generate/wizard/hooks/useGenerateWizardSubmit.ts` — Submit: llama a `createGenerationBatch`, `createMarketplacePhotoBatch` o `createProductGenerationBatch`
- `src/features/generate/wizard/state.ts` + `stateTransitions.ts` — Definición de pasos, inicialización y transiciones
- `src/features/generate/wizard/submit.ts` — Construcción de los requests de envío
- `src/features/generate/hooks/useWizard.ts` — Solo re-exporta `useGenerateWizard` como `useWizard`
- `functions/src/callables/createGenerationBatch.ts` — Callable: crea Batch + N Jobs en transacción

**Flujo de submit:** `useGenerateWizardSubmit` → callable `createGenerationBatch` → Batch + Jobs en Firestore → trigger `processJobOnCreate` → `jobWorker.ts` (claim → provider → Gemini review → resultado).

**Proveedores disponibles:** `fal-seedream`, `fal-banana-pro`, `fal-nano-banana-2`, `fal-seedream-5`, `openai-gpt-image-1.5`.

---

## Menú de Catálogo (`/catalogo`) ← ÁREA CENTRAL

**Browser visual** de imágenes completadas, agrupadas por cliente → batch → prenda.

**Archivos clave:**
- `src/pages/Catalogo.tsx` — Página principal
- `src/features/catalog/useCatalogJobs.ts` — Paginación (25/50/100), filtros, suscripción Firestore en tiempo real
- `src/components/catalog/CatalogGarmentSection.tsx` — Agrupación por prenda
- `src/components/catalog/CatalogLightbox.tsx` — Vista full-screen con navegación

**Flujo:** usuario selecciona cliente → carga batches → query `jobs` donde `status in ['completed','failed']` → agrupados por `garmentId` → paginados → lightbox al hacer click.

---

## Procesamiento de Jobs

```
createGenerationBatch → [N jobs status=pending]
  → processJobOnCreate (trigger)
  → jobWorker: claim (transacción) → signed URLs → provider API → Gemini review
     ├─ Aprobado → status=completed, crea JobOutput
     ├─ Rechazado (intentos < 3) → status=pending, promptBase=revisedPrompt, re-encola
     ├─ Rechazado (sin intentos) → status=failed
     └─ Error proveedor → retry o failed
  → onJobStatusChange → actualiza contadores Batch
  → analyticsTriggers → actualiza métricas
```

`requeueExpiredJobsOnSchedule` (cada 5 min) — recupera jobs atascados (`status=processing` con `claimExpiresAt ≤ now`).

---

## Modelo de datos (esenciales)

**Job** (unidad mínima: 1 pose × 1 prenda):
`status` = `pending | processing | completed | failed` · `currentOutputId` · `latestAutoReview` · `claimToken` (lock del worker) · `retryCount/maxRetries` · `totalCostUsd`

**Batch**: agrupa N jobs. Contadores actualizados en tiempo real por triggers. `status` derivado de counters.

**JobAutoReview** (Gemini): `verdict: approved|rejected` · `summary` (español) · `revisedPrompt` · `marketplaceData` (título, descripción, tipo prenda, etc.)

**Storage:** `gs://tutofb-260320-1003.firebasestorage.app/` — poses en `clients/{cId}/models/{mId}/poses/` · prendas en `garments/` · generadas en `generated/{cId}/{batchId}/{jobId}/`

---

## Zonas de riesgo

- `shared/src/types/` — Cambio rompe frontend + functions + tests
- `shared/src/domain.ts` — Cambio al prompt afecta todos los jobs nuevos
- `functions/src/workers/jobWorker.ts` (+ módulos `jobWorker.*.ts`, ver `PROCESSING_FLOW.md`) — Pipeline central de procesamiento
- `functions/src/triggers/analyticsTriggers.ts` — Error corrompe métricas históricas
- `functions/src/callables/createGenerationBatch.ts` — Validación y creación de toda la cola
- Cualquier cambio a estados de `Job` o `Batch` — Puede romper el procesamiento completo
