# DECISIONS

Registro de decisiones tecnicas importantes del proyecto.

Objetivo:
- documentar decisiones intencionales
- dejar claro el por que, no solo el que
- evitar regresiones por cambios que parecen razonables pero rompen la logica del sistema

Formato:
- ID
- estado
- contexto
- decision
- consecuencias

Estados sugeridos:
- aceptada
- reemplazada
- descartada

## DEC-001: `jobs` representa estado actual y `outputs` representa historial real

Estado:
- aceptada

Contexto:
- un mismo trabajo puede producir varios resultados por regeneraciones o auto-reintentos
- el sistema necesita distinguir entre estado operativo actual y resultados historicos
- analytics de costo no debe perder intentos previos exitosos

Decision:
- `jobs` guarda el estado operativo actual del trabajo
- `jobs/{jobId}/outputs` guarda cada output completado real
- `currentOutput` dentro de `job` apunta al resultado vigente

Consecuencias:
- una regeneracion no borra historial
- el costo debe calcularse sobre `outputs`
- la cola y estado operativo deben calcularse sobre `jobs`
- cambios en este modelo impactan frontend, backend y analytics

## DEC-002: la creacion de lotes genera un `job` por combinacion pose-prenda

Estado:
- aceptada

Contexto:
- el flujo operativo de catalogo necesita trazabilidad por imagen generada
- evaluar y regenerar por lote completo es insuficiente cuando hay fallos parciales

Decision:
- al crear un batch, el backend crea un job por cada combinacion pose-prenda
- si hay experimentos, una misma combinacion puede expandirse a varios brazos

Consecuencias:
- la evaluacion puede hacerse por job
- la regeneracion puede ser puntual o masiva
- los lotes funcionan como agrupadores, no como unidad minima de procesamiento

## DEC-003: el procesamiento real ocurre server-side y se dispara por triggers

Estado:
- aceptada

Contexto:
- el frontend no es confiable para ejecutar procesos largos
- la generacion depende de secrets, tiempos de espera y reintentos
- el sistema debe recuperarse incluso si el usuario cierra la app

Decision:
- el frontend solo crea o reencola jobs
- los triggers de Firestore disparan el worker real en Functions
- el worker reclama jobs por transaccion antes de procesarlos

Consecuencias:
- el procesamiento no depende de la sesion del usuario
- se reduce el riesgo de doble ejecucion
- la logica critica queda centralizada en backend

## DEC-004: la regeneracion conserva la imagen vigente hasta completar la nueva

Estado:
- aceptada

Contexto:
- en operacion real, una regeneracion puede fallar
- perder la imagen vigente por intentar mejorarla degradaria la experiencia operativa

Decision:
- al regenerar, el job conserva su imagen actual hasta que exista un nuevo resultado valido
- el nuevo output solo reemplaza a `currentOutput` cuando ya fue generado y persistido

Consecuencias:
- nunca se pierde el ultimo resultado util por intentar una mejora
- la UI de evaluacion puede seguir mostrando una salida estable
- el historial de outputs gana importancia como fuente de verdad

## DEC-005: Gemini actua como capa de revision automatica, no como fuente unica de verdad visual

Estado:
- aceptada

Contexto:
- la generacion de imagen necesita un filtro automatico de calidad
- una revision demasiado estricta puede bloquear operacion valida
- una revision demasiado permisiva puede dejar pasar resultados malos

Decision:
- Gemini revisa fondo, pose, fidelidad de prenda, logos y cumplimiento general
- su veredicto puede aprobar, rechazar y proponer un prompt revisado
- si se llega al maximo de intentos o la revision falla, el job termina segun reglas del worker

Consecuencias:
- existe auto-mejora del prompt en ciertos casos
- el sistema sigue necesitando evaluacion humana en flujos sensibles
- ajustes al prompt de revision tienen impacto directo en costo y throughput

## DEC-006: analytics operativo y analytics de costo se separan

Estado:
- aceptada

Contexto:
- si se mide todo desde el estado actual de `jobs`, se pierden intentos historicos
- si se mide todo desde `outputs`, se distorsiona la operacion actual de la cola

Decision:
- el estado operativo usa `jobs`
- el costo y outputs completados usan `outputs`
- los triggers de analytics mantienen agregados separados

Consecuencias:
- se evitan dobles conteos por regeneracion
- el dashboard puede distinguir operacion actual vs costo historico
- tocar analytics requiere entender bien ambas semanticas

## DEC-007: las prendas del wizard se suben como drafts antes de crear el batch

Estado:
- aceptada

Contexto:
- un lote puede incluir varias prendas y no todas suben correctamente al primer intento
- el usuario necesita poder reintentar sin volver a cargar todo

Decision:
- el frontend sube prendas a una ruta draft en Storage antes de invocar `createGenerationBatch`
- solo las prendas realmente subidas se usan para construir la solicitud final

Consecuencias:
- el flujo soporta reintentos parciales
- la experiencia del wizard es mas robusta
- hay que limpiar o gestionar drafts correctamente

## DEC-008: permisos principales viven en Firestore y se reflejan en custom claims

Estado:
- aceptada

Contexto:
- la UI necesita reaccionar rapido al rol
- el backend necesita autorizacion confiable
- depender solo de Firestore para cada chequeo complica el control de acceso server-side

Decision:
- `users/{uid}` guarda `role` y `active`
- triggers y callables sincronizan esa informacion hacia custom claims

Consecuencias:
- frontend y backend comparten una fuente consistente de permisos
- cambios en usuarios requieren sincronizacion de claims
- cualquier desalineacion entre documento y claims puede afectar acceso

## DEC-009: `shared/` es el contrato transversal del sistema

Estado:
- aceptada

Contexto:
- frontend y backend comparten entidades, enums y semantica operativa
- duplicar tipos entre capas aumenta errores y deriva

Decision:
- los tipos y ciertas reglas de dominio viven en `shared/src/`
- cambios de contrato deben hacerse ahi primero

Consecuencias:
- un cambio en `shared/` puede romper varias capas al mismo tiempo
- pruebas y compilacion deben correr despues de tocar contratos compartidos
- no deberia modificarse sin revisar impacto transversal

## DEC-010: la salud del sistema incluye proveedores externos y estado interno de la cola

Estado:
- aceptada

Contexto:
- ver solo la salud de OpenAI o fal.ai no basta
- ver solo la cola interna tampoco basta para diagnosticar degradacion

Decision:
- la vista de salud combina checks externos de proveedores con metricas internas de jobs
- el sistema calcula alertas compartidas a partir de ambos tipos de señal

Consecuencias:
- la operacion puede detectar problemas antes de que sean visibles en el dashboard general
- ajustar umbrales de alertas impacta al equipo completo

## DEC-011: un batch puede salir en modo `photos_only` o en modo `spreadsheet`

Estado:
- aceptada

Contexto:
- no todos los clientes necesitan el mismo output final
- algunos flujos solo requieren imagenes aprobadas
- otros necesitan ademas metadata estructurada para marketplace

Decision:
- `Batch` guarda `outputMode`
- si `outputMode == 'spreadsheet'`, el wizard prepara `productDrafts` antes de crear el lote
- al crear el batch, el backend persiste `batches/{batchId}/productDrafts`
- la evaluacion puede editar esos drafts y exportarlos a XLSX mas tarde

Consecuencias:
- `createGenerationBatch` valida template, categoria y drafts cuando corresponde
- el flujo de evaluacion ya no termina en imagenes: tambien puede cerrar un entregable tabular
- cambios en `productDrafts` impactan frontend, Functions, `shared/` y templates XLSX

## DEC-012: la compatibilidad pose-prenda se apoya en clasificacion IA explicita

Estado:
- aceptada

Contexto:
- el wizard ya no trabaja solo con una imagen unica de prenda
- hay prendas con varias fotos y modelos con bibliotecas grandes de poses
- sugerir combinaciones validas con heuristicas blandas genera errores operativos

Decision:
- las fotos multiangulo de prendas se clasifican con Gemini en `front`, `back` o `side` y en `garmentBodyArea`
- las poses se etiquetan en `pose.aiClassification` con orientacion, framing, body focus y vistas utilizables
- la sugerencia automatica de poses usa esas clasificaciones compartidas, no reglas manuales dispersas

Consecuencias:
- el matching pose-prenda vive como contrato transversal en `shared/src/utils/garmentViewMatching.ts`
- una degradacion en tagging de poses o clasificacion de prendas reduce automatizacion pero no bloquea la seleccion manual
- tocar el schema de clasificacion impacta modelos, wizard, tests y prompts de Gemini

## DEC-013: la configuracion operativa compartida vive en `system_config/main`

Estado:
- aceptada

Contexto:
- retries, limites de batch, modelo Gemini y proveedores deshabilitados pueden necesitar ajuste sin redeploy
- parte de esa config debe estar visible para frontend y backend al mismo tiempo

Decision:
- los defaults tecnicos siguen viviendo en params runtime de Functions
- las overrides operativas compartidas viven en Firestore bajo `system_config/main`
- el frontend la escucha en tiempo real y Functions la lee con cache controlado
- solo admins la mutan desde callables y la pagina de configuracion

Consecuencias:
- cambios de config pueden afectar wizard, worker, review y health checks sin tocar codigo
- permisos y saneamiento de esta config son parte critica del sistema
- una nueva feature operativa deberia decidir explicitamente si vive en params, en Firestore o en ambos

## DEC-014: el uso de Gemini se mide como analytics de primer nivel

Estado:
- aceptada

Contexto:
- Gemini ya no se usa solo para auto review
- ahora participa tambien en clasificacion de prendas, tagging de poses y enriquecimiento de drafts
- sin una medicion comun se pierde visibilidad de costo, errores y throughput

Decision:
- cada llamada relevante a `generateContent` persiste un registro en `analytics_gemini_usage`
- los registros distinguen `feature`, `model`, `status`, tokens, costo estimado y contexto operativo
- la UI de analytics consume esa coleccion directamente para breakdowns y tendencias

Consecuencias:
- el costo de Gemini puede analizarse separado del costo de generacion de imagen
- agregar un nuevo uso de Gemini sin instrumentarlo deja metricas incompletas
- cambios en naming de `feature` impactan analytics, filtros e interpretacion historica

## Como mantener este archivo

Agregar una decision cuando:
- cambie una regla importante del dominio
- exista una alternativa razonable y se elija una
- una decision tenga impacto transversal
- un cambio pueda parecer raro sin contexto historico

Actualizar una decision cuando:
- se replace por otra
- cambien sus consecuencias
- la implementacion real ya no coincida con lo documentado
