# Comprobación independiente de Manglar MCP

Fecha: 3 de noviembre de 2026. Alcance: contrastar la especificación aportada con el árbol de trabajo actual, los contratos, las pruebas y el servidor publicado. No se implementaron correcciones ni se desplegaron cambios durante esta auditoría.

## Dictamen

La ampliación existe y tiene una cobertura amplia: **23 herramientas y 97 operaciones** registradas en código. El servidor publicado anuncia Manglar 2.0.0 y las 23 herramientas, conserva la URL y publica los metadatos OAuth/PKCE. Sin embargo, **no se puede aceptar como completamente terminada**: hay dos defectos de datos reproducidos en emuladores, una incoherencia entre previsualización y requisitos de ejecución MCP, y falta validar la conexión delegada desde una segunda cuenta real de ChatGPT.

Corrección posterior de la auditoría: la comparación original de prompts invocó directamente `createGenerationBatchCore`, saltándose la validación de la entrada pública. No demuestra que el wizard ni `wizard.createGarment` sustituyan silenciosamente un prompt aprobado. La entrada pública exige `approved-try-on-v1` y rechaza peticiones sin ese formato. El hallazgo 3 se acota a continuación.

La conexión de Manglar disponible en este chat expone solamente las siete herramientas históricas. Su llamada real a `manglar_capabilities` funcionó, pero devolvió la respuesta histórica, sin `identity` ni `discoveryTool`. Esto coincide con el camino de compatibilidad de la identidad técnica; esta conexión no acredita el uso de las nuevas operaciones ni la identidad individual. El propio registro `MANGLAR_V2_VERIFICATION.json` conserva `nativeChatGPTLinkCompleted: false` y `delegatedSecondChatGPTAccountVerified: false`.

## Defectos comprobados

### 1. P1 — Borrado de una referencia que ya utiliza un modelo

- Código: `functions/src/manglar/files.ts:41`, especialmente las comprobaciones de referencias en las líneas 45–54; `functions/src/manglar/catalogService.ts:51` y `:57`.
- Reproducción: cargar una imagen en `garments/drafts/{uid}/...`, crear un modelo con `models.save` usando esa ruta y confirmar `files.discard` sobre la misma imagen, antes de generar jobs.
- Resultado: el archivo desaparece de Storage, mientras `models/{id}.poses[0].storagePath` sigue apuntando a él.
- Causa: el guardado permite mantener una pose en la ruta del draft; el borrado solo busca referencias en jobs y no comprueba los modelos.
- Impacto: una operación presentada como eliminación de temporal deja un modelo con una fotografía rota. La confirmación exacta del borrado no comunica ni evita ese efecto sobre el modelo.
- Corrección necesaria: conservar las poses como recursos persistentes o impedir el descarte de archivos referenciados por modelos, además de los controles existentes sobre jobs.

### 2. P2 — No se pueden borrar los rasgos de identidad de un modelo

- Código: `functions/src/manglar/catalogService.ts:71`.
- Reproducción: partir de un modelo con rasgos y guardar `identityTraits: null` mediante `models.save`.
- Resultado: la operación termina correctamente, pero conserva los rasgos anteriores.
- Causa: `input.identityTraits ?? model?.identityTraits ?? null` interpreta el `null` explícito como ausencia del campo.
- Impacto sobre la interfaz: `src/features/models/hooks/useModelLibrary.ts:347` normaliza un formulario vacío a `null`; `src/features/models/firebase.ts` usa el mismo servicio. Vaciar todos los rasgos y guardar tampoco elimina los valores existentes desde la interfaz.
- Corrección necesaria: distinguir entre un campo omitido y un `null` explícito.

### 3. P2 — La vista previa MCP admite una petición que la entrada de generación rechaza

- Código: `functions/src/manglar/wizard.ts:90`; comparación con `functions/src/callables/createGenerationBatch.helpers.ts:458` y `shared/src/domain.ts:348`.
- Condición reproducida: petición aceptada por la previsualización y por el núcleo interno, sin `approvedPrompts`/`promptFormat`, con instrucciones globales personalizadas de identidad y etiquetas internas. La entrada pública de generación no acepta esa petición.
- Reproducción: ejecutar `wizard.previewGarment` y crear el lote mediante `createGenerationBatchCore` con la misma petición, sin ejecutar ningún worker ni proveedor.
- Resultado de la comparación interna: la vista previa devolvió un prompt de 163 caracteres y la llamada directa al núcleo guardó otro de 1621 caracteres. Las cadenas son distintas, pero la prueba se saltó la protección de la entrada pública y no acredita un cambio silencioso en el flujo real del wizard o MCP.
- Causa: la previsualización compone bloques mediante `seedTryOnPrompt`/`composeApprovedTryOnPrompt`; la ruta de generación sin prompt aprobado usa `buildFinalGenerationPrompt`.
- Recorrido real: el frontend envía el texto completo en `approvedPrompts`; `createGenerationBatch` exige `approved-try-on-v1`; `buildJobDraft` conserva el texto aprobado. `wizard.createGarment` llama a esa entrada protegida. La automatización utiliza separadamente el núcleo interno y su composición automática.
- Hallazgo acotado: `wizard.previewGarment` y su contrato permiten omitir el formato aprobado y devolver una vista previa, mientras ejecutar la misma petición mediante `wizard.createGarment` la rechaza. Es necesario alinear/documentar esos requisitos o devolver una petición aprobada lista para ejecutar. No se presenta como un defecto demostrado de sustitución del prompt del frontend.
- Pendiente independiente: comprobar la cobertura de todos los bloques editables en la composición automática respecto del comportamiento solicitado por el usuario; esta comparación aislada no acredita esa cobertura completa.

## Cobertura contrastada por área

“Implementada” indica que hay operaciones concretas y handlers/servicios identificados; no significa que todas se hayan ejecutado individualmente desde ChatGPT o con proveedores reales.

| Área solicitada | Evidencia principal | Resultado |
|---|---|---|
| A. Dashboard y estado | `dashboard.summary/activity`, `system.health`, `analytics.query`, consultas paginadas | Implementada; los filtros y agregados tienen límites explícitos |
| B. Clientes | `clients.list/get/save/archive/restore/delete/automation`, operaciones de plantillas y categorías | Implementada; servicios compartidos con frontend |
| C. Modelos y poses | `models.save/generate/classify/replacePose/import/export`, lecturas visuales y archivo/restauración | Parcialmente correcta: defectos 1 y 2 |
| D. Wizard manual | drafts, clasificación/corrección, defaults, previews y creación por los handlers existentes | Implementado; incoherencia de requisitos entre preview MCP y ejecución. El texto explícitamente aprobado se conserva |
| E. Automatización | siete herramientas históricas, historial/estado, preparación/ejecución, retry/resume y descarga | Implementada; integraciones con proveedores simulados aprobadas |
| F. Cola, catálogo y revisión | consultas, outputs/logs, selección, marca manual, regeneración, revisión, cancelación y descargas | Implementada; no existe en Tuto una aprobación manual que sustituya Gemini |
| G. Configuración | configuración global, alertas, salud, reconstrucción de analytics y encolado de mantenimiento | Implementada; el backfill solo encola y no tiene consumidor en este repo |
| H. Finanzas y analytics | dashboard financiero, eventos, precios, ajustes, snapshots y datasets | Implementada; distingue estimaciones de importes confirmados no disponibles |
| I. Usuarios y permisos | CRUD administrativo, roles, activación/archivo, conexiones y acceso individual | Implementada y probada en emuladores; pendiente validación delegada externa |
| J. Archivos y operaciones secundarias | políticas de subida, Drive, miniaturas, ZIP, XLSX, bundles | Implementada con defecto 1 y transferencia local condicionada al cliente HTTP |

El detalle de nombres, contratos, roles y servicios está en `MANGLAR_TOOL_INVENTORY.md`, respaldado por `functions/src/manglar/registry.ts` y `operations.ts`. La matriz existente `MANGLAR_COVERAGE.md` debe leerse junto con estos hallazgos: sus etiquetas “implementado” no acreditan ausencia de defectos.

## Arquitectura, seguridad y compatibilidad

- El registro adapta handlers existentes mediante `.run` y servicios compartidos; no ofrece ejecución arbitraria ni escritura libre en Firestore.
- Las nuevas concesiones OAuth contienen UID, rol, versión de acceso y restricciones por cliente. Los controles revisan el estado activo, el rol y el alcance; los operadores no heredan producciones ajenas. Se probaron denegaciones, revocación, expiración, refresh y replay en emuladores.
- Confirmaciones, hash de argumentos, versiones de recursos e idempotencia están implementados. Las operaciones pagadas requieren presupuesto explícito y usan reservas transaccionales.
- Las reservas son estimaciones conservadoras, no una garantía contractual del importe facturado por proveedores. Los costos no disponibles se declaran como tales.
- Las conexiones históricas permanecen en el camino técnico limitado a las siete herramientas originales; no se convierten silenciosamente en administradores.
- Las imágenes tienen referencias persistentes y URLs temporales; las miniaturas devuelven contenido visual MCP. La carga de archivos locales requiere un cliente capaz de realizar el POST firmado o el flujo alternativo de Drive/Tuto. No se comprobó una transferencia binaria desde un cliente ChatGPT real.

## Comprobaciones ejecutadas en esta auditoría

Recomprobación específica posterior de los hallazgos 1 y 2: ambos se reprodujeron nuevamente sobre código recién compilado, pasando peticiones `tools/call` por `manglarMcpHandler`, con identidad OAuth individual emulada, verificación del token, roles, contratos y autorizaciones exactas mediante `manglar_prepare_action`. El modelo y sus rasgos iniciales también se crearon mediante MCP. No se llamaron directamente funciones internas de negocio para realizar esas mutaciones. La petición anónima de control devolvió 401. La ejecución finalizó con código 0 y cero llamadas a proveedores. Esta prueba del handler en emuladores no es una conexión de un cliente ChatGPT real ni una reproducción sobre producción.

Evidencia de la recomprobación: `/tmp/manglar-two-bugs-recheck.cjs` y `/tmp/manglar-two-bugs-recheck.log`.

| Comprobación | Resultado |
|---|---|
| `npm run lint` | Aprobada |
| `npm --prefix functions run lint` | Aprobada |
| `npm run build` | Aprobada |
| Build Functions mediante `npm test` | Aprobada |
| `node scripts/generate-manglar-schemas.mjs --check` | Aprobada; 66 esquemas |
| `npm test`, sin emuladores | 125 aprobadas, 4 omitidas, cero fallos |
| Suite completa con Auth/Firestore/Storage emulados y proyecto documentado | 187 aprobadas, cero omitidas y cero fallos |
| Playwright: `manglar-connect`, `wizard-products`, `manglar-services` | 12 aprobadas; servicios externos bloqueados por los specs |
| Reproducciones independientes de los hallazgos | Dos defectos de datos confirmados; comparación interna de prompts con alcance corregido en el hallazgo 3; sin llamadas a proveedores |
| Producción: metadatos, initialize y tools/list | HTTP 200; versión 2.0.0 y 23 herramientas |
| Producción: llamada anónima a capabilities | HTTP 401 |
| Conexión nativa disponible: capabilities | Respuesta correcta del camino histórico |
| `gcloud functions describe manglarMcp` | `ACTIVE`; actualización `2026-11-03T14:48:29.585877142Z` |

La primera ejecución de emuladores usó otro ID de proyecto y falló en una fixture de Auth que fija `demo-manglar-automation` en código. La repetición con el proyecto documentado obtuvo las 187 aprobadas. Los intentos iniciales de las reproducciones también requirieron completar la configuración y los datos de las fixtures; solo se enumeran como defectos los resultados finales reproducidos correctamente.

Las 187 pruebas no equivalen a ejecutar cada una de las 97 operaciones. Playwright cubre consentimiento, wizard y adaptadores seleccionados, no toda la aplicación de extremo a extremo con Firebase real. No se hicieron generaciones pagadas, cambios destructivos sobre datos reales, modificaciones de permisos en producción ni despliegues.

Evidencia local de esta sesión:

- `/tmp/manglar-audit-tests.log`
- `/tmp/manglar-audit-emulators-correct-project.log` — resultado de la suite en su etapa de tests; el comando combinado posterior incluyó un intento inicial de las reproducciones con una fixture incompleta.
- `/tmp/manglar-audit-playwright.log`
- `/tmp/manglar-audit-probes.cjs`
- `/tmp/manglar-audit-probes.log` — ejecución final de las tres comprobaciones, finalizada con código 0. Su indicador `bugConfirmed` para prompts expresa desigualdad entre textos internos; no prueba sustitución en el flujo público, como se corrige en el hallazgo 3.

## Pendiente para aceptar la entrega completa

1. Corregir los dos defectos de datos y alinear los requisitos de previsualización/ejecución MCP; cubrir los recorridos públicos reales con pruebas de regresión.
2. Actualizar/refrescar la integración existente y obtener una concesión individual nueva para comprobar las nuevas herramientas desde el cliente real.
3. Validar la segunda cuenta de ChatGPT con el usuario de Tuto correspondiente: identidad propia, clientes asignados, acceso permitido, denegación de recursos ajenos y revocación independiente.
4. Mantener explícitas las limitaciones de transferencia de archivos y de backfill, y ajustar la documentación a los resultados de las correcciones.

La única incorporación al repositorio durante esta auditoría es este informe. Los cambios de implementación que ya estaban en el árbol de trabajo no se alteraron.
