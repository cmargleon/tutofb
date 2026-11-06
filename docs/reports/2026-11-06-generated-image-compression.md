# Extracción de compresión de outputs — 2026-11-06

Base inicial: `8694f8057e399ad8d5ffc4e17e874100bf9d6312`. Sin commit automático.

## Alcance

Se leyó `persistGeneratedAttempt` antes de editar: el MIME devuelto determina extensión, metadatos Storage y `currentOutput.contentType`; `reuseOutput` conserva ruta, identidad, coste y duración del output existente y evita otro `save`.

Se trasladaron exclusivamente `compressGeneratedImageIfNeeded`, `MAX_STORED_OUTPUT_BYTES`, `OUTPUT_JPEG_QUALITIES` y `OUTPUT_LONGEST_SIDES` a [media/compressGeneratedImage.ts](../../functions/src/media/compressGeneratedImage.ts). El cuerpo y las constantes son textualmente idénticos. La función acepta `{ bytes, contentType }` y devuelve `{ bytes, contentType }`; su única dependencia es Sharp. No inicializa Firebase ni consulta Storage, Firestore, presupuesto o proveedor.

`extensionForContentType` y `mimeTypeFromStoragePath` permanecen en el worker: pertenecen a persistencia y lectura, no a la transformación. Todo el contenido del worker desde `createLog` hasta el final coincide textualmente con la base: claims, reservas/liquidación, review y su reanudación, transacción final, contadores de coste y cleanup no se modificaron por esta extracción. La edición concurrente del import de `estimateGenerationHold` se preservó en el workspace.

## Caracterización antes/después

La misma suite se ejecutó primero contra una copia de la función original, antes de moverla, y después contra el módulo extraído. Las 23 salidas sintéticas coinciden en SHA-256, longitud, MIME, formato, dimensiones, orientación y alpha. Las comparaciones de calidad usan bytes exactos de Sharp; no se tomó ninguna decisión por criterio visual.

| Rama | Casos y comprobación |
| --- | --- |
| Original sin transformar | JPEG, PNG y WebP pequeños, a 3 MiB − 1 y a exactamente 3 MiB: mismo Buffer y MIME, incluidos alpha y EXIF originales. |
| Primer candidato | Los tres formatos a 3 MiB + 1: JPEG mozjpeg calidad 90, sin ampliación, con bytes exactos esperados. |
| Ruido real, sin padding | Los tres formatos a 2200 × 2200 y 2400 × 2400: fuentes mayores de 3 MiB. A 2200, calidad 90 excede el umbral y se acepta 82; a 2400 se reduce a 2200 y se acepta 82 para PNG/JPEG y 90 para WebP. |
| Ejes y orientación | Landscape 3000 × 1000 → 2200 × 733; portrait → 733 × 2200; cuadrada → 2200 × 2200. EXIF 6/8 se autoorienta y elimina metadatos. Se conserva la selección de eje basada en dimensiones codificadas: los casos EXIF quedan en 1000 × 3000 y 3000 × 1000, sin corregir ese comportamiento durante la extracción. |
| Orden completo del encoder | Sharp controlado: cada una de las 42 posiciones puede ser el primer éxito. Escalas `2200, 2000, 1800, 1600, 1400, 1200, 1000`, con calidades `90, 82, 74, 66, 58, 50` dentro de cada escala; `.rotate()`, `mozjpeg`, `inside` y `withoutEnlargement` intactos. |
| Agotamiento de candidatos | Sharp controlado: devuelve el menor candidato aunque siga sobre 3 MiB solo si es estrictamente menor que el original; empate o mayor tamaño conservan Buffer y MIME originales. También se cubren dimensiones ausentes, lado igual al target y fuentes pequeñas que no se redimensionan. |
| Errores y aislamiento | Bytes pequeños opacos no se decodifican; imagen inválida sobre el umbral conserva el rechazo de Sharp. Importación y ejecución en proceso frío no cargan Firebase, Storage, presupuesto ni proveedores, y no hacen red. |

Los fallbacks de agotamiento se fuerzan en el límite de Sharp, sin sustituir servicios de negocio: imágenes normales reducidas a 1000 píxeles difícilmente mantienen un JPEG mayor de 3 MiB. No se presentan esos casos simulados como imágenes reales.

## Persistencia e integración

[automationAdvanced.integration.test.ts](../../tests/automationAdvanced.integration.test.ts) añade seis ejecuciones del worker con proveedor simulado: JPEG, PNG y WebP pequeños y sobre 3 MiB. Comprueba exactamente `generated/{clientId}/{batchId}/{jobId}/{outputId}.{extension}`, bytes descargados, extensión, MIME del documento y de Storage, cache-control y correspondencia del documento de output con `currentOutput`.

El retry operativo comienza con PNG mayor de 3 MiB, persistido como JPEG `.jpg`, y simula un error de transporte de review. Tras reanudar, comprueba una sola llamada al generador, un intento y un output; mismos ID, ruta, MIME, bytes y generación de objeto Storage; mismos costes, duración y contadores de proveedor. La revisión no reescribe la imagen.

## Validación

- `npm --prefix functions run lint` y `npm --prefix functions run build`: correctos en el workspace y en el árbol aislado de release.
- `npm run lint`: correcto.
- Caracterización original: 9/9; extracción junto con `tests/jobWorker.test.ts`: 11/11.
- `npm test` en el workspace: 232 pruebas, 219 aprobadas, 13 omitidas por necesitar emuladores, cero fallos.
- `npm test` en el árbol aislado de la extracción: 228 pruebas, 215 aprobadas, 13 omitidas, cero fallos. La diferencia con el workspace son cuatro pruebas de costes del trabajo concurrente.
- Sobre el código del despliegue concurrente más esta extracción: lint/build de Functions correctos, `npm test` con 232 pruebas (219 aprobadas, 13 omitidas), e integraciones de Automation 40/40. Cero fallos.
- Integraciones de Automation antes y después: 40/40 en cada ejecución, cero omisiones, Auth/Firestore/Storage locales y proveedores simulados.

Comando de integración, sin emular Functions ni llamar a proveedores reales:

```bash
firebase emulators:exec --project demo-manglar-automation --only auth,firestore,storage \
  'node --import tsx --test --test-concurrency=1 tests/automation.integration.test.ts tests/automationAdvanced.integration.test.ts'
```

Hay trabajo concurrente ajeno en Functions y frontend. Se validó primero un árbol aislado desde la base inicial. Después se esperó a que terminara el despliegue concurrente de costes, que también actualizó los cuatro handlers, y se superpuso únicamente esta extracción a su código. Se descargaron los archivos fuente de las cuatro revisiones activas: cada paquete contiene 161 fuentes TypeScript; frente al árbol final solo difiere el worker por esta extracción y se añade el módulo de media. El cuerpo previo del worker coincide con la copia concurrente validada. Así se preservan los cambios de costes ya publicados y se excluye el trabajo de Organizador y frontend del release.

## Despliegue y reversión

El grafo de imports desde las exportaciones de `functions/src/index.ts` identifica cuatro consumidores del worker: `processJobOnActivation`, `processJobOnCreate`, `processJobOnRequeue` y `requeueExpiredJobsOnSchedule`.

```bash
firebase deploy --project tutofb-260320-1003 \
  --only 'functions:processJobOnActivation,functions:processJobOnCreate,functions:processJobOnRequeue,functions:requeueExpiredJobsOnSchedule' \
  --non-interactive
```

Despliegue completado con código 0 en `tutofb-260320-1003`, región `us-central1`, Node.js 22. Los cuatro targets tienen un hash de código nuevo y están `ACTIVE`. Se verificó directamente en Cloud Run que cada revisión nueva está lista y recibe el 100 % del tráfico. Se compararon antes/después CPU, memoria, concurrencia, máximo de instancias, cuenta de servicio, timeout, variables de entorno y referencias/versiones de secretos: sin cambios. Los avisos existentes del SDK sobre versión y evaluación de Params durante discovery no impidieron el despliegue; no se modificaron dependencias ni parámetros para esta extracción.

| Función | Revisión previa, tras el trabajo concurrente | Revisión de esta extracción |
| --- | --- | --- |
| processJobOnActivation | `processjobonactivation-00031-qoz` | `processjobonactivation-00032-gom` |
| processJobOnCreate | `processjoboncreate-00105-zaq` | `processjoboncreate-00106-lag` |
| processJobOnRequeue | `processjobonrequeue-00105-sem` | `processjobonrequeue-00106-kuc` |
| requeueExpiredJobsOnSchedule | `requeueexpiredjobsonschedule-00104-sew` | `requeueexpiredjobsonschedule-00105-fuw` |

Para revertir sin reprocesar jobs: devolver las tres constantes y el cuerpo original al worker desde la base indicada, y sustituir únicamente el import de media por `import sharp from 'sharp'`. Preservar cualquier otro cambio concurrente. El módulo nuevo puede quedar sin consumidores. Reconstruir, verificar y desplegar los mismos cuatro targets. No cambiar estados, claims, reservas, outputs ni documentos; no ejecutar regeneraciones, requeues manuales, migraciones o borrados. Los outputs existentes conservan rutas y MIME y las revisiones pendientes siguen reutilizándolos.
