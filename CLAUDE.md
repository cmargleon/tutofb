# CLAUDE.md

Guia corta de contexto para este repositorio, regenerada desde el codigo actual.

Si un documento viejo contradice al repo, manda el repo.

## Que leer primero

1. `ARCHITECTURE.md`
2. `AGENTS.md`
3. `DECISIONS.md` solo si la tarea toca contratos, auth, jobs, outputs, analytics o salud del sistema

## Snapshot real del repo

- frontend SPA en `src/` con React 19 + TypeScript + Vite
- backend en `functions/src/` con Firebase Cloud Functions v2 sobre Node 20
- contrato compartido en `shared/src/`
- Firebase configurado con Hosting, Firestore, Storage y Functions en `firebase.json`
- scripts reales en raiz y en `functions/package.json`

## Comandos utiles

- desarrollo frontend: `npm run dev`
- build frontend: `npm run build`
- chequeo TypeScript frontend: `npm run lint`
- build Functions: `npm --prefix functions run build`
- suite de tests del repo: `npm test`

## Zonas sensibles

- `shared/src/types.ts`
- `shared/src/domain.ts`
- `src/firebase.ts`
- `src/app/AppRouter.tsx`
- `functions/src/index.ts`
- `functions/src/auth/roles.ts`
- `functions/src/workers/jobWorker.ts`
- `functions/src/triggers/analyticsTriggers.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/regenerateJob.ts`

## Reglas practicas

- si cambias `functions/src/`, compila Functions
- si cambias `shared/src/`, auth, jobs, outputs o analytics, corre `npm test`
- no edites `functions/lib/` a mano; es salida generada
- permisos y roles viven entre `users/{uid}`, custom claims, `syncUserClaims` y `syncClaimsOnUserWrite`
- el frontend conecta a Firebase desde `src/firebase.ts` y puede usar emuladores via `VITE_USE_FIREBASE_EMULATORS`

## Modelo mental minimo

- hay rutas para login, dashboard, usuarios, clientes, modelos, generacion, cola, evaluacion, archivo y analytics
- `shared/src/` define tipos y semantica compartida entre frontend y backend
- el pipeline principal de jobs vive en callables + triggers + `functions/src/workers/jobWorker.ts`
- analytics y salud del sistema tienen colecciones y callables propios; no mezclar cambios ahi sin revisar impacto transversal
