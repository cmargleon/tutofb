# Flujo de generación de fotos

Decisiones de producto acordadas el 1 de noviembre de 2026. Estas reglas se aplican al trabajo futuro en este proyecto.

## Wizard manual

1. **Cliente y fotos:** elegir el cliente y subir artículos individuales, carpetas o varias referencias del mismo artículo. Gemini identifica prendas/accesorios u objetos y analiza las vistas. La selección inicial de ropa/objetos deja de ser obligatoria.
2. **Preparar fotos:** para ropa, elegir modelo y revisar las poses compatibles sugeridas; para objetos, revisar las escenas predeterminadas.
3. **Revisar y generar:** elegir la salida disponible, preparar el spreadsheet si corresponde y revisar proveedor, cantidad de imágenes y costo. Los prompts se editan desde los ajustes avanzados.

La detección y una corrección manual conservan las fotos ya subidas. Cambiar de modelo reutiliza el análisis visual. Una prenda también puede fotografiarse como producto si el operador lo decide.

## Mayoría del lote

Un lote final contiene ropa o contiene objetos. Si las referencias incluyen ambos tipos, al terminar el análisis se conserva automáticamente el tipo que tenga más artículos y se excluyen los artículos minoritarios.

- La mayoría se cuenta por **artículos**, no por cantidad de fotos: un artículo con cuatro referencias cuenta como uno.
- Ejemplo: ocho prendas y dos objetos dejan un lote de ocho prendas. Dos prendas y ocho objetos dejan un lote de ocho objetos.
- Mostrar una advertencia visible con la cantidad y los nombres excluidos y el tipo que se conservó. La exclusión es del lote de generación; no implica borrar productos existentes del catálogo.
- Si hay empate o la clasificación no tiene suficiente certeza, no excluir artículos automáticamente. El operador debe elegir el tipo de fotografía antes de continuar.

## Defaults compartidos con automatización

El proveedor predeterminado es **GPT Image 2.5 Flare** (`fal-gpt-image-2.5-flare`), preseleccionado en el wizard y usado automáticamente cuando no se solicita un proveedor ni hay uno explícito en el preset del cliente.

Las nuevas fotografías usan `commercial-photo-v1`, definido en `shared/src/commercialPhoto.ts`. Proporción predeterminada ancho:alto **3:4** (Portrait 4:3). Seleccionar proveedor restablece el encuadre comercial, conservando calidad, formato solicitado y resolución nativa seleccionada. Cambiar ropa/objetos conserva las configuraciones del operador. Los defaults inicializados no se utilizan para anular un preset explícito del cliente en Automatización.

Se separan tres conceptos: `imageConfig` solicita generación; `photoProfile` autoriza la política de almacenamiento; `JobOutput.storedImage` registra el archivo observado. Solicitar PNG/WebP, dimensiones o calidad explícitos sigue siendo válido y no cambia implícitamente el almacenamiento JPEG del perfil. `auto` se envía sin convertirlo en una proporción fija.

Precedencia: configuración explícita de solicitud → preset compatible del cliente cuando corresponde → default comercial del proveedor. Si una solicitud de Automatización cambia proveedor, se ignora la configuración de otro proveedor del preset. No se amplía su API con detalles de imagen: permanecen en `AutomationPreset`.

| Proveedor activo | Default anterior | Nueva solicitud 3:4 | Calidad / formato solicitado |
| --- | --- | --- | --- |
| GPT Image 2.5 Flare/Sunburst | portrait_4_3 (768×1024), PNG | 1536×2048 | medium / JPEG |
| GPT Image 2 | portrait_4_3 (768×1024), PNG | 1536×2048 | medium / JPEG |
| Seedream 5 Pro/Flash | portrait_4_3, PNG forzado localmente | 1536×2048 | calidad nativa sin cambio / JPEG |
| FLUX.2 Edit | portrait_4_3, PNG | 1536×2048 | calidad nativa sin cambio / JPEG |
| Nano Banana Pro/2 | 3:4, 1K, PNG | 3:4, nivel nativo 2K | calidad nativa sin cambio / JPEG |
| Seedream 4.5 | portrait_4_3, sin output_format | 1665×2220 | sin output_format (no documentado) |
| Seedream 5 Lite | portrait_4_3, formato nativo | 1665×2220 | calidad nativa sin cambio / JPEG |

Para GPT, Pro/Flash y FLUX se solicitan 2048×2048 en 1:1 y 2048×1536 en 4:3. El generador compartido usa un multiplicador común de la proporción: GPT 2:3 pide 1344×2016, conservando ambos ejes múltiplos de 16. Para Seedream 4.5/Lite, 3:4 pide 1665×2220 y 4:3 pide 2220×1665, superficie ≥2560×1440; 1:1 pide 2048×2048. El servidor de fal puede ajustar dimensiones. Banana no acepta width/height arbitrarios: 2K es un nivel nativo, no una promesa de lado mayor 2048 ni de 1536×2048. No hay una tabla normativa de dimensiones por proporción en su OpenAPI; el archivo recibido siempre se mide. No se amplían los límites locales de opciones explícitas para aprovechar límites remotos más amplios.

### Persistencia y compatibilidad

El servidor resuelve y persiste la versión y la configuración efectiva al crear lotes/jobs. La creación directa de Automatización congela `resolvedPreset`; los planes nuevos congelan preset, versión y estimación antes de autorizarse. Ejecutar un plan existente no vuelve a aplicar defaults comerciales. Reintentos y regeneraciones conservan la marca existente; no se añade a jobs históricos. Una automatización histórica sin preset resuelto usa el resolver legacy. El proveedor OpenAI directo sigue retirado. Los defaults legacy y la generación de modelos humanos no se cambian.

Para cada resultado nuevo con el perfil se garantiza **JPEG sRGB de 8 bits, máximo 2_800_000 bytes y lado mayor máximo 2048, sin ampliación**. Alcanzar exactamente 2048 depende del proveedor, la entrada, la configuración explícita y la compresión necesaria. Nunca se recorta, deforma, rellena ni añaden bandas para ocultar diferencias. Alpha se compone sobre blanco al convertir a JPEG.

Sharp decodifica los bytes reales con errores de truncamiento habilitados, aplica EXIF, convierte a sRGB y adjunta ICC sRGB. Se prueba mozjpeg a 90, 88, 85, 82, 80 en la mayor resolución permitida; luego se reduce el límite un 10% y se repiten esas calidades. Prima resolución sobre calidad entre escalas; cada candidato parte del original. Se evitan escalas equivalentes y se cuentan metadatos en el tamaño final. Incluso imágenes pequeñas PNG/WebP/JPEG pasan por esta normalización. Si no se cumple el límite, se lanza error y no se guardan bytes inválidos o demasiado pesados.

Se conserva `generated/{clientId}/{batchId}/{jobId}/{outputId}.jpg` con MIME `image/jpeg` en Storage y JobOutput. `storedImage` guarda dimensiones/tamaño efectivos, formato, profundidad, espacio, ICC, dimensiones originales orientadas y diferencia frente a geometría solicitada; no presenta las dimensiones solicitadas como observadas. La revisión inicial Gemini sigue recibiendo el original del proveedor. Un error de normalización sale por el manejo general de fallos, separado del catch de Gemini, sin segunda compresión.

Reanudar revisión reutiliza el output: no invoca fal, no comprime ni guarda el archivo; conserva ruta, MIME, metadatos, costo, duración e historial. Solo cambia revisión/estado. Los assets siguen privados, con el resolver de Storage y `publicGeneratedImage` existentes; no se crean buckets, copias ni formatos de exportación adicionales. Las descargas y exportaciones consumen la ruta/MIME persistidos.

### Evidencia y límites de validación

Documentación y OpenAPI exactos revisados el 9 de noviembre de 2026:

- [Flare](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api), [Sunburst](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api) y [límites publicados GPT 2.5](https://fal.ai/gpt-image-2.5).
- [GPT Image 2 edit](https://fal.ai/models/openai/gpt-image-2/edit/api): dimensiones personalizadas y JPEG; múltiplos de 16 documentados en su página de edición. OpenAPI genérico declara ImageSize hasta 14142 por eje, sin todos los límites cruzados; Tuto conserva su validación más restrictiva (3840, ratio 3:1, área 655360..8294400) sin extrapolar una ampliación.
- [Seedream Pro](https://fal.ai/models/bytedance/seedream/v5/pro/edit/api) y [Flash](https://fal.ai/models/bytedance/seedream/v5/flash/edit/api): área remota 921600..4624220 y JPEG; se conserva el rango local más estrecho.
- [FLUX.2 edit](https://fal.ai/models/fal-ai/flux-2/edit/api): 512..2048 por eje y JPEG.
- [Banana Pro](https://fal.ai/models/fal-ai/nano-banana-pro/edit/api) y [Banana 2](https://fal.ai/models/fal-ai/nano-banana-2/edit/api): proporción, resolución nativa y JPEG; sin dimensiones arbitrarias.
- [Seedream 4.5](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api) y [Lite](https://fal.ai/models/fal-ai/bytedance/seedream/v5/lite/edit/api): superficie nativa mínima 2560×1440; solo Lite anuncia output_format.

Cada OpenAPI se consulta en `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint exacto>`; en la página API el enlace Schema apunta al mismo documento. Las pruebas de integración usan adapters reales, respuestas fal simuladas e imágenes válidas, Firestore/Auth/Storage emulados y red externa bloqueada por el runner. Las dimensiones observadas en esos fixtures no acreditan una generación remota. No se ejecutaron generaciones reales ni se incurrió en cargos fal de verificación.

Los objetos producen **seis fotos por artículo**: cuatro lifestyle y dos con personas usando el producto, con fondos relativamente neutros en estas últimas. El wizard y la automatización comparten las escenas de `shared/src/productGeneration.ts` y las instrucciones globales de `system_config/main`. Un cambio de default debe mantener ambos recorridos sincronizados.

La API de automatización conserva su contrato de tipo explícito (`jobType`); no se añade un lote de tipos mezclados ni se cambia ese contrato para inferir permisos. Véase `AUTOMATION.md`.

## Modelos por género en automatización

Configuración incluye dos prompts adicionales para prendas, uno para modelo hombre y otro para modelo mujer. Ambos empiezan vacíos. El wizard muestra el bloque correspondiente al sexo del modelo y permite editarlo para ese lote; al cambiar de sexo se carga el bloque del nuevo modelo. Automatización compone el mismo prompt completo con los valores globales y el modelo elegido por artículo. Un modelo sin sexo reconocido no incluye ninguno de los dos bloques. Los objetos no los utilizan.

En **Clientes → Google Drive y automatización** se eligen los modelos masculino y femenino predeterminados. Un único modelo activo de cada género se preselecciona automáticamente; con varios candidatos se respeta la selección guardada. Los modelos sin género registrado pueden asignarse manualmente. Solo se admiten modelos activos del propio cliente.

La llamada inicial de clasificación de referencias también devuelve `garmentGender` (`male`, `female`, `unisex` o `null`), confianza y explicación por artículo. Se analiza la prenda y todas sus referencias antes de elegir el modelo; no se deduce su público únicamente de la persona fotografiada. Unisex significa igualmente apropiado para ambos (50/50), no falta de evidencia.

- Un modelo explícito en el pedido o preset tiene prioridad. En su ausencia se usan los predeterminados por género; el modelo general anterior queda como respaldo si no hay ninguno por género.
- Con ambos disponibles y confianza de al menos 0.65 se usa el correspondiente. Para unisex se elige uno de forma estable por pedido/artículo, conservándolo en los reintentos.
- Con un único predeterminado disponible se usa para cualquier prenda, incluso si el género es incierto. Con ambos y detección incierta, el artículo requiere revisión; sus referencias se conservan.
- Un pedido mixto crea un lote por modelo, vinculados en `automationJobs.batchIds`, con un único presupuesto, progreso y descarga. `batchId` conserva el primer lote para compatibilidad. Todos los lotes se crean en una misma transacción para evitar duplicados.
- Los planes estiman imágenes y costo usando el modelo con más poses; tras clasificar se selecciona un solo modelo por artículo y se filtran las poses compatibles. El Organizador inteligente utiliza este mismo recorrido cuando envía prendas a automatización.
