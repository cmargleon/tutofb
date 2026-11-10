# Perfil fotográfico comercial v1 — entrega 2026-11-09

Implementado y publicado en `tutofb-260320-1003`. Se mantiene `fal-gpt-image-2.5-flare` como default. La política compartida cubre nuevas fotos de ropa y objetos de Wizard, Automatización directa y planes, con estimaciones de Manglar coherentes.

## Resultado y garantías

Para nuevas imágenes marcadas: **JPEG sRGB de 8 bits, ICC sRGB, máximo 2_800_000 bytes y lado mayor máximo 2048, sin ampliación**. No se recorta, deforma, añaden bandas ni padding. Transparencia sobre blanco al convertir. Llegar exactamente a 2048 depende del proveedor, entrada, configuración explícita y compresión. Generación y almacenamiento son contratos distintos; PNG/WebP y calidad explícitos del proveedor se respetan.

Los defaults comerciales, tamaños por proporción, fuentes/OpenAPI exactos y excepciones se detallan en [PHOTO_GENERATION.md](../PHOTO_GENERATION.md); costos en [provider-pricing.md](../provider-pricing.md).

| Proveedores | Antes | Nueva solicitud predeterminada 3:4 |
| --- | --- | --- |
| `fal-gpt-image-2.5-flare`, `fal-gpt-image-2.5-sunburst`, `fal-gpt-image-2` | portrait_4_3 (768x1024), medium, PNG | 1536x2048, medium, JPEG |
| `fal-seedream-5-pro`, `fal-seedream-5-flash`, `fal-flux-2-edit` | portrait_4_3, PNG forced by adapter | 1536x2048, native generation quality unchanged, JPEG |
| `fal-banana-pro`, `fal-nano-banana-2` | 3:4, native 1K, PNG | 3:4, native 2K, JPEG; actual dimensions measured, not guaranteed 1536x2048 |
| `fal-seedream` | portrait_4_3, native format | 1665x2220; no output_format parameter |
| `fal-seedream-5` | portrait_4_3, native format | 1665x2220, JPEG |

En 1:1 se busca 2048×2048 y en 4:3 2048×1536; Seedream 4.5/Lite requieren 2220×1665 en 4:3 por la superficie mínima. GPT 2:3 solicita 1344×2016 para conservar proporción y múltiplos de 16. Banana usa un nivel nativo, sin dimensiones arbitrarias. `auto` permanece automático.

## Evidencia observada

No se hicieron generaciones remotas de verificación: **costo fal de verificación US$0**. La evidencia de capacidades viene de documentación oficial/OpenAPI; la evidencia de ejecución viene de respuestas simuladas con adapters reales e imágenes válidas y almacenamiento en emuladores. No son comprobaciones de inferencia remota.

Los 40 recorridos nuevos cubren diez proveedores activos × ropa/objetos × Wizard/Automatización. El proveedor simulado devuelve un PNG real de 24×30 aunque sus metadatos declaren 9999×9999: se observa y conserva 24×30, convertido a JPEG y registrado como diferencia de geometría. Las pruebas de compresión observan 1536×2048, 2048×2048, 2048×1536 y 13×7 sin ampliación, más reducción de 3000×1000 a 2048×683. Verifican EXIF, alpha blanco, ICC, CMYK/P3, profundidad de 16 a 8 bits, bytes inválidos/truncados y compresión adaptativa.

Históricos sin marca, planes autorizados, modelos humanos, costos, reintentos y regeneraciones conservan sus recorridos. La recuperación de revisión demuestra ausencia de llamadas a fal, compresor y Storage.save, conservando ruta/MIME/metadatos/costo/duración. Un fallo del compresor no guarda bytes y no vuelve a comprimir desde el catch de Gemini. El perfil no añade buckets ni copias de imágenes; los consumidores existentes de descarga/exportación siguen utilizando las rutas privadas persistidas.

## Costos y presupuesto

Banana 2 pasa de US$0.08 (1K) a US$0.12 (2K); Pro mantiene US$0.15. Seedream Pro con dos referencias estima US$0.1395 al superar 1536²; FLUX con dos referencias y salida 1536×2048 estima US$0.06. GPT conserva medium y usa la heurística existente para tamaños no publicados. Son estimaciones, no facturas ni límites garantizados. Las reservas usan la configuración efectiva congelada; no se cambian cargos históricos.

## Validación

- Typecheck raíz, build frontend, typecheck y build Functions: correctos, también en la copia aislada de publicación con Node 22.
- `npm test -- --test-concurrency=4`: **257 pasan, 0 fallan, 19 integraciones omitidas fuera de emuladores**.
- Runner existente `npm run test:emulators` con Node 22.22.0 ya disponible: **448 pasan, 0 fallan, 1 skip preexistente** de una plantilla SHEIN externa; ninguna prueba nueva omitida en emuladores.
- Playwright Wizard + presupuesto: **12 pasan, 0 fallan**, incluyendo conservación de calidad/PNG/dimensiones al corregir ropa→objetos.
- Sin instalaciones, cambios de dependencias/lockfiles, commits, migraciones o cambios de reglas/índices.

## Publicación verificada

[Frontend publicado](https://tutofb-260320-1003.web.app). El index y el asset de configuración fotográfica servido coinciden byte a byte con el build aislado. Los 24 destinos siguientes están **ACTIVE**, cada uno con hash nuevo; **0 hashes cambiaron en Functions no seleccionadas**. Los hashes, generaciones de origen y versión/canal de Hosting figuran en el [informe JSON](2026-11-09-commercial-photo-release.json).

La copia de publicación se construyó desde HEAD más exclusivamente estos cambios. Se verificó que los archivos de marketplaces ajenos coinciden con HEAD y que las Functions nuevas de marketplaces no están en el paquete. El árbol del usuario conserva su trabajo preexistente.

- `updateClientAutomation` — `us-central1`
- `manglarMcp` — `us-central1`
- `organizerScheduler` — `us-central1`
- `createGenerationBatch` — `us-central1`
- `createProductGenerationBatch` — `us-central1`
- `previewProductDrafts` — `us-central1`
- `regenerateJob` — `us-central1`
- `regenerateFailedBatchJobs` — `us-central1`
- `regenerateJobsBulk` — `us-central1`
- `generateModelPose` — `us-central1`
- `processJobOnActivation` — `us-central1`
- `processJobOnCreate` — `us-central1`
- `processJobOnRequeue` — `us-central1`
- `requeueExpiredJobsOnSchedule` — `us-central1`
- `createAutomationJob` — `us-central1`
- `retryAutomationJob` — `us-central1`
- `createAutomationPlan` — `us-central1`
- `getAutomationPlan` — `us-central1`
- `executeAutomationPlanCallable` — `us-central1`
- `resumeAutomationJob` — `us-central1`
- `automationApi` — `us-central1`
- `automationIntakeWorker` — `us-central1`
- `automationGenerationProgress` — `us-central1`
- `recoverAutomationImports` — `us-central1`

Un primer comando con filtro vacío fue interrumpido durante predeploy (comprobaciones de autorización Storage y typecheck), antes de publicar recursos. La publicación completada utilizó la lista explícita anterior más Hosting; no publicó reglas, índices ni código de marketplaces pendiente.

## Archivos de implementación y pruebas modificados

- `docs/PHOTO_GENERATION.md`
- `docs/provider-pricing.md`
- `e2e/wizard-products.spec.ts`
- `functions/src/automation/persistence.ts`
- `functions/src/automation/plans.ts`
- `functions/src/automation/presets.ts`
- `functions/src/automation/worker.ts`
- `functions/src/callables/createGenerationBatch.helpers.ts`
- `functions/src/callables/createGenerationBatch.ts`
- `functions/src/callables/createProductGenerationBatch.ts`
- `functions/src/callables/regenerateJob.helpers.ts`
- `functions/src/manglar/estimates.ts`
- `functions/src/manglar/wizard.ts`
- `functions/src/media/compressGeneratedImage.ts`
- `functions/src/providers/fal.ts`
- `functions/src/providers/falModels.ts`
- `functions/src/workers/jobWorker.ts`
- `shared/src/providerImageConfig.ts`
- `shared/src/types/automation.ts`
- `shared/src/types/batch.ts`
- `shared/src/types/job.ts`
- `shared/src/types/provider.ts`
- `src/components/clients/ClientAutomationSection.tsx`
- `src/components/wizard/BatchStep.tsx`
- `src/components/wizard/ProviderImageConfigSelection.tsx`
- `src/features/generate/wizard/hooks/useGenerateWizard.ts`
- `src/features/generate/wizard/state.ts`
- `tests/automationAdvanced.integration.test.ts`
- `tests/compressGeneratedImage.test.ts`
- `tests/createGenerationBatch.test.ts`
- `tests/falImageModels.test.ts`
- `tests/photoGenerationFlow.test.ts`
- `tests/providerCosts.test.ts`
- `shared/src/commercialPhoto.ts`
- `tests/commercialPhoto.integration.test.ts`
- `ARCHITECTURE.md`
- `e2e/automation-settings.spec.ts`

Además se añadieron este informe y su JSON de evidencia.
