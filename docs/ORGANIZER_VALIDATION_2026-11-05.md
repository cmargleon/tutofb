# Validación del Organizador híbrido — 5 de noviembre de 2026

Implementación en el módulo del organizador, contratos compartidos, interfaz y herramientas de Manglar. Se preservaron los cambios locales existentes; no se hizo commit ni push.

## Inventario real

El árbol principal de JISHOP contiene **539 imágenes, 42 subcarpetas y 3 libros**. La carpeta adicional contiene **234 imágenes, 29 subcarpetas y 6 libros**; solo se auditó por lectura. El enlace de `F2` del Excel navideño se conserva como fuente adicional y no amplía automáticamente los orígenes autorizados.

El lector nuevo importa **399 filas y 284 variantes** del árbol principal. Navidad pasa de 72 filas importadas y 16 descartadas a **88 importadas y ninguna descartada**: recupera las continuaciones y los códigos alfabéticos. HOGAR pasa de 173 a 174 filas; las otras pestañas conservan 76, 32 y 29 filas. Cada fila conserva procedencia y valores originales; las inferencias quedan registradas aparte.

## Validación real de Gemini

Modelo: `gemini-3.1-flash-lite`, disponible según la consulta de metadatos de la API y las llamadas completadas. Presupuesto total autorizado: **USD 40**. Consumo acumulado de las iteraciones: **USD 0.226757**, con **USD 0 reservado y USD 0 incierto**. Se registraron **139 llamadas** incluyendo interpretación, análisis, asociaciones y la corrección del contrato estructurado. No se modificaron tarifas. El ledger conserva también una respuesta inicial mal formada cuyo consumo sí quedó confirmado.

La primera iteración reconoció la base A174 pero dejó la variante pendiente porque las evidencias llegaron en prosa. Se reforzó la salida con JSON Schema y se repitió la asociación utilizando la caché de píxeles. La versión final resuelve A174 con evidencia de nombre de catálogo, ruta y observación visual. Los contratos se comprobaron contra la [documentación oficial de salida estructurada](https://ai.google.dev/gemini-api/docs/generate-content/structured-output); las tarifas conservadas están documentadas por [Google](https://ai.google.dev/gemini-api/docs/pricing).

En una muestra de 12 fotografías, la revisión humana contrastó siete resultados con miniaturas, catálogo y el caso aportado por el usuario: **7 correctos, 0 incorrectos y 5 pendientes**. Las cinco pendientes son componentes de cocina sin evidencia suficiente para una asignación comercial inequívoca. Este resultado describe la muestra; no es una estimación de precisión sobre las 539 imágenes.

| Fotografía | Esperado | Resultado | Evaluación |
|---|---|---|---|
| `A091-2.jpg` | A091-PACK6 | A091-PACK6 | correct |
| `7.png` | A147 | A147 | correct |
| `6.png` | A147 | A147 | correct |
| `A159-ROpng` | A159-RO | A159-RO | correct |
| `A021-4.webp` | A021 | A021 | correct |
| `A137 (40).png` | A174 | A174 | correct |
| `A216 Y A217` | A216, A217 | A216, A217 | correct |

La foto compartida mantiene seis relaciones comerciales de los dos productos base y una copia canónica; esas relaciones no aprueban referencias por sí mismas. La aptitud como referencia se decide explícitamente por artículo y después se aprueba por variante.

La segunda pasada real de los mismos píxeles produjo **0 llamadas pagadas adicionales**. Las iteraciones de implementación reutilizaron los píxeles válidos; los cambios de esquema y de caché de interpretación sí requirieron nuevas llamadas de texto.

Registro remoto aislado: `organizerValidations/5RPUrQKfkERh4josuuvX/runs/979cc10c7594d56aadfbf0f81088e89af535e342a1a43cee300c5e5bb4ba4dbc`. La validación real no copió ni movió archivos de Drive y no publicó sus asociaciones en el catálogo del cliente.

## Verificación automatizada

- Build y typecheck de Functions, typecheck de frontend y build de producción.
- `npm test`: **161 pruebas, 154 aprobadas, 7 omitidas por configuración, ningún fallo**.
- Integración explícita con Firestore demo, Drive y Gemini simulados: paginación, copias verificadas, segunda ejecución sin copias ni análisis pagados, pausa/reanudación, cambio de Excel sin reanalizar píxeles, cambio de imagen, caducidad de decisiones, excepciones humanas en grupos, conservación del catálogo ante estructura ilegible, presupuesto, reservas inciertas y límite de llamadas.
- La integración también comprueba asociación compartida, elegibilidad por variante, rechazo de una referencia compartida no elegible e importación al wizard de una referencia compartida aprobada.
- Playwright: configuración, simulación sin gasto, cambio de vistas, búsqueda/selección por nombres, selección compartida y elegibilidad explícita de referencias.

## Despliegue y límites

Se desplegaron correctamente `organizerAction`, `organizerScheduler`, `manglarMcp` y Hosting de `tutofb-260320-1003`. La aplicación está en [Tuto](https://tutofb-260320-1003.web.app/organizador). Se verificó que el HTML publicado coincide con el build final. Hosting corresponde al estado completo del workspace, incluidos los cambios locales previos de frontend. No se cambiaron reglas, índices, dependencias ni secretos.

Los destinos anteriores se conservan y el plan presenta su posible migración; no se ejecuta automáticamente. Los pendientes visuales requieren revisión humana. Las columnas propuestas por IA quedan señaladas para revisión. El límite de 300 llamadas por lote es configurable hasta 1000: un inventario inicial grande puede requerir elevarlo o continuar mediante otro lote autorizado, reutilizando las copias y análisis guardados.
