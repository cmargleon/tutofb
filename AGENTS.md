# AGENTS.md

## Project Rules
- Treat this repo as a real Firebase project by default: `localhost:3000` does not imply emulators unless `VITE_USE_FIREBASE_EMULATORS=true`.
- When a requested change has remote Firebase impact, treat the task as incomplete until the corresponding Firebase deploy has been run; do not leave remote code/config behind local edits.
- Keep diffs small and domain-scoped; avoid broad rewrites of pages, hooks, rules, or shared contracts.
- Source of truth order: code > tests > docs.
- Tests in `tests/` may import compiled JS from `functions/lib`; build Functions before running them.
- Changes to `shared/src/` must remain compatible with both frontend and Functions.
- Remote-impacting changes are any edits to `functions/src/`, Firebase rules/indexes, auth claims, Firestore schema, Storage path conventions, or callable contracts.

## Commands
- Dev server: `npm run dev`
- Frontend build: `npm run build`
- Root/frontend typecheck: `npm run lint`
- Full test suite: `npm test`
- Single test file: `npm --prefix functions run build && node --import tsx --test tests/<name>.test.ts`
- Functions typecheck: `npm --prefix functions run lint`
- Functions build: `npm --prefix functions run build`
- Functions deploy: `npm --prefix functions run deploy`
- Functions logs: `npm --prefix functions run logs`
- E2E single spec, with dev server already running: `./node_modules/.bin/playwright test e2e/<name>.spec.ts`
- No file-scoped lint command exists; use the project TypeScript checks above.

## Code Style
- Frontend pattern: pages orchestrate; feature hooks own state/actions; `src/features/*/firebase.ts` owns Firestore/callable access.
- Use typed `httpsCallable<Request, Response>` wrappers and define request/response contracts in `shared/src/types`.
- Use `onSnapshot` subscription helpers that return unsubscribe functions and take explicit error callbacks.
- Use `FeedbackProvider` hooks (`useToast`, `useConfirm`, `useConfirmByName`) for user feedback; avoid `alert`, `confirm`, and silent destructive actions.
- Reuse `src/components/ui.tsx` and existing feature components before adding new UI primitives.
- Use `useAuth` and `useRole` for frontend role gating; use `assertCallableRoles` and `assertUserRoles` for backend gating.
- In Functions, use `getAppFirestore()` instead of direct `getFirestore()` so the configured Firestore database ID is honored.
- Reuse `shared/src/domain.ts`, `shared/src/providerImageConfig.ts`, and `shared/src/constants/providerCosts.ts` for provider and domain behavior.
- Use `src/features/storage/useStorageAssetUrl.ts` or `resolveStorageAssetUrl()` for image URLs; generated assets are routed through `publicGeneratedImage`.

## Constraints
- Do not edit generated output: `functions/lib/`, `dist/`, `coverage/`, `node_modules/`.
- Do not hand-edit secrets in `.env*`; `.env.example` is documentation only.
- Do not change provider IDs, job statuses, batch statuses, roles, or Storage path formats without updating shared types, validators, backend logic, rules, and tests together.
- Do not bypass Cloud Functions for privileged operations; frontend direct writes are intentionally narrow.
- Do not change Firebase project config, rules, indexes, or deploy targets casually; `.firebaserc` points at `tutofb-260320-1003`.
- Avoid dependency or lockfile churn unless the task explicitly requires it.

## Project Structure
- Routing and protected pages: `src/app/AppRouter.tsx`
- App providers: `src/app/App.tsx`
- Firebase client setup: `src/firebase.ts` and `firebase-applet-config.json`
- Shared contracts: `shared/src/types/`
- Shared domain prompts and enums: `shared/src/domain.ts`
- Provider image config normalization: `shared/src/providerImageConfig.ts`
- Runtime params and secrets: `functions/src/config/runtime.ts`
- Runtime operational config document: `system_config/main`, accessed via `functions/src/admin/systemConfig.ts`
- Functions export surface: `functions/src/index.ts`
- Callable authorization: `functions/src/auth/roles.ts`
- Batch creation flow: `functions/src/callables/createGenerationBatch.ts` and `createGenerationBatch.helpers.ts`
- Job execution pipeline: `functions/src/workers/jobWorker.ts`
- Provider integrations: `functions/src/providers/`
- Gemini review flow: `functions/src/review/`
- Spreadsheet import/export logic: `functions/src/spreadsheets/`
- Permissions source of truth: `firestore.rules` and `storage.rules`

## Good Examples
- `src/features/users/firebase.ts`: typed callable wrappers plus filtered realtime subscription.
- `src/features/users/useUserManagement.ts`: feature hook owns form state, filtering, confirmations, and mutations.
- `src/features/generate/wizard/state.ts`: wizard defaults and derived behavior kept outside components.
- `src/features/generate/wizard/submit.ts`: request construction reuses shared provider config helpers.
- `functions/src/callables/createGenerationBatch.ts`: callable validates roles/config, reads related snapshots, then writes batch/jobs consistently.
- `functions/src/callables/createGenerationBatch.helpers.ts`: isolated validation/domain helpers with direct test coverage.
- `functions/src/workers/jobWorker.ts`: transaction-based claiming, structured logs, output persistence, and retry/review flow.
- `src/features/storage/assets.ts`: centralized Storage URL caching, retry, and generated-image URL handling.

## Anti-Patterns
- Duplicating types or enum literals already defined in `shared/src/`.
- Adding a provider only in the UI without updating shared validation, backend dispatch, costs, config, and tests.
- Writing privileged Firestore documents directly from frontend when an existing callable pattern exists.
- Updating UI role checks without matching backend and rules authorization.
- Editing `functions/lib` instead of `functions/src`.
- Creating new global UI primitives when `src/components/ui.tsx` or feature-local components already cover the case.
- Fetching many Storage download URLs ad hoc instead of using the centralized resolver.
- Mixing broad cleanup refactors with behavior changes in the same diff.

## Safety & Permissions
- Safe to run without confirmation: `npm run lint`, `npm run build`, `npm test`, `npm --prefix functions run build`, single test files, read-only git inspection, and the local dev server.
- Ask before installs or dependency changes: `npm install`, package upgrades, lockfile edits.
- Ask before destructive local actions: deleting files/directories, clearing generated data, migrations, or bulk rewrites.
- Ask before git state changes unless explicitly requested: commit, push, reset, rebase, stash pop/drop.
- Firebase deploys are expected for remote-impacting code/config changes because this project works directly against real Firebase; ask only when the user explicitly wants no remote mutation or when the operation goes beyond the requested change.
- If touching `functions/src/` or `shared/src/`, run `npm --prefix functions run build`.
- Run `npm test` for changes affecting contracts, auth, jobs, analytics, spreadsheets, finance, or cross-domain behavior.
