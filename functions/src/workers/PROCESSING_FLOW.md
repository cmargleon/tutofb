# Processing Flow

1. `createGenerationBatch` valida cliente, modelo, poses, prendas, provider y aspect ratio.
2. La callable crea un `batch` y un `job` por combinación pose-prenda.
3. `processJobOnCreate`, `processJobOnRequeue` o `processJobOnActivation` despierta el worker según sea alta, requeue explícito o retry diferido/reactivación por scheduler.
4. El worker marca el job en `processing`, genera signed URLs para pose y prenda y llama al provider real.
5. El resultado se guarda en Storage bajo `generated/{clientId}/{batchId}/{jobId}/...`.
6. Se crea un documento en `jobs/{jobId}/outputs/{outputId}` con costo, duración, metadata del provider y veredicto de autoevaluación.
7. El mismo worker envía pose, prenda y resultado a Gemini para validar fondo, pose, fidelidad de prenda, logos y cumplimiento general.
8. Si Gemini aprueba, `currentOutput` se actualiza al resultado vigente, el output anterior deja de ser `isCurrent` y el job pasa a `completed`.
9. Si el job pertenece a un batch con spreadsheet, `onJobCompletedSquareCrop` sincroniza el square crop del output efectivo hacia `productDrafts`.
10. Si Gemini rechaza y todavía no llegó al tope, el job vuelve a `pending` con un prompt refinado por Gemini para un nuevo intento.
11. Si Gemini rechaza el último intento o la validación falla, el job queda en `failed`, pero la imagen generada sigue guardada en `outputs`.
12. Si falla el provider antes de generar imagen, el worker registra `job_logs`, incrementa `retryCount` y reencola o falla según `maxRetries`.
13. `requeueExpiredJobsOnSchedule` detecta jobs atascados por timeout/claim vencido y los recupera o reactiva para que `processJobOnActivation` los procese en una instancia separada.

Semántica:
- `jobs` = estado operativo actual
- `outputs` = historial de outputs reales completados
- `outputs` conserva todos los intentos generados del job actual para poder mostrarlos en evaluación
- analytics de costo = suma de outputs
- analytics operativo = estado actual de jobs
