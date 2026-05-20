# CLAUDE.md — TutoFB

Herramienta interna para generación de imágenes fotorrealistas de prendas sobre modelos via IA (fal.ai, OpenAI, Gemini Vision). Stack: React 19 + TypeScript + Vite · Firebase Cloud Functions v2 (Node 20) · Firestore · GCS.

---

## Reglas operativas (SIEMPRE aplicar)

1. **Asumir Firebase real** — `localhost:3000` no implica emuladores. Solo usar emuladores si `VITE_USE_FIREBASE_EMULATORS=true` confirmado.
2. **Aplicar cambios end-to-end** — Si un cambio tiene impacto remoto en Firebase, el trabajo no queda terminado hasta hacer el deploy correspondiente. Si se toca `functions/src/`, hacer build + deploy. Si se toca `shared/src/`, compilar y testear antes de deploy. No dejar el sistema corriendo versión vieja.
3. **Node 20** — `source ~/.nvm/nvm.sh && nvm use 20` (Node 24 genera bus error con Vite).
4. **Firebase CLI bajo nvm** — Cargar nvm antes de usar `firebase`.

---

## Comandos

```bash
# Desde /opt/tuto/tutofb/
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

**Wizard de 5 pasos** para crear lotes de generación:

| Paso | Componente | Función |
|------|-----------|---------|
| 1 | `ClientModelStep.tsx` | Seleccionar cliente, modelo, modo salida |
| 2 | `GarmentsStep.tsx` | Subir prendas (GCS + borradores locales) |
| 3 | `PoseSelectionStep.tsx` | Seleccionar poses (con sugerencia Gemini) |
| 4 | `ProductDraftsStep.tsx` | Configurar filas de planilla (modo spreadsheet) |
| 5 | `BatchStep.tsx` | Proveedor, prompt, submit |

**Archivos clave:**
- `src/pages/Wizard.tsx` — Página principal
- `src/features/generate/hooks/useWizard.ts` — Lógica central (clientes, modelos, submit)
- `src/features/generate/wizard/state.ts` — Definición de pasos e inicialización
- `src/features/generate/wizard/submit.ts` — Lógica de envío
- `functions/src/callables/createGenerationBatch.ts` — Callable: crea Batch + N Jobs en transacción

**Flujo de submit:** `useWizard.submit()` → callable `createGenerationBatch` → Batch + Jobs en Firestore → trigger `processJobOnCreate` → `jobWorker.ts` (claim → provider → Gemini review → resultado).

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

**Storage:** `gs://tutofb-bucket/` — poses en `clients/{cId}/models/{mId}/poses/` · prendas en `garments/` · generadas en `generated/{cId}/{batchId}/{jobId}/`

---

## Zonas de riesgo

- `shared/src/types/` — Cambio rompe frontend + functions + tests
- `shared/src/domain.ts` — Cambio al prompt afecta todos los jobs nuevos
- `functions/src/workers/jobWorker.ts` — Pipeline central de procesamiento
- `functions/src/triggers/analyticsTriggers.ts` — Error corrompe métricas históricas
- `functions/src/callables/createGenerationBatch.ts` — Validación y creación de toda la cola
- Cualquier cambio a estados de `Job` o `Batch` — Puede romper el procesamiento completo

---

## Agentes

Usar subagentes para tareas independientes complejas vía Agent tool:

- **`wizard`** — Cambios en el flujo de generación: wizard steps, useWizard, state, submit, createGenerationBatch
- **`catalog`** — Cambios en catálogo: useCatalogJobs, Catalogo.tsx, componentes catalog/
- **`backend`** — Cambios en Cloud Functions: workers, triggers, callables, review, providers
- **`deploy`** — Build y deploy: compilar shared + functions + deploy Firebase

Ver `.claude/agents/` para definiciones completas.
