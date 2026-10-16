# Precios de generación

Verificados el 16 de octubre de 2026. Moneda: USD. La fuente del cálculo para interfaz y Functions es `shared/src/constants/providerCosts.ts`.

| Modelo activo | Precio de generación |
| --- | --- |
| Seedream 4.5 | US$0.04/imagen |
| Nano Banana Pro | US$0.15 en 1K/2K; US$0.30 en 4K |
| Nano Banana 2 | US$0.06 en 0.5K; US$0.08 en 1K; US$0.12 en 2K; US$0.16 en 4K |
| Seedream 5 Lite | US$0.035/imagen |
| GPT Image 2 | Ejemplos publicados: US$0.005–0.401 de salida, según tamaño y calidad |
| GPT Image 2.5 Flare/Sunburst | Ejemplos Low–High: US$0.0041–0.1002 de salida |
| Seedream 5 Pro | Provisional: US$0.0675 hasta 1536²; US$0.135 por encima. Primera referencia incluida; US$0.0045 por referencia adicional y salida |
| Seedream 5 Flash | US$0.027/imagen |
| FLUX.2 | US$0.012/MP de entrada y salida; referencias redimensionadas a 1 MP |

Fuentes oficiales:

- [Seedream 4.5](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image)
- [Nano Banana Pro](https://fal.ai/models/fal-ai/nano-banana-pro)
- [Nano Banana 2](https://fal.ai/models/fal-ai/nano-banana-2)
- [Seedream 5 Lite](https://fal.ai/models/fal-ai/bytedance/seedream/v5/lite/text-to-image)
- [GPT Image 2](https://fal.ai/models/openai/gpt-image-2)
- [GPT Image 2.5](https://fal.ai/gpt-image-2.5)
- [Seedream 5 Pro](https://fal.ai/models/bytedance/seedream/v5/pro/edit)
- [Seedream 5 Flash](https://fal.ai/models/bytedance/seedream/v5/flash/edit)
- [FLUX.2 edición](https://fal.ai/models/fal-ai/flux-2/edit) y [generación](https://fal.ai/models/fal-ai/flux-2)

## Supuestos del estimado

- GPT se factura por tokens. Los tamaños publicados usan sus ejemplos; los demás usan una aproximación por área desde el ejemplo más cercano en relación y superficie. No es una cotización ni un límite de gasto.
- Referencias GPT: se asumen US$0.0083 por referencia de aproximadamente 1024²; una referencia mayor puede costar más. El prompt agrega tokens cuyo costo no se puede conocer exactamente antes de enviar la solicitud.
- `Auto` muestra un rango orientativo de ejemplos. Los campos numéricos existentes de costos estimados guardan el extremo superior de ese rango.
- `xhigh` y `max` no tienen una tarifa publicada por imagen. Se muestra “desde” el ejemplo High; los campos numéricos de costos guardan esa base inferior. No son cargos reales conciliados con la factura de fal.ai.
- FLUX estima MP completos usando 1024² como 1 MP, conforme al ejemplo oficial; la nota identifica el redondeo.
- PNG/JPEG/WEBP no tienen recargo publicado en estas tarifas.
- El total multiplica el estimado unitario por las imágenes a generar. Las poses que reutilizan una referencia no agregan generación. Reintentos y revisiones adicionales no están incluidos.
- No se han modificado costos históricos ni la configuración de proveedores; el proveedor OpenAI directo retirado conserva su compatibilidad histórica.
