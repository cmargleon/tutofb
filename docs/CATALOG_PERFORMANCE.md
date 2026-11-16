# Rendimiento de lotes en Catálogo

El catálogo general conserva su paginación. Al abrir un lote, una suscripción por cliente y lote entrega los trabajos pendientes, en proceso, terminados y fallidos. Se usan los índices existentes. El mismo snapshot alimenta la transición de un trabajo entre estados y los datos completos alimentan la agrupación, los contadores, las descargas de artículo y la navegación de revisión. Los enlaces, el historial de cada trabajo y las acciones de exportación conservan su alcance.

Las galerías de cada artículo se montan a 300 px del área de desplazamiento, o al enfocar sus controles. Las celdas reservan el espacio de la cuadrícula antes de cargar las miniaturas mediante el resolvedor central. Una galería visitada queda montada para conservar el estado de sus controles al volver a ella. Si se recorre todo el lote, se terminarán montando todas las galerías abiertas. El snapshot inicial de metadatos y el trabajo de agrupación siguen creciendo con el lote. Dividir esos metadatos entre páginas complicaría la agrupación y la revisión completa. Se difirió el trabajo visual, que fue el coste dominante en la prueba.

## Medición local

Ejecutar `node scripts/catalog-performance.mjs` con Chromium de Playwright instalado. Para repetir la línea base, ejecutar el mismo script en una copia del árbol anterior al cambio. La comparación se hizo el 16 de noviembre de 2026 en macOS 26.5, Apple M5 arm64, Node 25.8.1 y Chromium headless 145.0.7632.6, a 1440 × 1000 con CPU ralentizada 4× por CDP. Vite sirvió la aplicación en modo desarrollo con React Strict Mode. Se tomó la mediana de cinco contextos nuevos por tamaño tras una ejecución de calentamiento. El navegador de pruebas bloqueó tráfico externo.

El doble de Firestore entregó lotes completamente terminados de 120, 600 y 1.200 trabajos, con seis poses por artículo y una miniatura distinta por pose. El doble de Storage entregó una imagen SVG de unos 16 KiB tras 25 ms por petición y se mantuvo la cola real del resolvedor. La ventana inicial fue de 2 s desde la primera entrega de trabajos. La primera galería se cronometró en el primer frame con tarjetas en el DOM y la primera imagen mediante su evento `load`.

| Mediana, antes → después | 120 trabajos | 600 trabajos | 1.200 trabajos |
| --- | ---: | ---: | ---: |
| Snapshots iniciales de trabajos | 2 → 1 | 2 → 1 | 2 → 1 |
| Documentos entregados al cliente | 240 → 120 | 1.200 → 600 | 2.400 → 1.200 |
| Primera galería (ms) | 356 → 225 | 666 → 401 | 914 → 544 |
| Primera imagen (ms) | 587 → 288 | 1.146 → 468 | Fuera de ventana → 622 |
| Tarjetas montadas en el primer frame | 120 → 18 | 600 → 18 | 1.200 → 18 |
| Rutas distintas pedidas al resolvedor | 120 → 18 | 600 → 18 | 1.200 → 18 |
| Descargas de miniaturas terminadas en 2 s | 120 → 18 | 52 → 18 | 20 → 18 |
| Tarea más larga del hilo principal (ms) | 354 → 101 | 617 → 253 | 872 → 370 |

Construir y entregar los snapshots en el doble tomó como máximo 0,8 ms de mediana. Los conteos aíslan el volumen y duplicación de las suscripciones. La latencia de red, la facturación de Firestore, el coste de decodificar fotografías de producción y los tiempos de un build de producción requieren mediciones en su propio entorno. El estado de revisión se verifica aparte con navegación en Chromium, inserciones en vivo, selección desde el historial, descarga ZIP y cambios de lote.
