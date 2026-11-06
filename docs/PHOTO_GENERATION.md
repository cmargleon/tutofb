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

El formato predeterminado para ropa y objetos es el vertical **Portrait 4:3** (`portrait_4_3`, 768×1024 en el ejemplo del selector). Su proporción real ancho:alto es `3:4`; no confundirlo con `landscape_4_3`, que es horizontal. Al seleccionar un modelo de generación se restablece este encuadre si está disponible, conservando los ajustes de calidad y formato de archivo. Los proveedores con selector de proporciones usan `3:4`. La automatización también usa `3:4` por defecto y respeta una proporción explícita del preset del cliente.

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
