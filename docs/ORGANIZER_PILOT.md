# Piloto del organizador de JISHOP

El comando es manual y está limitado al cliente JISHOP y a la carpeta que autoriza su configuración de Manglar. Requiere Node 22, las dependencias instaladas, acceso IAM de operador al proyecto y la identidad de lectura de Drive configurada en el entorno existente de Functions.

```bash
npm --prefix functions run build
npm run organizer:pilot -- --client=jishop --dry-run
```

El modo seco lee el inventario, los Excel y los Google Sheets, calcula asociaciones y muestra los totales. No reserva presupuesto, llama a Gemini ni crea recursos.

El piloto exporta cada Google Sheet a XLSX y busca encabezados SKU o SKC de forma independiente en todas las pestañas. Las pestañas sin encabezados reconocidos aparecen en el informe. Cada fila importada conserva el archivo, la pestaña, el número de fila, la primera columna y los valores de las celdas tal como se muestran. Si dos pestañas registran estados incompatibles para el mismo SKC, la variante queda en revisión.

## Ejecución única

`--execute` usa el token OAuth de escritura entregado en memoria en `ORGANIZER_DRIVE_ACCESS_TOKEN`. La cuenta debe poder copiar las fuentes y escribir en la carpeta de destino. Si se proporciona `--destination-id`, el comando valida la carpeta antes de escribir. La credencial de origen solo solicita el alcance de lectura. No incluyas tokens en comandos que se guarden en el historial.

Para una cuenta conectada por MCP, `--execute --mcp --work-dir=<directorio privado>` genera y guarda `plan.json`. El operador del conector valida el destino y crea la carpeta raíz una sola vez. `copyThroughConnector` en `scripts/organizer/mcp-transport.mjs` aplica el plan mediante un adaptador con `list`, `createFolder`, `copy` y `checkpoint`. Las operaciones se registran en un diario duradero. Ante una escritura incierta, se consulta el destino para reconciliarla antes de decidir si hace falta recuperar el elemento.

Firestore registra de forma atómica el identificador `jishop-drive-organizer-v1` en `organizerPilots`. Una segunda invocación de `--execute` no inicia otra prueba, incluso desde otro equipo. Si la conexión se interrumpe, conserva el plan y el diario. Usa la misma carpeta raíz y reconcilia los elementos de resultado incierto por lectura. Evita borrar el registro de ejecución o iniciar otra estructura.

Con las copias verificadas, coloca el arreglo de recibos en `recibos.json` y ejecuta:

```bash
npm run organizer:pilot -- --client=jishop --finalize --work-dir=<directorio privado>
```

Este paso vuelve a escanear el origen, compara versiones y ubicaciones, y escribe los informes localmente. Para la vía MCP, carga `inventario.json`, `asociaciones.json` e `informe.md` en `04 - REPORTES`. Genera el Excel de control con `export-control.mjs <directorio privado> <node_modules del runtime de artefactos>` e impórtalo a Google Sheets. Aplica los filtros y las reglas de estado de `sheetRequests` sobre los IDs de las pestañas importadas.

## Alcance de las decisiones

Las coincidencias se basan en códigos de los Excel y nombres o rutas inequívocos. Las carpetas de origen llamadas OK no determinan el estado. El hash exacto ayuda a detectar contenido repetido y a evitar análisis redundantes. El piloto conserva las copias y deja las ambigüedades para revisión.

Gemini clasifica fotos de variantes previamente identificadas. Se comprueba el presupuesto de Manglar y se registra una reserva de USD 0,05 por llamada antes de enviarla. Se conservan las reservas incluso si falla una llamada. Los grupos se envían en lotes de hasta cuatro imágenes únicas y se registra cuándo no se pudo evaluar un grupo completo. El costo de la hoja se estima con los tokens devueltos por la API.
