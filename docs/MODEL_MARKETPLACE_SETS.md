# Sets de bases por marketplace

Implementación del 19 de noviembre de 2026. Código de dominio: `shared/src/modelPhotoSets.ts`, recetas configurables en `shared/src/marketplacePhotoRecipe.ts`, planificación única en `shared/src/marketplacePhotoPlan.ts`. El documento de reglas aportado por el usuario se conserva como referencia de obligaciones y recomendaciones; las preferencias de Tuto llevan un nivel y procedencia distintos. No se interpreta un máximo de imágenes como una cantidad requerida.

## Poses y clasificación

`model-marketplace-set-v1` identifica una composición por marketplace, categoría, público, zona corporal, función, encuadre y toma. El wizard exige seleccionar poses concretas (`poseRecipeIds`) del registro compartido `shared/src/modelPoseRecipes.ts`. Cada combinación compatible de pose y destino produce una fotografía: **3 poses × 4 marketplaces = 12 bases**, aunque dos poses compartan orientación. La clasificación general sigue siendo:

1. Portada frontal real, con hombros y cadera de frente.
2. Tres cuartos frontal comercial: giro natural para mostrar volumen y lateral. Una referencia lateral de la prenda no exige perfil humano a 90°.
3. Espalda comercial: posterior de la prenda protagonista, giro discreto y mirada sobre el hombro hacia cámara cuando se ve el rostro. Brazos y cabello deben dejar la prenda libre.

Estas tres orientaciones clasifican las bases y las tareas posteriores; no son un límite ni una cuota automática de generación. Las operaciones históricas sin `poseRecipeIds` conservan la receta general para completar bases existentes. Los detalles son opcionales y solo se crean como tareas cuando existen referencias de detalle reales; no requieren generar otra base humana. Los overrides de vistas/orden del cliente se conservan. Sin evidencia de espalda o lateral se informa de la omisión; `missingReference=review` retiene el artículo completo para atención.

| Destino | Portada predeterminada | Secundarias predeterminadas | Formato de bases |
| --- | --- | --- | --- |
| Amazon | Frontal de pie, blanco puro, comprobación de ojos/boca/brazos visibles | Tres cuartos y espalda sobre neutro | General/preset compatible, default 3:4 |
| TikTok Shop | Frontal, blanco puro | Tres cuartos y espalda sobre neutro | 1:1 nativo, preferencia de Tuto |
| Mercado Libre | Frontal, neutro | Tres cuartos y espalda sobre neutro | General/preset compatible, default 3:4 |
| SHEIN | Frontal, neutro | Tres cuartos y espalda sobre neutro | General/preset compatible, default 3:4 |

Las restricciones de portada Amazon no se propagan a sus secundarias. Mercado Libre/SHEIN conservan las opciones existentes de apariencia y contexto discreto dentro del fondo neutro. TikTok 1:1 sustituye el default 3:4 solamente en sus tareas de este flujo; la publicación también conserva fotografías históricas 3:4/4:3 compatibles. No se recorta una prenda para imponer el cuadrado.

Superior: muslos hasta encima de la cabeza. Inferior: pecho/cintura hasta debajo de los pies, sin rostro. Completa: cabeza y pies completos. Los accesorios conservan una zona explícita; no se consideran compatibles automáticamente con una base aprobada para otra zona.

Packs/conjuntos se presentan sin modelo según el plan existente. TikTok infantil, prendas infantiles ajustadas/interiores/baño/body y la excepción de bebé de Mercado Libre evitan las bases humanas. El catálogo no ofrece operaciones pagadas de bases para las excepciones sin modelo. Los objetos conservan sus escenas, proveedor y prompts existentes.

## Preparación y aprobación

En `/models/generar` el recorrido obligatorio es **Identidad → Candidatos → Poses**. «Continuar a Poses» guarda y aprueba una sola vez el candidato seleccionado sin salir del wizard. El paso Poses muestra esa identidad, permite seleccionar poses y destinos activos, revisa cantidades/costos y muestra resultados, verificación e incidencias. No hay guardado final opcional de poses libres ni salto automático al catálogo. El nombre, cliente y candidato quedan bloqueados al preparar la identidad; una aprobación fallida puede reintentarse contra el mismo modelo. En el catálogo también se puede elegir una foto existente del propio modelo. La identidad aprobada conserva foto, SHA-256, generación de Storage, rasgos declarados, procedencia real/sintética y autor/fecha de aprobación.

El panel compartido por wizard y catálogo selecciona por defecto los destinos activos del cliente y permite completar un subconjunto, otras zonas o categorías posteriormente. Muestra candidatas, aprobadas, pendientes, faltantes y costo estimado. Generar una toma y completar faltantes requieren confirmación del número de imágenes y estimación; cada llamada genera una sola toma y nunca rehace las bases aprobadas. La solicitud pagada tiene idempotencia por `requestId` y un bloqueo transaccional por combinación/identidad que impide solicitudes simultáneas duplicadas o cobrar otra generación ya aprobada; una interrupción ambigua no inicia otro cobro con la misma clave. Las candidatas que no superan la verificación permanecen disponibles para revisión/reintento.

La selección inicial de poses reúne, sin duplicados, las variaciones guardadas en Reglas Marketplace para los destinos elegidos. Las reglas nuevas empiezan sin variaciones; el operador puede ajustar la selección de cada generación. Los ajustes manuales se conservan mientras no cambien los destinos o las poses configuradas. Las poses mantienen `poseRecipeId` en la especificación de cada foto y aprobación, además de orientación/encuadre/clasificación observados. Una frontal con contrapposto es secundaria, no una portada Amazon. La verificación evalúa también los detalles de la pose concreta (`concretePoseMatches` y evidencia), sin inferir aprobación de su etiqueta. El trigger general evita un segundo análisis cobrado de estas bases y de fotos con `photoObservation`. También omite la identidad aprobada y las candidatas con ruta de etapa `model_generations/{clientId}/{modelId}/identity/{sessionId}/{file}` desde el guardado inicial, antes de aprobar la identidad.

Las combinaciones incompatibles se muestran antes de pagar, con pose, destino y motivo, separadas de la cantidad/costo de las compatibles. Actualmente los retratos y close-ups de calzado no cubren el encuadre completo de las recetas de vestido y se bloquean explícitamente; no se amplía su encuadre ni se sustituye su pose de forma oculta. También se bloquean vistas desactivadas, composiciones sin modelo y excepciones infantiles. Las candidatas y aprobadas guardadas no se borran al cambiar selección. Reintentar pendientes conserva las aprobadas; cada verificación de un archivo existente se aprueba explícitamente para el destino y pose solicitados.

Proveedor: solicitud explícita (incluida la selección realizada en Identidad), preset compatible del cliente, default compartido GPT Image 2.5 Flare. Calidad y formato compatibles del preset se conservan. Las operaciones de generación de prendas nunca generan bases de pago como efecto secundario.

La verificación usa el clasificador existente de Gemini ampliado para comparar la base con la identidad elegida: pose concreta y orientación general, edad/proporciones, zona completa y libre de ocultaciones, encuadre, fondo, rostro/mirada y expresión de portada Amazon. Se mide el archivo real y se exige la proporción planificada. Para blanco puro se comprueba técnicamente un perímetro continuo de tres píxeles y al menos un 15% de píxeles blancos opacos, además de la observación visual del fondo. Es una comprobación conservadora del archivo, no una segmentación perfecta de todo el fondo.

`Model.marketplaceBaseApprovals` almacena la especificación versionada, pose/asset, SHA-256, generación de Storage, SHA de identidad, observación, verificador y autor/fecha. Las etiquetas y las clasificaciones antiguas no acreditan aprobación. Se puede verificar el mismo asset para varios sets compatibles sin duplicar archivos. Una sustitución de foto invalida su aprobación; cambiar rasgos de identidad deja de ofrecer sus aprobaciones hasta confirmar la identidad.

## Wizard, automatización y ejecución

Se conservan los tres pasos del wizard. Ambos recorridos usan `buildMarketplacePhotoPlan`; el wizard y la entrada de automatización permiten seleccionar un subconjunto de canales activos. En API/presets se llama `selectedChannels`; en el estado del wizard, `selectedPhotoChannels`, conservado en su borrador.

El servidor ignora las bases y configuraciones de marketplaces declaradas por el navegador: carga cliente/modelo, pertenencia, estado activo y aprobaciones de servidor. Vuelve a calcular el plan y compara su ID. La automatización conserva sus destinos/recetas de ejecución; vuelve a comprobar las bases actuales y los canales habilitados. Un artículo con una base o evidencia imprescindible faltante conserva sus referencias y queda pendiente, mientras los artículos independientes pueden continuar. No existe fallback a `identityBase`, otra pose o una persona improvisada.

Cada tarea guarda `aspectRatio` e `imageConfig`, y cada job usa esos valores. Un pedido puede contener Amazon 3:4 y TikTok 1:1. Solo se comparten tareas cuando también coinciden base aprobada, composición, evidencias, variante y geometría. Los snapshots de base incluyen únicamente las aprobaciones de sus destinos.

Antes de cada intento el worker revalida modelo/aprobación y generación actual del asset. Las URLs de la base se firman con su generación de Storage. La revisión final comprueba el mismo plan y sus reglas extensas, con validación estructurada por destino; formato, blanco y XMP se comprueban sobre los bytes finales. Los prompts de vestido son breves: reemplazar prenda con fidelidad y conservar persona, pose, mirada, cámara, luz, fondo y encuadre. El prompt predeterminado antiguo se sustituye por ese texto; personalizaciones compatibles se conservan y se muestran los conflictos de composición o prompts excesivos. Las correcciones de reintento no pueden restaurar perfil estricto ni cambiar la base.

## Fronteras y compatibilidad

- Callables: `approveModelIdentity`, `previewModelPhotoSets`, `scheduleModelMarketplaceSets`, `generateModelMarketplaceBase`, `verifyModelMarketplaceBase`; todos administrativos y con acceso al cliente. Planes/prendas: `previewMarketplacePhotoPlan`, `createMarketplacePhotoBatch`.
- Manglar: `models.previewSets`, `models.scheduleSets`, `models.baseStatus`, `models.approveIdentity`, `models.generateBase`, `models.verifyBase`, `wizard.previewMarketplacePlan`, `wizard.createMarketplaceBatch`. Las acciones pagadas usan las autorizaciones y presupuesto de Manglar, también en los jobs creados.
- El endpoint antiguo de lotes de prendas pide usar el plan por marketplace cuando el cliente tiene canales activos. Clientes sin canales y documentos históricos conservan el recorrido anterior.
- Firestore impide que el navegador cree o cambie `approvedIdentity`/`marketplaceBaseApprovals`; los servicios privilegiados son quienes los emiten. Storage permite crear nuevas fotos de modelo, pero impide sobrescribir una existente.
- ZIP de modelos: conserva observaciones, especificaciones y procedencia/aprobaciones. Al importar se reasignan poses y rutas y **todas** las aprobaciones importadas quedan con `requiresReverification`; la identidad original se conserva como `importedIdentity`, pendiente de aprobación local. Ningún ZIP autoacredita compatibilidad. Los bundles anteriores siguen siendo válidos.
- No hay migración, reclasificación masiva, regeneración masiva ni intake nuevo de Drive. Tampoco se borran modelos/resultados antiguos.

## Verificación de la entrega

Pruebas de dominio: combinaciones de canales, igualdad de entradas del wizard, ausencia de fallback, proporciones por tarea, dimensiones de compatibilidad, excepciones sin modelo, evidencia insuficiente, prompts/revisión coherentes y blanco técnico. Integraciones con Firebase local: generación simulada por toma, idempotencia, candidatas fallidas conservadas, aprobación explícita del mismo asset para otro set, recetas congeladas y paridad de automatización, bytes sustituidos, pertenencia, ZIP y reglas de protección. Prueba de interfaz con conectores simulados: selección de formatos, faltantes, aprobación de costo y generación individual, en móvil/escritorio.

Los tests usan proveedores simulados y archivos sintéticos de prueba. No acreditan mejoras visuales en fotografías reales; no se han encargado generaciones pagadas reales para validar calidad.

## Fondo configurado por marketplace y rol

La identidad conserva el fondo elegido en su formulario. Al generar una base, la referencia de identidad solo aporta persona, edad y proporciones: su fondo se ignora y se reemplaza completamente por el resuelto para destino y función (`main`/`alternative`). La configuración prevalece sobre cualquier fondo mencionado por la receta de pose.

`ModelMarketplaceAppearance.background` conserva `client | white | neutral`. Solo `neutral` permite `backgroundTone` opcional: `light_gray` (gris claro), `medium_gray` (gris medio), `warm_beige` (beige cálido), `cool_sand` (arena fría), `off_white` (blanco roto). Sin tono se mantiene neutro genérico; `client` resuelve la receta del cliente o el default histórico del destino/rol. Las etiquetas y textos exactos viven en `shared/src/modelBackgrounds.ts`, usados por generación, verificación y vista previa de Reglas Marketplace. Las tarjetas de Poses muestran el tono esperado.

La especificación/aprobación congela `backgroundTone` cuando existe. Un cambio de tono cambia la especificación incluso sin incrementar revisión; el guardado incrementa únicamente la revisión del destino editado e invalida sus aprobaciones previas. Las reglas, especificaciones y observaciones históricas `white`/`neutral` sin tono siguen siendo válidas. No hay migración ni regeneración automática.

Gemini recibe el fondo esperado y devuelve categoría, tono aproximado (`backgroundTone`), cumplimiento (`backgroundMatches`) y evidencia visible (`backgroundEvidence`). Para un tono específico se exige categoría neutra, tono coincidente, cumplimiento afirmativo y evidencia no vacía. Un blanco cuando se pide gris claro se rechaza como «Fondo requerido: gris claro neutro; observado: blanco». Se toleran sombras e iluminación natural, no otro tono de fondo. El blanco puro conserva la comprobación técnica existente.

Al vestir una base aprobada, su fondo es la única referencia de fondo: se ignoran los fondos de identidad y prendas, y se conserva el tono, escena y sombras de la base. La revisión final recibe la misma definición compartida y exige conservarla. El vestuario de relleno de las bases se describe en «Ropa de relleno y largo de la prenda».

MCP `system.saveModelMarketplaceRule`: `main` y `alternative` admiten el `backgroundTone` opcional anterior exclusivamente con `background: neutral`; conserva `expectedRevision` y la autorización administrativa existente. Contratos generados en `functions/src/manglar/contracts.json`.

La vía recomendada de Manglar para completar seleccionados es `previewSets` → preparar/confirmar `scheduleSets` → `baseStatus`. `generateBase` es una toma suelta. La cola reserva el máximo conservador de generación y verificación para hasta tres intentos por combinación antes de encolar; puede superar la estimación de la UI. `baseStatus` pagina historia y muestra rechazos, errores, costos, aprobaciones y previews privadas de 15 minutos.

## Ropa de relleno y largo de la prenda

Corrección del 20 de noviembre de 2026 (prueba JISHOP, pantalón chino largo JST-H04-AZM generado como short y aprobado por el revisor).

- **Bases:** `MODEL_BASE_FILLER_OUTFIT` sustituye a «T-shirt and shorts». Todas las bases visten un relleno fijo: camiseta lisa ajustada y leggings lisos ajustados hasta el tobillo, de colores neutros. Se eligió un relleno fijo y no el vestuario de la identidad porque este puede ser ancho, corto o con estampados y volvería a condicionar largo y silueta; un relleno ajustado y largo es verificable y deja al generador solo añadir volumen o descubrir piernas. El prompt de base no menciona prendas prohibidas (evita sugerirlas al generador).
- **Verificador de bases:** devuelve `fillerOutfitCompliant`/`fillerOutfitEvidence`. Las verificaciones nuevas exigen `true` (`MODEL_BASE_FILLER_ISSUE` si no). Las aprobaciones anteriores sin el campo siguen siendo válidas; un `false` explícito invalida siempre. No se cambió la versión de especificación, así que no se invalidan aprobaciones existentes.
- **Vestido:** `MODEL_DRESSING_GARMENT_REPLACEMENT` ordena reemplazar por completo la ropa de la base en la zona vendida; tipo, largo, silueta, corte, bajos, color y detalles salen solo de las referencias. Se conservan persona, pose, mirada, cámara, luz, fondo y encuadre.
- **Revisor:** `MODEL_PLAN_IMAGE_ROLES` rotula las imágenes (1 = base: solo persona/pose/cámara/fondo/encuadre, su ropa es relleno; intermedias = prenda vendida, única fuente de largo y silueta; última = resultado) y exige un criterio `garmentLength` contra las referencias.
