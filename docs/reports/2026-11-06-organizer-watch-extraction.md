# Extracción privada de la observación de Organizer

Base: `8694f8057e399ad8d5ffc4e17e874100bf9d6312`. Proyecto: `tutofb-260320-1003`.

## Cambio e invariantes

- `functions/src/organizer/watch.ts` contiene únicamente `watch` y su recorrido privado `scan`. Su interfaz de Drive se limita a `zone`, `children`, `changes` y `startChanges`: no recibe métodos para copiar, mover o borrar archivos. Conserva las escrituras de control y la llamada a `enqueue` existentes.
- `functions/src/organizer/fingerprint.ts` conserva una sola implementación de `compare`: `digest([entry.id, versionOf(entry), entry.path, entry.parents])`. La usan observación, comparación de versiones y persistencia del inventario del worker. Se mantiene SHA-256 sobre JSON, el orden de los campos y la ordenación de las huellas para la huella del inventario.
- Se conservan el recorrido y la paginación por carpeta, la omisión de elementos en papelera o administrados y la comprobación de pertenencia al padre. `drive.ts`, `store.ts` y `planning.ts` se revisaron y permanecen sin cambios de esta tarea.
- Se conservan la paginación de cambios de Drive y la recuperación ante 400/403/404/410. El cursor inválido queda en `null`, se reconcilia mediante escaneo completo y la siguiente observación obtiene otro cursor, como antes.
- El escaneo completo mantiene sus cuatro condiciones: cambios detectados o cursor inicial/inválido, ausencia de huella observada, diferencia observado/procesado y una hora desde el último escaneo.
- La transacción vuelve a leer habilitación, `activeRunId`, `sourceIds` y `parentId`. Mantiene `observedFingerprint`, `observedAt`, `lastPollAt`, `changeCursor`, `watcherError`, `lastFullScanAt` y `watcher`; respeta huellas bloqueadas, debounce y el ID derivado de `automatic-${fingerprint}-${config.observedAt}`.
- `tickOrganizer` y `organizerScheduler` son textualmente idénticos a la base. Conservan entradas, atención de runs existentes, cursor del scheduler, leases, `0 12,18 * * *`, `America/Mexico_City`, timeout 540 s, 1 GiB, una instancia, concurrencia 1 y bindings de secretos.
- No se modifican identidades, guarda de destinos, backups, políticas de IA ni catálogo derivado. No se ejecuta ningún tick, callable de organización o trabajo de Scheduler en producción como validación.

## Pruebas y revisión

- `npm --prefix functions run build`: correcto en workspace y copia aislada de despliegue.
- `npm --prefix functions run lint`: correcto en ambos.
- `npm run lint`: correcto en ambos.
- `npm test`: 232 pruebas, 219 aprobadas, 13 omitidas por depender de emuladores; cero fallos. Incluye los cambios concurrentes presentes en el workspace al ejecutarse.
- Integración efectiva de la copia aislada, con Auth/Firestore/Storage locales y Drive/Gemini simulados: **39 aprobadas, cero fallos, cero omisiones**. Ejecuta `organizer.test.ts`, `organizerHybrid.test.ts`, `organizerAutomation.test.ts` y `organizer.integration.test.ts` secuencialmente. Incluye 18 casos nuevos de observación: paginación/exclusiones/huella/debounce/ID/repetición, cuatro códigos de cursor inválido, seis condiciones de escaneo, cuatro cambios concurrentes de configuración, dos guardas iniciales y propagación de error 503 (algunos aspectos se comprueban juntos en un caso).
- Las nuevas comprobaciones verifican que Drive solo recibe lecturas y que la observación solo encola, sin ejecutar el run ni crear catálogo/manifiestos. Se conserva también el recorrido completo de integración existente, con ejecución pausada, simulación, clasificación, caché y handoff incremental.
- Hubo un conflicto de puertos en el primer intento de emuladores y un reinicio de Storage en un intento posterior dentro del workspace. La ejecución final aislada terminó correctamente con código 0 usando puertos dedicados (Firestore 18086, Auth 19096 y Storage 19196). No se modificó `firebase.json`.
- Revisión mecánica: cuerpos de `watch`/`scan` iguales a la base salvo exportación y tipos de lectura; fórmula de `compare` idéntica; `tickOrganizer`/scheduler idénticos; `git diff --check` correcto.
- La fuente publicada previa coincide con HEAD en worker, Drive, store, planning, package y tsconfig. La comparación de **todos los JS compilados** de la copia aislada contra el archivo publicado previo identifica únicamente `organizer/worker.js` modificado y `organizer/watch.js` / `organizer/fingerprint.js` nuevos. Así se excluyen cambios concurrentes de costos, imágenes y frontend.

Comando de integración (configuración temporal con puertos dedicados y rutas absolutas a las reglas existentes):

```sh
GCLOUD_PROJECT=demo-tutofb-organizer firebase --debug emulators:exec \
  --config /tmp/tuto-organizer-watch-emulators.json \
  --project demo-tutofb-organizer --only firestore,auth,storage \
  'node --import tsx --test --test-concurrency=1 tests/organizer.test.ts tests/organizerHybrid.test.ts tests/organizerAutomation.test.ts tests/organizer.integration.test.ts'
```

## Despliegue y validación remota

Único consumidor afectado: `organizerScheduler`, exportado por `functions/src/index.ts`. Los nuevos módulos no se exportan como endpoints. Se despliega desde una copia aislada de HEAD más los archivos de esta extracción:

```sh
firebase deploy --project tutofb-260320-1003 \
  --only functions:organizerScheduler --non-interactive
```

Revisión previa: `organizerscheduler-00013-zuc`. Fuente previa inmutable: bucket `gcf-v2-sources-1003939376366-us-central1`, objeto `organizerScheduler/function-source.zip`, generación `1793997495795020`.

Resultado remoto: despliegue correcto (código 0). `organizerscheduler-00014-xuf` está `ACTIVE`, coincide con `latestCreatedRevisionName` y `latestReadyRevisionName`, tiene las tres condiciones de readiness en `True` y recibe el 100 % del tráfico. La fuente nueva tiene generación `1793998110443719` en el mismo objeto/bucket.

Se descargó el paquete publicado después del despliegue y se compararon sus **200 JS compilados** contra la copia probada: todos coinciden. Contra la fuente anterior solo cambia `organizer/worker.js`, se añaden `organizer/watch.js` y `organizer/fingerprint.js`, y no desaparece ningún JS. Los tres fuentes TS publicados también coinciden con los probados; Drive/store/planning publicados son idénticos a los anteriores.

La comparación remota anterior/posterior conserva runtime Node 22, service account, variables de entorno, bindings de secretos, memoria, timeout, máximo de instancias, concurrencia e ingress. Cloud Scheduler conserva cron, zona horaria, estado habilitado, destino HTTP/OIDC, reintentos y deadline. La consulta de errores de la revisión nueva no devolvió entradas al validar. Solo se consultaron metadatos, artefactos y logs: no se invocó el endpoint ni se ejecutó manualmente el job de Scheduler.

## Rollback sin borrar cursores

Restaurar únicamente `functions/src/organizer/worker.ts` de la base indicada, en una copia aislada que conserve las demás fuentes desplegadas. Los módulos nuevos pueden quedar sin consumidores. Reconstruir, ejecutar las mismas pruebas y desplegar únicamente `functions:organizerScheduler` con el mismo proyecto. El archivo fuente remoto previo y su generación permiten contrastar la reversión.

No borrar ni reiniciar `system_config/organizer_scheduler`, `changeCursor`, huellas, `observedAt`, `lastFullScanAt`, `activeRunId`, runs, leases o manifiestos. No cancelar ejecuciones ni iniciar una sincronización para comprobar el rollback: los contratos y datos conservan su formato y continúan desde su estado existente.
