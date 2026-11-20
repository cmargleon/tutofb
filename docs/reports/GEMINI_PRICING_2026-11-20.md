# Gemini cost estimate — 2026-11-20

Read-only production snapshot at 2026-11-20T19:11:12.554Z. No analytics or finance documents were changed. Official rate card checked 2026-11-20: https://ai.google.dev/gemini-api/docs/pricing

The requested date is shown both in America/Mexico_City (UTC−06:00) and UTC. Today's data is partial at the snapshot cutoff.

## Mexico: 2026-11-20 00:00–24:00 (06:00Z–06:00Z next day)

| Model | Calls | Input tokens | Stored output | Total minus input/output | Recorded USD | Repriced stored tokens USD | With inferred reasoning USD | Conservative policy USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-3.8-flash | 6 | 7227 | 1802 | 1417 | 0.004511 | 0.012178 | 0.017493 | 0.017493 |

Recorded: USD 0.004511. Nominal repricing with inferred reasoning: USD 0.017493; estimated understatement USD 0.012982. Conservative policy: USD 0.017493; difference USD 0.012982.

## UTC: 2026-11-20 00:00–24:00

| Model | Calls | Input tokens | Stored output | Total minus input/output | Recorded USD | Repriced stored tokens USD | With inferred reasoning USD | Conservative policy USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-3.1-flash-lite-preview | 614 | 2548027 | 274339 | 0 | 1.048513 | 1.048505 | 1.048505 | 15.130210 |
| gemini-3.8-flash | 77 | 165257 | 23990 | 48911 | 0.077299 | 0.213908 | 0.397323 | 0.397323 |
| gemini-3.1-flash-lite | 32 | 60499 | 6121 | 0 | 0.024307 | 0.024306 | 0.024306 | 0.024306 |
| (sin modelo) | 252 | 0 | 0 | 0 | 0.000000 | 0.000000 | 0.000000 | 0.000000 |

Recorded: USD 1.150119. Nominal repricing with inferred reasoning: USD 1.470134; estimated understatement USD 0.320015. Conservative policy: USD 15.551839; difference USD 14.401720.

## Interpretation and limitations

- Historical rows did not store thoughtsTokenCount. A positive totalTokens − inputTokens − outputTokens is treated as inferred missing reasoning, not a verified billing measurement; some usage totals can contain other token categories. Already-inclusive output counts add no inferred reasoning.
- The preview alias gemini-3.1-flash-lite-preview is absent from today's official rate card. The nominal comparison assumes stable Flash-Lite pricing (0.25/1.50); it is not verified. The deployed conservative policy instead uses 4/18/18 for this alias. That policy difference is not evidence of actual Google charges.
- Current confirmed 3.8 Flash is 0.75 input / 3.75 output and reasoning; Pro is 2/12/12 through 200k input, 4/18/18 above. New records count reasoning in outputTokens and also retain thinkingTokens separately.
- Empty-model, zero-token rows cannot establish any actual provider cost. No missing-token call or absent record can be reconstructed from these data. No historic budgets, analytics or finance snapshots were recalculated.
- Prior Gemini reserve 0.05 and model-base review allowance 0.01 were below plausible Pro calls. Both now use the shared USD 1.46 ordinary-call envelope (32,768 input + 8,192 response + 65,536 thinking at 4/18/18), still an estimate rather than a contractual cap. Automation/Manglar estimates inherit this allowance. Organizer uses the same shared per-call token pricing and its existing explicit token reservation envelope.
- Production config observed: geminiImageReviewModel=gemini-3.1-flash-lite-preview; env model IDs: gemini-3.1-flash-lite-preview, gemini-3.8-flash. UI also permits Flash preview, Pro preview and legacy 1.5/2.0 models; unsupported/unverified models use conservative prices and warnings.
- Validation: frontend build, root and Functions TypeScript checks, full npm test. Frontend Vite uses its matching 0.25.12 esbuild binary via a command-local ESBUILD_BINARY_PATH; tsx uses the requested root esbuild 4 (0.27.4). No dependencies were changed.

## Deployment scope

Derived from the TypeScript import graph rooted in functions/src/index.ts, restricted to exported Cloud Functions (__endpoint), including transitive and dynamic imports of geminiUsage, the shared rate table, generationEstimates and Manglar budget.

approveModelIdentity, archiveMarketplaceTemplate, automationApi, automationGenerationProgress, automationIntakeWorker, classifyGarmentViewsWithGemini, configureMarketplaceTemplate, createAutomationJob, createAutomationPlan, createGenerationBatch, createMarketplacePhotoBatch, downloadMarketplaceExports, executeAutomationPlanCallable, generateModelMarketplaceBase, generateModelPose, getAutomationPlan, manglarMcp, marketplacePrecomputeOnAutomation, marketplacePrecomputeWorker, onModelWrite, organizerAction, organizerContinuation, organizerManualRun, organizerRunContinuation, organizerScheduler, previewMarketplaceExports, previewMarketplacePhotoPlan, previewModelPhotoSets, previewProductDrafts, processJobOnActivation, processJobOnCreate, processJobOnRequeue, processModelMarketplaceBase, publishMarketplaceImages, recoverAutomationImports, recoverModelMarketplaceBases, requeueExpiredJobsOnSchedule, resumeAutomationJob, retryAutomationJob, retryJobAutoReview, saveMasterProduct, scheduleModelMarketplaceSets, verifyMarketplacePhotoBases, verifyModelMarketplaceBase.

Deploy only these 44 functions, in batches of 20/20/4, from a clean checkout at main after commit and fetch checks. Verify every function source archive against the local compiled lib, deduplicating identical archives.
