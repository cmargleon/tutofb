# Extracción de normalización de imágenes — 2026-11-06

Base revisada: `6d5ac50bb02c408219023a6477a02e65272e6dad`. Sin commit automático.

## Cambio y revisión

Se movieron únicamente `MAX_INPUT_BYTES` y `normalizeInputImage` a [functions/src/media/normalizeInputImage.ts](../../functions/src/media/normalizeInputImage.ts). El cuerpo de la función es textualmente idéntico al de la base; el límite conserva `10 * 1024 * 1024`. [automation/imports.ts](../../functions/src/automation/imports.ts) conserva las dos reexportaciones, con identidad de función verificada. Drive, API y organizador importan directamente el módulo de medios.

La revisión del diff confirma que SSRF, DNS fijado a la dirección validada, allowlist HTTPS, autenticación/impersonación Drive, autorización de cliente/carpeta/archivo, versiones y revisiones, caché y rutas Storage permanecen en sus módulos, sin cambios de comportamiento. No se modificaron dependencias, lockfiles, secretos, contratos, reglas ni assets.

## Grafo anterior y posterior

Antes:

```text
automation/api ────────────┐
organizer/automation ──────┤
                          v
                  automation/imports ──> automation/drive
                          ^                    │
                          └────────────────────┘
                     normalización + límite
```

Después:

```text
automation/imports ──> automation/drive
         │                     │
         │ (reexport compatible)│
         v                     v
         media/normalizeInputImage <── automation/api
                      ^
                      └────────────── organizer/automation
```

El recorrido de dependencias locales del JS compilado confirma que Drive no alcanza `automation/imports`, ni directamente ni transitivamente. La prueba de regresión recorre también las dependencias cargadas de Drive. En proceso frío, importar y ejecutar el normalizador deja cero apps Admin y no carga los módulos de negocio Automation/Drive/organizador/Firebase ni el SDK de Storage. `HttpsError` conserva su clase pública; su SDK carga código de Admin de forma transitiva, sin inicializar ninguna app o servicio.

## Equivalencia antes/después

Se ejecutó la implementación original antes de editar y la extraída después, sobre los mismos 14 casos generados con Sharp. Una comparación profunda verificó igualdad de errores y de todos los metadatos de salida, tamaños y SHA-256; las siete salidas válidas son idénticas byte por byte. Las imágenes base pequeñas tienen 13 × 7 píxeles.

| Caso | Resultado idéntico antes/después | SHA-256 idéntico o mensaje público |
| --- | --- | --- |
| jpeg | 13 × 7, JPEG, 270 bytes | `99a30e2fde1ca65fa69f6cae92cda1b00319e8316f4548f8af9bc087d8f6e08c` |
| png | 13 × 7, JPEG, 270 bytes | `99a30e2fde1ca65fa69f6cae92cda1b00319e8316f4548f8af9bc087d8f6e08c` |
| webp | 13 × 7, JPEG, 271 bytes | `6175eeb5f5abcbf568ec31c61a23e519a510238901225435084d46e492da48bb` |
| oriented | 733 × 2200, JPEG, 9791 bytes | `083fcc358786a31ddde2796729efda52e95e53a582b2fd156f3da9a562f026bd` |
| wide | 2200 × 733, JPEG, 9791 bytes | `7ee8828807c2d75f25c78a209ade4464f21d4ba72c9e8f2a723e3118b38807de` |
| pixelLimit | 2200 × 1375, JPEG, 18071 bytes | `19b355a72a8fad8530ef7c4e8f10d49f67b417b63778fcc2c524daf28df50c80` |
| overPixelLimit | `invalid-argument` | Archivo de imagen no compatible. |
| belowByteLimit | 13 × 7, JPEG, 270 bytes | `99a30e2fde1ca65fa69f6cae92cda1b00319e8316f4548f8af9bc087d8f6e08c` |
| atByteLimit | `invalid-argument` | Imagen vacía o de más de 10 MB. |
| empty | `invalid-argument` | Imagen vacía o de más de 10 MB. |
| invalid | `invalid-argument` | Usa una fotografía JPEG, PNG o WebP. |
| brokenJpeg | `invalid-argument` | Archivo de imagen no compatible. |
| brokenPng | `invalid-argument` | Archivo de imagen no compatible. |
| brokenWebp | `invalid-argument` | Archivo de imagen no compatible. |

Se conserva: rechazo de tamaño `>= 10.485.760` bytes, aceptación de `10.485.759` con PNG válido y padding, firmas JPEG/PNG/WebP originales, máximo inclusivo de 40.000.000 píxeles, autoorientación EXIF, resize dentro de 2200 × 2200 sin ampliar, JPEG calidad 94 y supresión de metadatos. Las pruebas comprueban también las tablas de cuantización de la salida original para detectar cambios de calidad.

## Validación ejecutada

- `npm --prefix functions run build`: correcto antes y después de extraer; también ejecutado por `npm test` y predeploy.
- `npm --prefix functions run lint`: correcto.
- `npm run lint`: correcto.
- `node --import tsx --test tests/normalizeInputImage.test.ts`: 7/7 aprobadas.
- `npm test`: 219 pruebas, 206 aprobadas, 13 omitidas por requerir emuladores, cero fallos.
- `git diff --check`: correcto.

Integraciones con Auth/Firestore/Storage locales y proveedores/Drive/Gemini simulados, sin emular Functions:

```bash
firebase emulators:exec --project demo-manglar-automation --only auth,firestore,storage \
  'node --import tsx --test --test-concurrency=1 tests/automation.integration.test.ts tests/automationAdvanced.integration.test.ts tests/organizer.integration.test.ts tests/organizerAutomation.test.ts tests/driveBackups.integration.test.ts'
```

Resultado: 49 pruebas aprobadas, cero fallos y cero omisiones; emulators:exec finalizó con código 0.

Las integraciones ejercitan upload HTTP, importación desde Storage/Drive, autorización y caché por revisión de Drive, API/planes, cola y revisiones de generación, organizador y handoff Automation, además de permisos/persistencia de backups. Los mocks no acreditan ACL ni credenciales de Drive real, ni fidelidad visual de proveedores reales. Entorno local: Node 25.8.1; runtime desplegado: Node.js 22.

## Despliegue y revisiones

Proyecto `tutofb-260320-1003`, región `us-central1`. Se siguieron las dependencias runtime desde las exportaciones de `index.ts`: 12 módulos de entrada, 20 consumidores desplegables, incluidos los consumidores transitivos de cola/regeneración y MCP. Se desplegaron solamente esos 20 targets mediante:

```bash
firebase deploy --project tutofb-260320-1003 --only 'functions:updateClientAutomation,functions:manglarMcp,functions:organizerScheduler,functions:regenerateJob,functions:regenerateFailedBatchJobs,functions:regenerateJobsBulk,functions:processJobOnActivation,functions:processJobOnCreate,functions:processJobOnRequeue,functions:requeueExpiredJobsOnSchedule,functions:createAutomationJob,functions:retryAutomationJob,functions:createAutomationPlan,functions:getAutomationPlan,functions:executeAutomationPlanCallable,functions:resumeAutomationJob,functions:automationApi,functions:automationIntakeWorker,functions:automationGenerationProgress,functions:recoverAutomationImports' --non-interactive
```

La lectura posterior de Cloud Run verificó una revisión nueva lista y con 100% de tráfico para cada consumidor.

Comprobación HTTP remota: `GET /api/automation/capabilities` sin credenciales devolvió `401` y `error.code = unauthenticated` desde la función desplegada, sin crear trabajos. El deploy terminó correctamente; mostró avisos del SDK sobre su versión y evaluación de params durante el despliegue, fuera del alcance de esta extracción.

| Función | Revisión previa | Revisión desplegada |
| --- | --- | --- |
| updateClientAutomation | `updateclientautomation-00010-ley` | `updateclientautomation-00011-xel` |
| manglarMcp | `manglarmcp-00015-xuf` | `manglarmcp-00016-vak` |
| organizerScheduler | `organizerscheduler-00011-jix` | `organizerscheduler-00012-heq` |
| regenerateJob | `regeneratejob-00098-xiq` | `regeneratejob-00099-hay` |
| regenerateFailedBatchJobs | `regeneratefailedbatchjobs-00097-bil` | `regeneratefailedbatchjobs-00098-pof` |
| regenerateJobsBulk | `regeneratejobsbulk-00095-bos` | `regeneratejobsbulk-00096-jic` |
| processJobOnActivation | `processjobonactivation-00028-moj` | `processjobonactivation-00029-xet` |
| processJobOnCreate | `processjoboncreate-00102-dax` | `processjoboncreate-00103-rim` |
| processJobOnRequeue | `processjobonrequeue-00102-yas` | `processjobonrequeue-00103-bir` |
| requeueExpiredJobsOnSchedule | `requeueexpiredjobsonschedule-00101-tud` | `requeueexpiredjobsonschedule-00102-pay` |
| createAutomationJob | `createautomationjob-00010-giw` | `createautomationjob-00011-lex` |
| retryAutomationJob | `retryautomationjob-00010-fuw` | `retryautomationjob-00011-bag` |
| createAutomationPlan | `createautomationplan-00007-did` | `createautomationplan-00008-kay` |
| getAutomationPlan | `getautomationplan-00006-qed` | `getautomationplan-00007-gum` |
| executeAutomationPlanCallable | `executeautomationplancallable-00007-jej` | `executeautomationplancallable-00008-cig` |
| resumeAutomationJob | `resumeautomationjob-00005-pub` | `resumeautomationjob-00006-piy` |
| automationApi | `automationapi-00015-cam` | `automationapi-00016-lew` |
| automationIntakeWorker | `automationintakeworker-00019-vaw` | `automationintakeworker-00020-yiw` |
| automationGenerationProgress | `automationgenerationprogress-00011-nij` | `automationgenerationprogress-00012-kes` |
| recoverAutomationImports | `recoverautomationimports-00009-xam` | `recoverautomationimports-00010-xor` |

## Reversión sin tocar assets

Restituir únicamente el cuerpo y límite originales en `automation/imports.ts` y los tres imports anteriores en `automation/drive.ts`, `automation/api.ts` y `organizer/automation.ts`, tomando como referencia la base indicada arriba. El módulo nuevo puede quedar sin consumidores. Ajustar la prueba de ausencia del ciclo si se decide volver deliberadamente al grafo anterior. Construir Functions, repetir las verificaciones y desplegar exactamente la misma lista de 20 targets. No ejecutar reset de datos, migraciones, borrados, reimportación ni regeneración de imágenes; las rutas Storage y las claves de caché no cambiaron. Las revisiones previas de la tabla permiten identificar el código remoto anterior.
