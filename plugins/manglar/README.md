# Manglar

Plugin privado con conexión OAuth individual a Manglar. Publica 25 herramientas: fotografía automatizada, operaciones por dominio y consultas/gestión del organizador. Incluye configuración y producción por marketplace, identidad y bases de modelos, edición de fotos, fichas maestras, plantillas, exportación y publicación de imágenes. El paquete no contiene secretos.

Servidor: `https://tutofb-260320-1003.web.app/api/manglar/mcp`.

Consulta [instalación, autorización y operación](../../docs/MANGLAR_CHATGPT_PLUGIN.md). La instalación en ChatGPT necesita registrar el servidor en **Plugins → + → Add custom MCP server**, seleccionar OAuth y completar el consentimiento con una cuenta administradora de Manglar.

Tras actualizar el servidor, refresca las herramientas de la conexión existente. Los esquemas 2.1 incluyen `idempotencyKey` y `authorization` en cada rama de acción para conservarlos en clientes que compilan las uniones por separado. La identidad, URL, scopes y permisos de la conexión se mantienen.
