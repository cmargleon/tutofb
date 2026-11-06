# Organizador inteligente de Google Drive

En Tuto, abre **Organizador inteligente** desde el menú. Cada cliente puede configurar varias carpetas de origen y una carpeta contenedora de destino en la misma unidad. Las ejecuciones manuales y automáticas usan el mismo motor. La vigilancia empieza desactivada.

## Configurar un cliente

1. Selecciona el cliente como administrador de Tuto. Agrega los IDs o enlaces de las carpetas de origen y de la carpeta contenedora. El destino administrado se creará durante la primera ejecución de clasificación.
2. Concede a la identidad de Google Workspace configurada en Firebase los permisos de lectura y copia en los orígenes y de creación en la carpeta contenedora. La integración reutiliza `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` y, si corresponde, `GOOGLE_WORKSPACE_USER_EMAIL`. Habilita Drive API y Sheets API en el proyecto de esa identidad. Si hay delegación de dominio, autoriza los ámbitos de Drive de lectura y escritura que usa el servicio.
3. Deja el acceso heredado desactivado para exigir un contenedor privado. Habilítalo expresamente si el destino vive en una unidad compartida o una carpeta con permisos heredados. Las carpetas nuevas heredan el acceso de ese destino.
4. Si quieres delegar acceso, añade los UID de los operadores y revisores autorizados. Las conexiones de Manglar requieren además los permisos OAuth y el acceso al cliente correspondientes.
5. Guarda la configuración y ejecuta **Simular**. Revisa el inventario, el número de variantes y las incidencias. La simulación persiste su resultado en Tuto y consulta Drive en lectura. Para clasificar, confirma el presupuesto del lote. Activa la vigilancia solo cuando el cliente haya autorizado las futuras copias y el presupuesto de los lotes automáticos.

El modelo predeterminado es Gemini 3.1 Flash-Lite estable. [Ficha de la versión Preview retirada](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview)

## Operación en Tuto y Manglar

- El servicio se ejecuta todos los días a las **12:00 y 18:00, hora de Ciudad de México**. Las solicitudes manuales quedan en cola hasta un horario programado. Con vigilancia activa, los cambios detectados se procesan cuando otro chequeo confirma que el inventario sigue estable. Si un lote necesita más tiempo, retoma desde el último punto guardado en un horario posterior.
- **Inventario** y **Simular** leen las fuentes y aplican las reglas deterministas. En el historial se puede consultar el resumen de cualquier ejecución. **Clasificar** y **Sincronizar cambios** aplican el catálogo y copian los archivos nuevos o de versiones nuevas. Un reanálisis dirigido aplica Gemini únicamente a las fotos seleccionadas o a las de la variante indicada.
- En **Productos** se ven los SKC, los SKU, las tallas, los estados documentales y las vistas sugeridas. **Ver celdas** muestra el archivo, la pestaña, la fila, la columna y los valores de origen. Las hojas sin encabezado reconocido y las pestañas vacías aparecen en **Pestañas de origen**.
- En **Fotografías** y **Conflictos**, consulta las evidencias y corrige la asociación buscando por nombre, código, color o capacidad. La selección múltiple representa una foto compartida. Puedes aplicar una decisión a hasta 25 fotos visibles con la misma ruta y candidatos; se conservan las excepciones ya revisadas por una persona. Una selección vacía deja la fotografía pendiente por decisión humana. Las decisiones registran contenido, ruta y catálogo relevante. Un cambio que invalida esa evidencia deja la foto en revisión. La identidad, la calidad de imagen, la aprobación de referencias y la publicación son estados distintos.
- Aprueba las referencias cuando la selección sea válida y usa **Usar en el wizard** para importarlas al lote. Los cambios de contenido invalidan la importación de una versión aprobada. Reabre la revisión para aprobar la nueva versión. La aprobación no crea lotes de fotos.
- En **Sistema → Configuración → Generar fotos después de organizar** se activa o desactiva globalmente el envío a generación. Empieza activado; solo un administrador puede cambiarlo. El servidor consulta el valor vigente antes de cada nuevo envío, sin depender de la caché. Al desactivarlo, las próximas fotos se organizan sin generar; los trabajos ya enviados continúan. Volver a activarlo se aplica a las próximas fotos organizadas, sin generar automáticamente un histórico de fotos omitidas.
- Si ese control está activo, después de organizar las copias, las fotos nuevas o de contenido actualizado pasan a la automatización aunque no tengan coincidencia en el Excel. Se agrupan por variante conocida o por el grupo visual del mismo producto y carpeta; la IA prioriza las mejores vistas. Cada artículo crea un trabajo independiente con el proveedor, preset, modelo y presupuesto de automatización del cliente. Los objetos usan las seis escenas compartidas por defecto. La importación manual al wizard conserva su aprobación separada.
- Una foto con tipo, vista o calidad inciertos queda señalada en **Conflictos** y en el reporte; un reanálisis dirigido permite revisarla. Los contadores muestran artículos enviados y fotos pendientes, y **Ver automatización** permite seguir la generación. Cada versión enviada se registra para impedir duplicados al sincronizar, cambiar el Excel o recuperar una interrupción. No se generan automáticamente fotos antiguas ya inventariadas antes de este cambio. El responsable se conserva al guardar la configuración o iniciar una clasificación manual y sus permisos se vuelven a comprobar antes de enviar. Una configuración anterior sin responsable ni operador requiere volver a guardarse.
- El control del presupuesto usa las tarifas publicadas de los modelos admitidos. Se reserva antes de enviar la llamada, se liquida usando los tokens devueltos y se conserva como incierto el costo máximo cuando falta confirmación de uso. Los umbrales se guardan en la ejecución. El cálculo limita el gasto estimado dentro de Tuto. La factura final depende de Google. [Tarifas de Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- Un lote pausado se reanuda con su presupuesto y sus puntos de control. Un lote que agotó el presupuesto mantiene bloqueado el inicio automático. Autoriza un lote nuevo desde Tuto o Manglar cuando quieras aportar otro presupuesto.

Manglar expone `manglar_organizer_read` y `manglar_organizer_manage` en la conexión individual. Los clientes se enumeran con `clients`, y `config` devuelve el destino, la vigilancia y el presupuesto. Para simular con una sola llamada, usa `start` con `mode: "dry_run"`, `clientId` y un `requestId` estable. Para clasificar, usa `mode: "classify"` y agrega `confirmedBudgetUsd` tras autorización explícita del usuario y `planRunId` de la simulación revisada. La huella de las fuentes debe seguir coincidiendo con ese plan. Reutiliza el identificador si la respuesta se interrumpe. `run`, `ledger`, `files` y `report` consultan estado y resultados. Las lecturas de colecciones devuelven un cursor. Para consultar el catálogo estimado de una simulación, pasa su `runId` a `products`, `photos`, `conflicts` o `tabs`.

## Arquitectura y persistencia

- `organizerAction` es la puerta de entrada de Tuto. Manglar aplica los permisos de la conexión individual y llama al mismo servicio. Firestore se consulta con el SDK de servidor. Las reglas vigentes deniegan el acceso directo del cliente a las colecciones del organizador.
- `organizerScheduler` consulta la API de cambios de Drive y conserva el cursor. Una reconciliación periódica recupera cambios perdidos o cursores inválidos. Dos observaciones consistentes separadas por la ventana configurada permiten encolar el lote. La ejecución vuelve a comprobar la huella del inventario antes de procesar un lote automático. El inventario guarda el cursor de paginación por carpeta y la ejecución guarda la fase y el último archivo procesado. [API de cambios de Drive](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- `organizers/{clientId}` guarda configuración, ejecución activa, vigilancia y destino. Sus subcolecciones guardan manifiestos versionados, archivos de origen, libros importados, pestañas, productos base, variantes visuales, variantes comerciales, fotografías, decisiones y caché visual. Cada `runs/{runId}` conserva inventario, contadores, presupuesto, ledger, reportes y datos de simulación. El catálogo conserva la procedencia de sus filas por variante.
- El motor usa copia nativa y marca recursos administrados con el cliente y una clave de idempotencia. Valida unidad, ascendencia y marcadores antes de escribir. Una copia nativa conserva todas las pestañas del archivo. Para binarios verifica el hash que proporcione Drive, o tamaño y MIME si falta el hash. En archivos de Workspace verifica ID nuevo, tipo, carpeta y marcador. Una respuesta de escritura incierta se reconcilia por marcador en Drive antes de considerar otra operación. Los accesos directos se inventarían y no se siguen.
- El clasificador aplica primero identificadores de catálogo, rutas y grupos inequívocos de fotos hermanas. Los hashes reutilizan análisis de píxeles; no asignan identidad comercial. Gemini interpreta manifiestos por grupos, propone columnas para pestañas desconocidas y analiza vistas y calidad. La asociación recibe observaciones, nombres, rutas, candidatos ordenados por evidencia y celdas relevantes. La aceptación exige además corroboración determinista y una diferencia clara frente a otras candidatas; la confianza numérica por sí sola no basta. Las ambigüedades conservan candidatos y sugerencias para revisión humana. Las sugerencias no crean SKC. Las referencias requieren revisión humana antes de importarse al wizard.
- El reporte por ejecución se guarda en el destino. La hoja de control opcional contiene resumen, productos y fotos con enlaces. La descarga del resumen desde Tuto funciona también para inventarios y simulaciones.

## Validación local

```bash
npm --prefix functions run build
npm run lint
npm test
firebase emulators:exec --only firestore,auth,storage --project demo-tutofb-organizer 'node --import tsx --test tests/organizer.integration.test.ts tests/organizerAutomation.test.ts'
```

La prueba de integración usa un proyecto demo y simula Drive y Gemini. Cubre simulación, copias, paginación, reanudación, reservas concurrentes y recuperación de cambios. El acceso real a las carpetas depende de la identidad de integración y los permisos del cliente.


## Lectura e interpretación híbrida

La versión 3 conserva códigos alfabéticos, las filas de continuación de variantes contiguas y los rangos combinados explícitos. Una fila vacía o una nueva cabecera interrumpen la continuación. No se heredan estados de publicación o subida. Cada inferencia registra campo, fila de origen y motivo; las celdas originales, fórmulas y valores mostrados permanecen separados. Se guardan muestras de todas las pestañas y enlaces de celdas y fórmulas. Los enlaces adicionales no amplían los orígenes: primero deben autorizarse en Clientes y seleccionarse en la configuración existente.

La etapa de texto envía manifiestos compactos en grupos de hasta 20 archivos con un índice global reducido y catálogo pertinente. Los mapeos admiten únicamente campos conocidos y filas presentes en las muestras. Roles, convenciones y relaciones deben citar IDs enviados; las propuestas sin evidencia quedan sin resolver. Las convenciones sugeridas no crean productos ni ejecutan código. Los nombres, documentos e imágenes se tratan como datos.

Las secuencias fotográficas (`A021-4`, `A091-2`) y las extensiones pegadas (`A159-ROpng`) se buscan contra el catálogo existente. Una identidad sugerida por nombre permanece provisional; no se incorpora como SKU confirmado. Capacidad, color, talla y pack se conservan explícitos. La talla puede agrupar variantes comerciales bajo una variante visual; los packs y las capacidades permanecen diferenciados cuando no hay evidencia suficiente para compartir referencias.

`pixelCache` se direcciona por contenido y modelo, sin catálogo ni ruta. `analysisCache` separa interpretación de estructura y asociación. Cambiar un Excel puede invalidar la asociación o una aprobación, pero no el análisis de los mismos píxeles. Las solicitudes repetidas o respuestas inciertas no se reenvían automáticamente dentro de la misma ejecución. El ledger separa consumo confirmado por tokens (campo histórico `estimatedUsd`), reservas y costos inciertos. El límite configurable de llamadas (300 por defecto, máximo 1000), el contexto conservador de 16384 tokens y las salidas de hasta 4096 tokens cubren también escalamiento y reintentos. Un primer inventario grande puede necesitar elevar el límite de llamadas o continuar con otro lote autorizado; los análisis ya confirmados se reutilizan.

## Carpetas y compatibilidad

**Plan de cambios** muestra archivos, acciones y destinos antes de aplicar. Las ejecuciones manuales completas requieren una simulación terminada sin fuentes ilegibles. Una modificación del origen invalida el plan. Las ejecuciones automáticas conservan la autorización existente de vigilancia y persisten su plan antes de copiar.

Las copias nuevas usan `05 - CATALOGO / producto base / variante + identificador estable`. Pendiente, revisar y subido son filtros; no cambian la ubicación del producto. Las imágenes compartidas o sin identificar mantienen una copia canónica en Fuentes y relaciones múltiples en el catálogo. Compartir identidad no convierte automáticamente la imagen en referencia apta para generar. El operador puede marcar explícitamente su aptitud por cada artículo (`referenceVariantIds`); luego la selección visual y la aprobación de referencias siguen siendo independientes para cada variante. Las copias y destinos anteriores a esta versión se mantienen donde están; el plan los marca `retain_legacy` y describe la migración pendiente. No hay migración automática ni borrado de originales.

## Validación real con presupuesto explícito

`validate-hybrid.ts` comprueba el modelo con la API, valida que el manifiesto pertenezca a orígenes autorizados del cliente y registra un ledger aislado en `organizerValidations`. Reutiliza las mismas funciones de interpretación, píxeles y asociación; no modifica Drive ni publica asociaciones del cliente. Usa el mismo manifiesto y presupuesto para reanudar, sin reiniciar su contabilidad:

```bash
node --env-file=functions/.env.tutofb-260320-1003 --import tsx scripts/organizer/validate-hybrid.ts --manifest /ruta/inventario.json --client CLIENT_ID --budget 40 --report /ruta/resultado.json
```

La precisión se mide únicamente sobre casos con verdad visual independiente. Los casos sin etiqueta supervisada se informan como no verificados: más asociaciones no implican más aciertos.
