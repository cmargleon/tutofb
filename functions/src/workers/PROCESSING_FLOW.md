# Processing Flow

1. `createGenerationBatch` valida cliente, modelo, poses, prendas, provider, aspect ratio y `backgroundConfig`.
2. La callable crea un `batch` y un `job` por combinación pose-prenda.
3. `processJobOnCreate` o `processJobOnRequeue` intenta reclamar el job por transacción.
4. El worker marca el job en `processing`, genera signed URLs para pose y prenda y llama al provider real.
5. El resultado se guarda en Storage bajo `generated/{clientId}/{batchId}/{jobId}/...`.
6. Se crea un documento en `jobs/{jobId}/outputs/{outputId}` con costo, duración y metadata de provider.
7. `currentOutput` se actualiza al resultado vigente y el output anterior deja de ser `isCurrent`.
8. Si el archivo anterior seguía vivo en Storage, se elimina en cleanup best-effort.
9. Si falla el provider, el worker registra `job_logs`, incrementa `retryCount` y reencola o falla según `maxRetries`.
10. `requeueExpiredJobsOnSchedule` detecta jobs atascados por timeout/claim vencido y los recupera.

Semántica:
- `jobs` = estado operativo actual
- `outputs` = historial de outputs reales completados
- analytics de costo = suma de outputs
- analytics operativo = estado actual de jobs
