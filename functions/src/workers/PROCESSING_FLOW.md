# Processing Flow

1. `createGenerationBatch` valida cliente, modelo, poses, prendas, provider, aspect ratio y `backgroundConfig`.
2. La callable crea un `batch` y un `job` por combinación pose-prenda.
3. `processJobOnCreate` o `processJobOnRequeue` intenta reclamar el job por transacción.
4. El worker marca el job en `processing`, genera signed URLs para pose y prenda y llama al provider real.
5. El resultado se guarda en Storage bajo `generated/{clientId}/{batchId}/{jobId}/...`.
6. Se crea un documento en `jobs/{jobId}/outputs/{outputId}` con costo, duración, metadata del provider y veredicto de autoevaluación.
7. El mismo worker envía pose, prenda y resultado a Gemini para validar fondo, pose, fidelidad de prenda, logos y cumplimiento general.
8. Si Gemini aprueba, `currentOutput` se actualiza al resultado vigente, el output anterior deja de ser `isCurrent` y el job pasa a `completed`.
9. Si Gemini rechaza y todavía no llegó al tope, el job vuelve a `pending` con un prompt refinado por Gemini para un nuevo intento.
10. Si Gemini rechaza el último intento o la validación falla, el job queda en `failed`, pero la imagen generada sigue guardada en `outputs`.
11. Si falla el provider antes de generar imagen, el worker registra `job_logs`, incrementa `retryCount` y reencola o falla según `maxRetries`.
12. `requeueExpiredJobsOnSchedule` detecta jobs atascados por timeout/claim vencido y los recupera.

Semántica:
- `jobs` = estado operativo actual
- `outputs` = historial de outputs reales completados
- `outputs` conserva todos los intentos generados del job actual para poder mostrarlos en evaluación
- analytics de costo = suma de outputs
- analytics operativo = estado actual de jobs
