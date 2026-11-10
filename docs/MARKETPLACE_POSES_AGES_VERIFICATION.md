# Ampliación real: edades, poses y pantalones

10 de noviembre de 2026. Cliente `automation-e2e-test`, Firebase real. Esta ronda amplía la prueba inicial de camiseta infantil. [Evidencia por modelo, pose, job, destino y hash](MARKETPLACE_POSES_AGES_VERIFICATION.json).

Se crearon cuatro identidades sintéticas nuevas con edades **declaradas** de 2, 16, 35 y 65 años, dos masculinas y dos femeninas. Cada modelo tiene tres fotografías propias: frente, espalda y perfil lateral, de pie y con cuerpo completo. Son 12 bases nuevas, observadas por Gemini y revisadas visualmente. Una edad exacta de una persona sintética es un atributo solicitado, no una medición biológica verificable de sus píxeles.

Se probaron pantalones opacos azul marino, desde cintura hasta bajos y pies, usando referencias controladas en las tres vistas. Las camisetas y zapatos se declararon como estilismo, no componentes vendidos. Las edades menores pasaron por automatización; los adultos por el callable que usa el wizard.

| Edad declarada | Poses de referencia | Fotos finales aprobadas | Distribución |
| --- | --- | ---: | --- |
| 2 | Frente, espalda, lateral | 7/7 | Portadas con modelo; espalda/lateral con modelo; frente/espalda/lateral planos sin personas para TikTok |
| 16 | Frente, espalda, lateral | 7/7 | Mismo reparto infantil; nunca se trató como adulto en el caso final |
| 35 | Frente, espalda, lateral | 4/4 | Portada blanca compartida Amazon/TikTok, portada contextual Mercado Libre/SHEIN, espalda y lateral compartidos |
| 65 | Frente, espalda, lateral | 4/4 | Mismo reparto adulto, conservando la identidad de la modelo mayor |

**22/22 fotografías finales aprobadas**, con sus validaciones por destino. Las dos automatizaciones finales terminaron `completed`, sin imágenes fallidas. Se inspeccionó un mosaico de las 12 referencias y otro de las 22 salidas, comprobando orientación, prendas completas, bajos visibles y ausencia de personas en las tomas planas de los menores. La espalda con modelo del caso de 2 años se corrigió y volvió a inspeccionar: la primera salida había sido frontal y no se aprobó.

## Fallos encontrados y cambios

- Una base de cuerpo completo requería reencuadre para un pantalón. El fallback de identidad podía elegir la foto frontal también para espalda/lateral. Ahora prioriza la orientación correspondiente; una prueba determinista cubre las tres vistas con zona inferior.
- El análisis visual describió como adulto al modelo solicitado de 16 años. La edad declarada en `Model.identityTraits.age` ahora prevalece en la observación guardada de las bases. Se repitió el caso con público infantil explícito.
- Automatización podía perder vistas cuando la clasificación no reconocía los IDs/vistas de todas las referencias. Se exige confianza suficiente o corrección del operador. `metadata.photoArticles[itemId].referenceViews` asocia nombre de archivo a `front`, `back`, `side` o `detail`; la integración prueba que espalda/lateral comerciales prevalecen sobre una inferencia frontal errónea.
- Se hicieron explícitas las instrucciones de orientación trasera y lateral en los prompts aprobados del plan.
- El proveedor bloqueó una solicitud inicial de ropa ordinaria del adolescente. Se registró la incidencia; una nueva solicitud sencilla del mismo vestuario produjo las tres referencias. También hubo bloqueos de revisión y resultados erróneos en la primera pasada. Se conservaron los intentos y no se forzó ninguna aprobación.

## Resultados en Tuto

Todos los enlaces requieren sesión y pertenecen al cliente de pruebas:

- [2 años, siete fotos](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-28d29cddc0b7e597c7e932aa8a53b9fe8823393f4f7105cd3f14ee5eec943be8).
- [16 años, siete fotos](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-7ea4462d6584ee0c3d4ccfaf63c353962c0c27e2817c3f03a167c8dd4cd9a098).
- [35 años, cuatro fotos](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-ad2c3468ce887b11e9e6909d8a623bbfc9b675c5f7a4794637754352315596eb).
- [65 años, cuatro fotos](https://tutofb-260320-1003.web.app/catalogo?clientId=automation-e2e-test&batchId=photo-3e2c3adb4463b2af7a0c886b422e50945dcc25004c964c53c016b5acb3167a40).

Costo estimado de esta ronda, incluidos preparación de modelos, primeras pasadas, reintentos y Gemini: aproximadamente **USD 1,91**, según los registros de Tuto; no es una factura del proveedor. El JSON conserva el desglose. Se generaron 12 fotos de modelos y 40 salidas de prendas contando intentos; las galerías finales utilizan 22.

## Checks y alcance

`npm test`: **276 aprobadas, 20 omitidas, cero fallos**. Builds de frontend/Functions y typechecks correctos. Integración específica en emuladores correcta, incluida la corrección comercial de vistas. Se desplegaron los callables, las entradas de automatización, la observación de modelos y Hosting afectados por estos ajustes. No se cambiaron dependencias, secretos, reglas ni índices.

Esta ronda cubre cuatro edades declaradas, distintos modelos, tres poses/vistas de pie por modelo y prendas inferiores, además de las camisetas probadas anteriormente. No acredita todas las posturas, anatomías, tejidos, prendas o SKUs reales. Los resultados previos con incidencias siguen registrados. Las plantillas reales del cliente de pruebas continúan pendientes para un Excel real; no se publicaron copias públicas de las muestras.
