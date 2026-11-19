# Reglas Marketplace de modelos

`/models/reglas-marketplace` (Modelos → Reglas Marketplace) permite a administradores editar las reglas globales de generación y aprobación de bases humanas. Cada marketplace tiene un borrador independiente y guardado explícito. Esta primera versión incluye proporción, fondo, encuadre y rostro por función (portada/secundarias), mirada, postura frontal, vistas, poses concretas habilitadas y comprobaciones de visibilidad, accesorios y blanco puro.

Las reglas se guardan exclusivamente mediante `saveModelMarketplaceRule` en `system_config/model_marketplace_rules`, mapa `marketplaces`. El contrato y validador son compartidos. Cada destino tiene su revisión y el guardado transaccional compara `expectedRevision`; una edición concurrente no se sobrescribe. Las lecturas de generación y planificación se hacen desde servidor, sin caché y sin aceptar reglas proporcionadas por el navegador.

Sin documento se conserva el comportamiento previo, incluidos presets del cliente y 1:1 para TikTok. La opción de fondo heredado conserva las recetas actuales y excepciones del cliente. Una selección explícita en esta pantalla prevalece para las bases humanas. Los encuadres automáticos siguen la zona de cada pose; ocultar el rostro selecciona parte inferior para evitar requisitos contradictorios.

Cada base nueva o revalidada congela `rulesRevision` y sus criterios en `ModelBaseSpec`. Las aprobaciones de versiones anteriores dejan de coincidir con los requisitos actuales; las imágenes y las aprobaciones históricas se conservan. Una imagen que aún cumpla puede volver a verificarse sin regenerarla. Guardar reglas no inicia generación, verificación ni cobros. Las operaciones pagadas vuelven a comprobar la revisión antes de admitir la generación y al persistir la aprobación.

El wizard principal y la automatización siguen consumiendo bases aprobadas. Sus planificadores usan las mismas reglas para encontrar bases, mantener fondo/formato y comprobar la versión; no se añaden controles a ese wizard. Los lotes ya creados conservan su plan congelado. La revisión final usa los criterios de composición congelados de las bases configuradas, conservando fidelidad e identidad.

Se mantienen las restricciones de categoría/edad y la comparación de identidad aprobada, así como las exclusiones de poses que no cubren la zona de vestido. No se añaden fondos personalizados, iluminación ni excepciones globales por categoría en esta versión.

Las variaciones de reglas nuevas empiezan vacías y pueden guardarse también vacías. Las selecciones ya guardadas se conservan. Generar modelos preselecciona la unión de variaciones guardadas de los marketplaces elegidos, sin duplicados, y actualiza esa propuesta al cambiar destinos o selección de reglas. Los ajustes manuales se conservan mientras no cambie ese contexto, incluso al llegar nuevos resultados del modelo. Ambos selectores usan los mismos chips por grupo, con estado accesible `aria-pressed`.
