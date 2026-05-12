import React, { useEffect, useState } from 'react';
import {
  BANANA_ASPECT_RATIO_VALUES,
  BANANA_RESOLUTION_VALUES,
  GPT_IMAGE_2_IMAGE_SIZE_PRESET_VALUES,
  GPT_IMAGE_2_OUTPUT_FORMAT_VALUES,
  GPT_IMAGE_2_QUALITY_VALUES,
  NANO_BANANA_2_ASPECT_RATIO_VALUES,
  NANO_BANANA_2_RESOLUTION_VALUES,
  OPENAI_IMAGE_QUALITY_VALUES,
  OPENAI_IMAGE_SIZE_VALUES,
  SEEDREAM_5_IMAGE_SIZE_PRESET_VALUES,
  SEEDREAM_IMAGE_SIZE_PRESET_VALUES,
} from '../../../shared/src/providerImageConfig';
import { Provider } from '../../../shared/src/types';
import { WizardProviderImageConfig } from '../../features/generate/types';

interface ProviderImageConfigSelectionProps {
  provider: Provider;
  value: WizardProviderImageConfig;
  onChange: (config: WizardProviderImageConfig) => void;
}

const commonCardClassName =
  'rounded-2xl border px-4 py-3 text-left transition';

const getOpenAISizeCopy = (size: (typeof OPENAI_IMAGE_SIZE_VALUES)[number]) => {
  switch (size) {
    case '1024x1024':
      return { title: 'Cuadrado', description: 'Salida balanceada para composiciones centradas.' };
    case '1024x1536':
      return { title: 'Vertical', description: 'Formato retrato nativo de OpenAI.' };
    case '1536x1024':
      return { title: 'Horizontal', description: 'Formato apaisado nativo de OpenAI.' };
    default:
      return { title: size, description: 'Tamano soportado por OpenAI.' };
  }
};

const getSeedreamPresetCopy = (preset: (typeof SEEDREAM_IMAGE_SIZE_PRESET_VALUES)[number]) => {
  switch (preset) {
    case 'square_hd':
      return { title: 'Square HD', description: 'Cuadrado con preset de alta definicion.' };
    case 'square':
      return { title: 'Square', description: 'Cuadrado simple para composiciones compactas.' };
    case 'portrait_4_3':
      return { title: 'Portrait 4:3', description: 'Vertical catalogo, mas cercano a 3:4.' };
    case 'portrait_16_9':
      return { title: 'Portrait 16:9', description: 'Vertical alto, ideal para reels o stories.' };
    case 'landscape_4_3':
      return { title: 'Landscape 4:3', description: 'Horizontal clasico con mas aire lateral.' };
    case 'landscape_16_9':
      return { title: 'Landscape 16:9', description: 'Horizontal wide para hero shots.' };
    case 'auto':
      return { title: 'Auto', description: 'Seedream decide el tamano automaticamente.' };
    case 'auto_2K':
      return { title: 'Auto 2K', description: 'Auto con objetivo de resolucion 2K.' };
    case 'auto_4K':
      return { title: 'Auto 4K', description: 'Auto con objetivo de resolucion 4K.' };
    default:
      return { title: preset, description: 'Preset soportado por Seedream.' };
  }
};

const BANANA_RATIO_HINTS: Record<(typeof BANANA_ASPECT_RATIO_VALUES)[number], string> = {
  '21:9': 'Ultra wide',
  '16:9': 'Hero wide',
  '3:2': 'Editorial',
  '4:3': 'Landscape',
  '5:4': 'Catalogo ancho',
  '1:1': 'Cuadrado',
  '4:5': 'Feed retrato',
  '3:4': 'Catalogo vertical',
  '2:3': 'Portrait',
  '9:16': 'Stories / Reels',
};

const QUALITY_LABELS: Record<(typeof OPENAI_IMAGE_QUALITY_VALUES)[number], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const GPT_IMAGE_2_QUALITY_LABELS: Record<(typeof GPT_IMAGE_2_QUALITY_VALUES)[number], string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const OUTPUT_FORMAT_LABELS: Record<(typeof GPT_IMAGE_2_OUTPUT_FORMAT_VALUES)[number], string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WEBP',
};

const renderChoiceButton = ({
  keyValue,
  title,
  description,
  selected,
  onClick,
}: {
  keyValue: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    key={keyValue}
    onClick={onClick}
    className={`${commonCardClassName} ${
      selected
        ? 'border-emerald-700 bg-emerald-600 text-white'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
    }`}
  >
    <div className="font-semibold">{title}</div>
    <div className={`mt-1 text-xs ${selected ? 'text-emerald-100' : 'text-slate-500'}`}>{description}</div>
  </button>
);

const renderCompactOptions = ({
  label,
  values,
  selected,
  onSelect,
  labels,
}: {
  label: string;
  values: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
  labels?: Record<string, string>;
}) => (
  <div className="space-y-2">
    <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
    <div className="flex flex-wrap gap-2">
      {values.map((option) => {
        const isSelected = selected === option;
        return (
          <button
            type="button"
            key={option}
            onClick={() => onSelect(option)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              isSelected
                ? 'border-emerald-700 bg-emerald-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            {labels?.[option] || option}
          </button>
        );
      })}
    </div>
  </div>
);

const getNanoBanana2RatioHint = (ratio: string): string => {
  const hints: Record<string, string> = {
    'auto': 'Auto',
    '21:9': 'Ultra wide',
    '16:9': 'Hero wide',
    '3:2': 'Editorial',
    '4:3': 'Landscape',
    '5:4': 'Catálogo ancho',
    '1:1': 'Cuadrado',
    '4:5': 'Feed retrato',
    '3:4': 'Catálogo vertical',
    '2:3': 'Portrait',
    '9:16': 'Stories / Reels',
    '4:1': 'Panorámico',
    '1:4': 'Columna alta',
    '8:1': 'Banner ultra wide',
    '1:8': 'Columna extrema',
  };
  return hints[ratio] ?? ratio;
};

const getSeedream5PresetCopy = (preset: (typeof SEEDREAM_5_IMAGE_SIZE_PRESET_VALUES)[number]) => {
  switch (preset) {
    case 'square_hd':     return { title: 'Square HD',     description: 'Cuadrado alta definición.' };
    case 'square':        return { title: 'Square',         description: 'Cuadrado compacto.' };
    case 'portrait_4_3':  return { title: 'Portrait 4:3',  description: 'Vertical catálogo, similar a 3:4.' };
    case 'portrait_16_9': return { title: 'Portrait 16:9', description: 'Vertical alto para stories.' };
    case 'landscape_4_3': return { title: 'Landscape 4:3', description: 'Horizontal clásico.' };
    case 'landscape_16_9':return { title: 'Landscape 16:9',description: 'Horizontal wide.' };
    case 'auto_2K':       return { title: 'Auto 2K',        description: 'Automático en resolución 2K.' };
    case 'auto_3K':       return { title: 'Auto 3K',        description: 'Automático en resolución 3K.' };
    default:              return { title: preset,           description: 'Preset de Seedream 5 Lite.' };
  }
};

const getGPTImage2PresetCopy = (preset: (typeof GPT_IMAGE_2_IMAGE_SIZE_PRESET_VALUES)[number]) => {
  switch (preset) {
    case 'square_hd': return { title: 'Square HD', description: '1024x1024 para composiciones cuadradas.' };
    case 'square': return { title: 'Square', description: '512x512 para pruebas rápidas.' };
    case 'portrait_4_3': return { title: 'Portrait 4:3', description: '768x1024 para catálogo vertical.' };
    case 'portrait_16_9': return { title: 'Portrait 16:9', description: '576x1024 para vertical alto.' };
    case 'landscape_4_3': return { title: 'Landscape 4:3', description: '1024x768 horizontal clásico.' };
    case 'landscape_16_9': return { title: 'Landscape 16:9', description: '1024x576 formato wide.' };
    case 'auto': return { title: 'Auto', description: 'GPT Image 2 decide el tamaño adecuado.' };
    default: return { title: preset, description: 'Preset de GPT Image 2.' };
  }
};

const normalizeGPTImage2Dimension = (value: string, fallback: number): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  const clamped = Math.max(256, Math.min(3840, Math.round(numericValue)));
  return Math.max(16, Math.round(clamped / 16) * 16);
};

export const ProviderImageConfigSelection: React.FC<ProviderImageConfigSelectionProps> = ({
  provider,
  value,
  onChange,
}) => {
  const [customWidthInput, setCustomWidthInput] = useState('1536');
  const [customHeightInput, setCustomHeightInput] = useState('2048');

  useEffect(() => {
    if (
      (provider === 'fal-seedream' && value.provider === 'fal-seedream' && typeof value.imageSize !== 'string')
      || (provider === 'fal-seedream-5' && value.provider === 'fal-seedream-5' && typeof value.imageSize !== 'string')
      || (provider === 'fal-gpt-image-2' && value.provider === 'fal-gpt-image-2' && typeof value.imageSize !== 'string')
    ) {
      setCustomWidthInput(String(value.imageSize.width));
      setCustomHeightInput(String(value.imageSize.height));
    }
  }, [provider, value]);

  if (provider === 'openai-gpt-image-1.5' && value.provider === 'openai-gpt-image-1.5') {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Tamano de salida</label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {OPENAI_IMAGE_SIZE_VALUES.map((size) => {
              const copy = getOpenAISizeCopy(size);
              return renderChoiceButton({
                keyValue: size,
                title: `${copy.title} · ${size}`,
                description: copy.description,
                selected: value.size === size,
                onClick: () => onChange({ ...value, size }),
              });
            })}
          </div>
        </div>

        {renderCompactOptions({
          label: 'Calidad',
          values: OPENAI_IMAGE_QUALITY_VALUES,
          selected: value.quality,
          onSelect: (quality) => onChange({ ...value, quality: quality as typeof value.quality }),
          labels: QUALITY_LABELS,
        })}
      </div>
    );
  }

  if (provider === 'fal-gpt-image-2' && value.provider === 'fal-gpt-image-2') {
    const selectedPreset = typeof value.imageSize === 'string' ? value.imageSize : null;
    const customWidth = typeof value.imageSize === 'string' ? 1024 : value.imageSize.width;
    const customHeight = typeof value.imageSize === 'string' ? 1360 : value.imageSize.height;
    const customArea = customWidth * customHeight;
    const shortestSide = Math.min(customWidth, customHeight);
    const longestSide = Math.max(customWidth, customHeight);
    const customRatio = shortestSide > 0 ? longestSide / shortestSide : 0;

    const commitGPTImage2Dimension = (dimension: 'width' | 'height', rawValue: string) => {
      const fallbackValue = dimension === 'width' ? customWidth : customHeight;
      const nextValue = normalizeGPTImage2Dimension(rawValue, fallbackValue);
      const nextImageSize = {
        width: dimension === 'width' ? nextValue : customWidth,
        height: dimension === 'height' ? nextValue : customHeight,
      };

      onChange({
        ...value,
        imageSize: nextImageSize,
      });

      if (dimension === 'width') {
        setCustomWidthInput(String(nextImageSize.width));
      } else {
        setCustomHeightInput(String(nextImageSize.height));
      }
    };

    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Tamaño de imagen</label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {GPT_IMAGE_2_IMAGE_SIZE_PRESET_VALUES.map((preset) => {
              const copy = getGPTImage2PresetCopy(preset);
              return renderChoiceButton({
                keyValue: preset,
                title: copy.title,
                description: copy.description,
                selected: selectedPreset === preset,
                onClick: () => onChange({ ...value, imageSize: preset }),
              });
            })}

            {renderChoiceButton({
              keyValue: 'custom',
              title: 'Píxeles exactos',
              description: 'Define width y height en múltiplos de 16.',
              selected: typeof value.imageSize !== 'string',
              onClick: () => {
                setCustomWidthInput(String(customWidth));
                setCustomHeightInput(String(customHeight));
                onChange({ ...value, imageSize: { width: customWidth, height: customHeight } });
              },
            })}
          </div>
        </div>

        {typeof value.imageSize !== 'string' ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-medium text-slate-700">Dimensiones personalizadas</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Width (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customWidthInput}
                  onChange={(event) => setCustomWidthInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitGPTImage2Dimension('width', customWidthInput)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Height (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customHeightInput}
                  onChange={(event) => setCustomHeightInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitGPTImage2Dimension('height', customHeightInput)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              GPT Image 2 requiere múltiplos de 16, lado máximo 3840 px, relación máxima 3:1 y área entre 655,360 y 8,294,400 px.
              Selección actual: {customArea.toLocaleString('en-US')} px, ratio {customRatio.toFixed(2)}:1.
            </p>
          </div>
        ) : null}

        {renderCompactOptions({
          label: 'Calidad',
          values: GPT_IMAGE_2_QUALITY_VALUES,
          selected: value.quality,
          onSelect: (quality) => onChange({ ...value, quality: quality as typeof value.quality }),
          labels: GPT_IMAGE_2_QUALITY_LABELS,
        })}

        {renderCompactOptions({
          label: 'Formato',
          values: GPT_IMAGE_2_OUTPUT_FORMAT_VALUES,
          selected: value.outputFormat,
          onSelect: (outputFormat) => onChange({ ...value, outputFormat: outputFormat as typeof value.outputFormat }),
          labels: OUTPUT_FORMAT_LABELS,
        })}
      </div>
    );
  }

  if (provider === 'fal-banana-pro' && value.provider === 'fal-banana-pro') {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Relacion de aspecto</label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {BANANA_ASPECT_RATIO_VALUES.map((ratio) =>
              renderChoiceButton({
                keyValue: ratio,
                title: ratio,
                description: BANANA_RATIO_HINTS[ratio],
                selected: value.aspectRatio === ratio,
                onClick: () => onChange({ ...value, aspectRatio: ratio }),
              }),
            )}
          </div>
        </div>

        {renderCompactOptions({
          label: 'Resolucion',
          values: BANANA_RESOLUTION_VALUES,
          selected: value.resolution,
          onSelect: (resolution) => onChange({ ...value, resolution: resolution as typeof value.resolution }),
        })}
      </div>
    );
  }

  if (provider === 'fal-nano-banana-2' && value.provider === 'fal-nano-banana-2') {
    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Relación de aspecto</label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {NANO_BANANA_2_ASPECT_RATIO_VALUES.map((ratio) =>
              renderChoiceButton({
                keyValue: ratio,
                title: ratio,
                description: getNanoBanana2RatioHint(ratio),
                selected: value.aspectRatio === ratio,
                onClick: () => onChange({ ...value, aspectRatio: ratio }),
              }),
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Resolución</div>
          <div className="flex flex-wrap gap-2">
            {NANO_BANANA_2_RESOLUTION_VALUES.map((res) => {
              const isSelected = value.resolution === res;
              const isCostly = res === '2K' || res === '4K';
              return (
                <button
                  type="button"
                  key={res}
                  onClick={() => onChange({ ...value, resolution: res })}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    isSelected
                      ? 'border-emerald-700 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {res}{isCostly ? (res === '2K' ? ' (+50% costo)' : ' (+100% costo)') : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (provider === 'fal-seedream' && value.provider === 'fal-seedream') {
    const selectedPreset = typeof value.imageSize === 'string' ? value.imageSize : null;
    const customWidth = typeof value.imageSize === 'string' ? 1536 : value.imageSize.width;
    const customHeight = typeof value.imageSize === 'string' ? 2048 : value.imageSize.height;
    const customArea = customWidth * customHeight;
    const commitSeedreamDimension = (dimension: 'width' | 'height', rawValue: string) => {
      const numericValue = Number(rawValue);
      const fallbackValue = dimension === 'width' ? customWidth : customHeight;
      const nextValue = Number.isFinite(numericValue)
        ? Math.max(512, Math.min(4096, Math.round(numericValue)))
        : fallbackValue;

      const nextImageSize = {
        width: dimension === 'width' ? nextValue : customWidth,
        height: dimension === 'height' ? nextValue : customHeight,
      };

      onChange({
        ...value,
        imageSize: nextImageSize,
      });

      if (dimension === 'width') {
        setCustomWidthInput(String(nextImageSize.width));
      } else {
        setCustomHeightInput(String(nextImageSize.height));
      }
    };

    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Tamano de imagen</label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SEEDREAM_IMAGE_SIZE_PRESET_VALUES.map((preset) => {
              const copy = getSeedreamPresetCopy(preset);
              return renderChoiceButton({
                keyValue: preset,
                title: copy.title,
                description: copy.description,
                selected: selectedPreset === preset,
                onClick: () => onChange({ ...value, imageSize: preset }),
              });
            })}

            {renderChoiceButton({
              keyValue: 'custom',
              title: 'Pixeles exactos',
              description: 'Define width y height exactos para Seedream.',
              selected: typeof value.imageSize !== 'string',
              onClick: () => {
                setCustomWidthInput(String(customWidth));
                setCustomHeightInput(String(customHeight));
                onChange({ ...value, imageSize: { width: customWidth, height: customHeight } });
              },
            })}
          </div>
        </div>

        {typeof value.imageSize !== 'string' ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-medium text-slate-700">Dimensiones personalizadas</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Width (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customWidthInput}
                  onChange={(event) => setCustomWidthInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitSeedreamDimension('width', customWidthInput)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Height (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customHeightInput}
                  onChange={(event) => setCustomHeightInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitSeedreamDimension('height', customHeightInput)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Seedream acepta presets y tambien dimensiones exactas. Puedes escribir pixeles libremente y el valor se
              normaliza al salir del campo o al presionar Enter.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Referencia util: 1280x720 es el minimo practico por area, y tu seleccion actual equivale a {customArea.toLocaleString('en-US')} px.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (provider === 'fal-seedream-5' && value.provider === 'fal-seedream-5') {
    const selectedPreset = typeof value.imageSize === 'string' ? value.imageSize : null;
    const customWidth = typeof value.imageSize === 'string' ? 1536 : value.imageSize.width;
    const customHeight = typeof value.imageSize === 'string' ? 2048 : value.imageSize.height;
    const customArea = customWidth * customHeight;

    const commitDimension = (dimension: 'width' | 'height', rawValue: string) => {
      const numericValue = Number(rawValue);
      const fallbackValue = dimension === 'width' ? customWidth : customHeight;
      const nextValue = Number.isFinite(numericValue)
        ? Math.max(256, Math.min(4096, Math.round(numericValue)))
        : fallbackValue;
      const nextImageSize = {
        width: dimension === 'width' ? nextValue : customWidth,
        height: dimension === 'height' ? nextValue : customHeight,
      };
      onChange({ ...value, imageSize: nextImageSize });
      if (dimension === 'width') setCustomWidthInput(String(nextImageSize.width));
      else setCustomHeightInput(String(nextImageSize.height));
    };

    return (
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Tamaño de imagen</label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {SEEDREAM_5_IMAGE_SIZE_PRESET_VALUES.map((preset) => {
              const copy = getSeedream5PresetCopy(preset);
              return renderChoiceButton({
                keyValue: preset,
                title: copy.title,
                description: copy.description,
                selected: selectedPreset === preset,
                onClick: () => onChange({ ...value, imageSize: preset }),
              });
            })}

            {renderChoiceButton({
              keyValue: 'custom',
              title: 'Píxeles exactos',
              description: 'Define width y height para Seedream 5.',
              selected: typeof value.imageSize !== 'string',
              onClick: () => {
                setCustomWidthInput(String(customWidth));
                setCustomHeightInput(String(customHeight));
                onChange({ ...value, imageSize: { width: customWidth, height: customHeight } });
              },
            })}
          </div>
        </div>

        {typeof value.imageSize !== 'string' ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-medium text-slate-700">Dimensiones personalizadas</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Width (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customWidthInput}
                  onChange={(event) => setCustomWidthInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitDimension('width', customWidthInput)}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Height (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customHeightInput}
                  onChange={(event) => setCustomHeightInput(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commitDimension('height', customHeightInput)}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Seedream 5 acepta dimensiones exactas entre 256 y 4096 px por lado. Área actual: {customArea.toLocaleString('en-US')} px.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
};
