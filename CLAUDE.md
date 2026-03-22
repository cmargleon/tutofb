# CLAUDE.md

Archivo de contexto automatico para Claude Code.

## Documentos de referencia

Antes de tocar cualquier archivo, leer en este orden:

1. `ARCHITECTURE.md` — estructura del sistema, dominios, flujo de generacion, modelo de datos y zonas de riesgo
2. `AGENTS.md` — division de responsabilidades por agente y criterio de asignacion de tareas
3. `DECISIONS.md` — decisiones tecnicas con contexto e impacto (DEC-001 a DEC-010)

## Resumen rapido

- App interna de operacion para catalogo ecommerce
- Stack: React 19 + TypeScript + Vite / Firebase Cloud Functions v2 / Firestore / Cloud Storage
- Integraciones externas: fal.ai, OpenAI, Gemini

## Reglas criticas

- `shared/src/` es el contrato transversal — no modificar sin revisar impacto en frontend, functions y tests
- `jobs` = estado operativo actual / `outputs` = historial real de resultados (DEC-001)
- El procesamiento ocurre server-side disparado por triggers, no desde el frontend (DEC-003)
- Una regeneracion nunca borra la imagen vigente hasta tener un resultado nuevo valido (DEC-004)

## Zonas de riesgo

- `shared/src/types.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/triggers/analyticsTriggers.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/regenerateJob.ts`
- Cualquier cambio en estados de `Job` y `Batch`

## Criterio de asignacion por dominio

| Tarea | Agente |
|---|---|
| Wizard, creacion de lotes, jobs | `generation-agent` |
| Modelos, poses IA | `models-agent` |
| Cola, evaluacion, descarga, regeneracion | `evaluation-agent` |
| Worker, trigger, proveedor | `backend-core-agent` |
| Metricas, alertas, salud | `analytics-health-agent` |
| Usuarios, roles, clientes, archivo | `admin-agent` |
| Toca varios dominios | `planner-orchestrator` |
