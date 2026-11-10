# Verificación de fotografías por marketplace

Fecha: 10 de noviembre de 2026. Proyecto real: `tutofb-260320-1003`. Cliente exclusivo de pruebas: `automation-e2e-test` (Manglar Automation E2E). [Evidencia estructurada](MARKETPLACE_PHOTO_VERIFICATION.json).

## Resultado implementado

El wizard y la automatización usan `marketplace-photo-v1`, con servidor como autoridad. Lee los canales existentes del cliente y separa evidencia, reglas, fotos únicas, destinos y validación final. Conserva el recorrido anterior sin canales activos. Incluye correcciones de clasificación, referencias conservadas, frentes blancos/neutros, espaldas/laterales acreditados, packs/flat lay y reutilización de detalles reales. Las asignaciones de MasterProduct gobiernan la portada, variante, orden y URLs del adapter; la galería incompleta queda pendiente.

Las bases registran observación visual y procedencia, separadas de identidad de modelo y receta. Una fotografía que parece blanca no acredita RGB 255. El servidor puede preservar la identidad y adaptar el fondo. En prendas opacas elegibles, la preparación conservadora del fondo se hace antes de revisar el JPEG final, preservando una banda en los bordes y omitiendo los casos ambiguos. El XMP de personas enteramente sintéticas se conserva en los bytes finales, peso y hash. TikTok mantiene 3:4/4:3; SHEIN admite modelos infantiles.

## Uso

1. Habilitar los canales en la pestaña Marketplaces del cliente existente.
2. En Generar Fotos: cliente/referencias → configuración → revisión/generación. El panel muestra atributos corregibles, identidad comercial del producto/variante, fotos únicas, destinos compartidos, referencias ausentes y estimación. Usar la misma identidad comercial cuando el producto se reparta en otros lotes. Los modelos son opcionales para las tareas que los necesitan; los packs no requieren personas.
3. Revisar en Catálogo. Las selecciones por variante/canal/posición se ven en la exportación de marketplaces. Configurar las plantillas reales y autorizar las copias públicas mediante el control existente antes de exportar URLs.
4. En automatización se mantienen HTTP/API, planes, Organizador, leases, presupuestos y reintentos. `metadata.photoArticles[itemId]` permite aportar producto, variante y atributos comerciales/manuales. La autorización previa estima un máximo conservador antes de clasificar; después se congela el plan exacto. Las entradas equivalentes producen las mismas tareas del planificador. Las incidencias no eliminan referencias ni detienen artículos independientes.
5. En el catálogo de modelos, «Verificar bases con Gemini» observa hasta ocho fotografías existentes, sin regeneración masiva.

## Generaciones pagadas reales

Se usaron llamadas a la API de Tuto autenticadas con la sesión administradora proporcionada por el usuario. Se utilizó Flare; no se accedió directamente a fal con credenciales ni se cambiaron secretos. Se crearon dos modelos sintéticos, adulto e infantil, y se generaron 16 salidas de prendas, contando los intentos rechazados: **18 imágenes en total**.

Costo estimado registrado: **USD 0,577684**: prendas 0,515400; modelos 0,018200; Gemini 0,044084. Son estimaciones de Tuto y de uso registrado, no una factura confirmada del proveedor.

| Caso | Fotos únicas finales | Resultado |
| --- | ---: | --- |
| Camiseta adulta gris, recorrido manual | 2 | Contexto compartido válido para Mercado Libre/SHEIN. La primera portada blanca quedó pendiente; no se cambió su aprobación. |
| Infantil y pack, primera automatización | 4 | Detectó fallos reales de flat lay y blanco. Se conservaron resultados utilizables, incidencias y costos. Se probó revisión sin regenerar y corrección manual. |
| Pack final de dos camisetas | 1 | Una sola fotografía apta para Amazon, Mercado Libre, TikTok y SHEIN. Corrección conservadora de 1.798.245 píxeles del fondo; revisión posterior del JPEG. |
| Infantil final, automatización | 3 | **3/3 completadas**: modelo frontal blanco para Amazon; flat lay sin personas para TikTok; modelo en contexto compartido para Mercado Libre/SHEIN. Identidad infantil conservada. |

Las imágenes finales observadas conservan 3:4, JPEG sRGB con ICC y 1440×1920 px. El JSON registra tamaños, hashes, XMP, asignaciones y costos por job. Se inspeccionaron visualmente los modelos, el pack final, el flat lay infantil y la portada infantil con modelo. Los dos modelos nuevos cumplen la observación de frontal/de pie/encuadre superior, pero su fondo original mide RGB 253–255; quedan registrados como identidades reutilizables, sin afirmar que sus originales ya sean bases de blanco puro.

Se comprobó que repetir la creación manual o ejecutar otra vez el mismo plan devuelve el lote/pedido existente. No se generaron galerías independientes por canal.

Enlaces privados, requieren sesión de Tuto:

- [Pack final compartido entre cuatro canales](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-389c274211829a77d5729064e6e58921b073e403e75fe419f29aa3343972f971).
- [Infantil final: Amazon, TikTok y contexto compartido](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-483843972e8764dc905e99b872954d0a916e4a251f12e5cc0769ec3005ea7a3d).
- Automatización infantil final: `Q1R4jPlYqymv3VwePlT2`.
- Modelos: `t7BhNPM28IyL6Cw3Sr6n` y `A4Xtjjbl0c7xRDJPbNjy`.

## Comprobaciones y despliegue

- `npm run lint`, `npm --prefix functions run lint`, `npm --prefix functions run build` y `npm run build`: correctos.
- `npm test`: 294 casos, **274 aprobados, 20 omitidos, 0 fallos**. Las omisiones corresponden a suites que requieren emuladores.
- `marketplacePhotoPlan.test.ts`: **17 aprobados**. Incluye combinaciones de canales, ausencia de canales, niños, packs, interior/baño/transparencia, incertidumbre, correcciones, variantes, deduplicación, bases, paridad, reintentos, XMP real, proporciones y asignación del adapter/SHEIN.
- Emuladores Auth/Firestore/Storage, proyecto demo: `marketplacePhotoPlan.integration`, `automation.integration`, `automationAdvanced.integration`, `commercialPhoto.integration` y `marketplaceImages.integration`: **87 aprobados, 0 omitidos, 0 fallos**. Tras el ajuste final de autorización para objetos con marketplaces, se repitió la integración específica correctamente, incluida la exigencia de `authorizeClassification` antes del gasto.
- `npm run test:emulators`: la guarda existente exige Node 22; el host tiene Node 25.8.1 y el comando se detuvo antes de ejecutar la suite completa. No se alteró ni se eludió esa guarda ni se instaló otro runtime. Las suites seleccionadas anteriores se ejecutaron directamente con emuladores locales y proveedores simulados.
- Smoke test del wizard con Firebase real: detección de una camiseta, panel con dos fotos compartidas para cuatro canales, avance por los tres pasos, proveedor Flare y encuadre 3:4. La creación pagada manual se verificó por el mismo callable que utiliza ese formulario.
- `npm --prefix functions run deploy`: correcto. Se desplegaron los nuevos callables y las integraciones de clasificación, worker, automatización, modelos y exportación. Se hicieron despliegues focalizados posteriores para los ajustes comprobados con las generaciones reales.
- `firebase deploy --only hosting`: correcto; frontend actualizado en [Tuto](https://tutofb-260320-1003.web.app).
- No se modificaron reglas, índices, secretos, dependencias ni lockfiles. No se hizo commit ni push.

## Límites pendientes y resultados conservados

- El cliente de pruebas no tiene plantillas de marketplaces configuradas. La vista previa real devuelve `template` pendiente; no se inventó una plantilla ni se dio por entregado un Excel real. La exportación de libros y la autorización de copias públicas se probaron con emuladores. No se publicaron copias públicas reales de estas muestras.
- La corrección de fondo no es segmentación universal: los productos claros, transparencias y casos ambiguos requieren referencias/bases adecuadas y revisión. Las esquinas blancas y la revisión visual no prueban matemáticamente cada píxel del fondo.
- Los resultados iniciales rechazados siguen visibles con sus destinos pendientes. Las muestras posteriores tienen planes independientes e inmutables; no se reescribieron aprobaciones para simular éxito.
- Las referencias iniciales fueron muestras sintéticas controladas. La calidad para ropa interior, transparencias, variantes complejas, espalda y lateral está cubierta por pruebas deterministas; no se ejecutaron generaciones pagadas de todas esas categorías.
- No se añadió un watcher de Drive ni publicación directa a marketplaces. La habilitación administrativa de un canal sigue sin autenticar una cuenta de vendedor.

## Ampliación posterior

La [ronda adicional de edades, poses y pantalones](MARKETPLACE_POSES_AGES_VERIFICATION.md) añade cuatro modelos y 22 fotografías finales aprobadas. Documenta fallos encontrados, correcciones y resultados, y amplía el alcance limitado de esta primera ronda.
