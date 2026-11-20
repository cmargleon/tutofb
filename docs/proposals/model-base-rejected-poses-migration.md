# Propuesta opcional: desactivar intentos históricos rechazados

No se ha ejecutado ninguna migración. Requiere autorización explícita del usuario.

Alcance inicial sugerido: solo el modelo JISHOP `f086c3de-c0a3-4e91-b34c-f7897e088252`.

1. Ejecutar primero una lectura de `models/{modelId}`, `marketplaceBaseApprovals` y `baseOperations`. Producir un informe con poseId, Storage path, operación/intento, costo y motivo; sin escrituras.
2. Seleccionar únicamente poses con un intento cuya verificación sea `approved: false` o tenga `error`, que estén activas y no tengan ninguna aprobación actual para ningún canal. Excluir siempre la identidad aprobada. No inferir rechazo simplemente por ausencia de aprobación.
3. Tras revisar el informe y recibir autorización, guardar una copia de los valores previos y actualizar únicamente `poses[].active = false` de las candidatas mediante transacción por modelo. Releer aprobaciones, identidad e intentos dentro de la transacción; abortar si cambiaron desde el informe aprobado.
4. Conservar íntegros imágenes, Storage paths, `baseOperations`, costos, verificaciones y motivos. Mantener `poseCount`, que cuenta imágenes guardadas, no poses activas.
5. Verificar por lectura que las poses afectadas estén inactivas y que las aprobadas/identidad permanezcan sin cambios. La operación debe ser idempotente.

Rollback: restaurar solo los valores de `active` guardados, previa comprobación de que no hubo cambios posteriores. No restaurar el documento completo sobre ediciones concurrentes.

Hasta autorizar esta migración, los valores históricos de `active` permanecen intactos. El catálogo separa visualmente los rechazos a partir de su historial; los consumidores antiguos que solo filtran `active` todavía pueden incluir esos registros históricos.
