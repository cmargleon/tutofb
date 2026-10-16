import type {
  FalBananaProImageConfig,
  FalNanoBanana2ImageConfig,
  ModelPhotoProvider,
  OpenAIImageConfig,
  Provider,
  ProviderImageConfig,
  Seedream5ImageSizePreset,
  SeedreamImageSizePreset,
} from '../types';

export const PROVIDER_COSTS: Record<Provider, number> = {
  'fal-seedream': 0.04,
  'fal-banana-pro': 0.15,
  'openai-gpt-image-1.5': 0.04,
  'fal-nano-banana-2': 0.08,
  'fal-seedream-5': 0.035,
  'fal-gpt-image-2': 0.04,
  'fal-gpt-image-2.5-sunburst': 0.0257,
  'fal-gpt-image-2.5-flare': 0.0257,
  'fal-seedream-5-pro': 0.0675,
  'fal-seedream-5-flash': 0.027,
  'fal-flux-2-edit': 0.036,
};

export const PROVIDER_PRICE_LABELS: Record<Provider, string> = {
  'fal-seedream': '$0.04/img',
  'fal-banana-pro': '$0.15/img base, $0.30 en 4K',
  'openai-gpt-image-1.5': '$0.02-$0.25/img segun quality y size',
  'fal-nano-banana-2': '$0.06-$0.16/img segun resolucion',
  'fal-seedream-5': '$0.035/img',
  'fal-gpt-image-2': '≈ $0.005-$0.401/img + tokens de entrada',
  'fal-gpt-image-2.5-sunburst': '≈ $0.0041-$0.1002/img (Low–High) + referencias',
  'fal-gpt-image-2.5-flare': '≈ $0.0041-$0.1002/img (Low–High) + referencias',
  'fal-seedream-5-pro': '$0.0675-$0.135/img + referencias adicionales',
  'fal-seedream-5-flash': '$0.027/img',
  'fal-flux-2-edit': '$0.012/MP de entrada y salida',
};

export const MODEL_PHOTO_PROVIDER_COSTS: Record<ModelPhotoProvider, number> = {
  'fal-seedream-v4.5': 0.04,
  'fal-banana-pro': 0.15,
  'openai-dalle': 0.04,
  'fal-nano-banana-2': 0.08,
  'fal-seedream-5': 0.035,
  'fal-gpt-image-2': 0.04,
  'fal-gpt-image-2.5-sunburst': 0.0257,
  'fal-gpt-image-2.5-flare': 0.0257,
  'fal-seedream-5-pro': 0.0675,
  'fal-seedream-5-flash': 0.027,
  'fal-flux-2-edit': 0.036,
};

export const MODEL_PHOTO_PROVIDER_PRICE_LABELS: Record<ModelPhotoProvider, string> = {
  'fal-seedream-v4.5': '$0.04/foto',
  'fal-banana-pro': '$0.15/foto base, $0.30 en 4K',
  'openai-dalle': '$0.02-$0.25/foto segun quality y size',
  'fal-nano-banana-2': '$0.06-$0.16/foto segun resolucion',
  'fal-seedream-5': '$0.035/foto',
  'fal-gpt-image-2': '≈ $0.005-$0.401/foto + tokens de entrada',
  'fal-gpt-image-2.5-sunburst': '≈ $0.0041-$0.1002/img (Low–High) + referencias',
  'fal-gpt-image-2.5-flare': '≈ $0.0041-$0.1002/img (Low–High) + referencias',
  'fal-seedream-5-pro': '$0.0675-$0.135/img + referencias adicionales',
  'fal-seedream-5-flash': '$0.027/img',
  'fal-flux-2-edit': '$0.012/MP de entrada y salida',
};

const SEEDREAM_V45_PRESET_COSTS: Partial<Record<SeedreamImageSizePreset, number>> = {
  auto_2K: 0.04,
  auto_4K: 0.04,
};

const SEEDREAM_5_PRESET_COSTS: Partial<Record<Seedream5ImageSizePreset, number>> = {
  auto_2K: 0.035,
  auto_3K: 0.035,
};

const OPENAI_IMAGE_COSTS: Record<OpenAIImageConfig['quality'], Record<OpenAIImageConfig['size'], number>> = {
  low: {
    '1024x1024': 0.02,
    '1024x1536': 0.03,
    '1536x1024': 0.03,
  },
  medium: {
    '1024x1024': 0.04,
    '1024x1536': 0.06,
    '1536x1024': 0.06,
  },
  high: {
    '1024x1024': 0.17,
    '1024x1536': 0.25,
    '1536x1024': 0.25,
  },
};

const getSeedreamV45Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-seedream') return PROVIDER_COSTS['fal-seedream'];
  if (typeof imageConfig.imageSize === 'string') {
    return SEEDREAM_V45_PRESET_COSTS[imageConfig.imageSize] ?? PROVIDER_COSTS['fal-seedream'];
  }
  return PROVIDER_COSTS['fal-seedream'];
};

const getBananaProCost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-banana-pro') return PROVIDER_COSTS['fal-banana-pro'];

  const config = imageConfig as FalBananaProImageConfig;
  switch (config.resolution) {
    case '4K':
      return 0.3;
    case '1K':
    case '2K':
    default:
      return PROVIDER_COSTS['fal-banana-pro'];
  }
};

const getOpenAICost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'openai-gpt-image-1.5') return PROVIDER_COSTS['openai-gpt-image-1.5'];
  return OPENAI_IMAGE_COSTS[imageConfig.quality][imageConfig.size];
};

const getNanoBanana2Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-nano-banana-2') return PROVIDER_COSTS['fal-nano-banana-2'];

  const config = imageConfig as FalNanoBanana2ImageConfig;
  switch (config.resolution) {
    case '0.5K':
      return 0.06;
    case '2K':
      return 0.12;
    case '4K':
      return 0.16;
    case '1K':
    default:
      return PROVIDER_COSTS['fal-nano-banana-2'];
  }
};

const getSeedream5Cost = (imageConfig?: ProviderImageConfig | null): number => {
  if (!imageConfig || imageConfig.provider !== 'fal-seedream-5') return PROVIDER_COSTS['fal-seedream-5'];
  if (typeof imageConfig.imageSize === 'string') {
    return SEEDREAM_5_PRESET_COSTS[imageConfig.imageSize] ?? PROVIDER_COSTS['fal-seedream-5'];
  }
  return PROVIDER_COSTS['fal-seedream-5'];
};

// Official rate cards checked 2026-10-16. The GPT rows are published examples,
// not guarantees: prompts, image input tokens and automatic choices change billing.
export const PROVIDER_PRICING_CHECKED_AT = '2026-10-16';
export const PROVIDER_PRICING_SOURCES: Record<Provider, string> = {
  'fal-seedream': 'https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image',
  'fal-banana-pro': 'https://fal.ai/models/fal-ai/nano-banana-pro',
  'openai-gpt-image-1.5': 'https://developers.openai.com/api/docs/pricing',
  'fal-nano-banana-2': 'https://fal.ai/models/fal-ai/nano-banana-2',
  'fal-seedream-5': 'https://fal.ai/models/fal-ai/bytedance/seedream/v5/lite/text-to-image',
  'fal-gpt-image-2': 'https://fal.ai/models/openai/gpt-image-2',
  'fal-gpt-image-2.5-sunburst': 'https://fal.ai/gpt-image-2.5',
  'fal-gpt-image-2.5-flare': 'https://fal.ai/gpt-image-2.5',
  'fal-seedream-5-pro': 'https://fal.ai/models/bytedance/seedream/v5/pro/edit',
  'fal-seedream-5-flash': 'https://fal.ai/models/bytedance/seedream/v5/flash/edit',
  'fal-flux-2-edit': 'https://fal.ai/models/fal-ai/flux-2/edit',
};

export interface ProviderCostEstimate {
  estimatedUsd: number;
  minUsd: number;
  // null means no published upper estimate, not an unlimited spending budget.
  maxUsd: number | null;
  note: string;
}

const PRESET_DIMENSIONS: Record<string, { width: number; height: number }> = {
  square_hd: { width: 1024, height: 1024 },
  square: { width: 512, height: 512 },
  portrait_4_3: { width: 768, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
  landscape_4_3: { width: 1024, height: 768 },
  landscape_16_9: { width: 1024, height: 576 },
};

// width, height, GPT Image 2 low/medium/high, GPT Image 2.5 low/medium/high.
const GPT_PRICE_EXAMPLES = [
  [1024, 768, 0.005, 0.037, 0.145, 0.0041, 0.0091, 0.0362],
  [1024, 1024, 0.006, 0.053, 0.211, 0.0060, 0.0133, 0.0528],
  [1024, 1536, 0.005, 0.042, 0.165, 0.0048, 0.0104, 0.0413],
  [1920, 1080, 0.005, 0.040, 0.158, 0.0045, 0.0096, 0.0395],
  [2560, 1440, 0.007, 0.056, 0.222, 0.0062, 0.0144, 0.0554],
  [3840, 2160, 0.012, 0.101, 0.401, 0.0112, 0.0260, 0.1002],
];
const roundUsd = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const dimensions = (config: ProviderImageConfig) => {
  if (!('imageSize' in config)) return null;
  return typeof config.imageSize === 'string' ? PRESET_DIMENSIONS[config.imageSize] ?? null : config.imageSize;
};

const getGptEstimate = (config: Extract<ProviderImageConfig, { quality: unknown; imageSize: unknown }>, references: number): ProviderCostEstimate => {
  const offset = config.provider === 'fal-gpt-image-2' ? 2 : 5;
  const size = dimensions(config);
  const qualityIndex = config.quality === 'low' ? 0 : config.quality === 'medium' ? 1 : 2;
  const unknownQuality = config.quality === 'xhigh' || config.quality === 'max';
  // An input around 1024² adds ~US$0.0083; source documents ~US$0.012
  // for a 4K reference. Dimensions/token usage are unavailable before generation.
  const input = references * 0.0083;
  const note = 'Facturación por tokens; incluye ≈ US$0.0083 por referencia de 1024×1024. El tamaño de las referencias y el prompt pueden variar el cargo.';
  if (!size || config.quality === 'auto') {
    const rows = size ? GPT_PRICE_EXAMPLES.filter(row =>
      Math.min(row[0], row[1]) === Math.min(size.width, size.height)
      && Math.max(row[0], row[1]) === Math.max(size.width, size.height)) : GPT_PRICE_EXAMPLES;
    const examples = rows.length ? rows : GPT_PRICE_EXAMPLES;
    const values = examples.flatMap(row => config.quality === 'auto'
      ? row.slice(offset, offset + 3) : [row[offset + qualityIndex]]);
    const minUsd = Math.min(...values) + input;
    const maxUsd = Math.max(...values) + input;
    return { estimatedUsd: roundUsd(maxUsd), minUsd: roundUsd(minUsd), maxUsd: unknownQuality ? null : roundUsd(maxUsd), note: (unknownQuality ? 'Xhigh/Max: desde High, sin estimación máxima publicada. ' : '') + 'Auto: rango orientativo de ejemplos publicados, no un límite de gasto. ' + note };
  }
  const ratio = Math.max(size.width, size.height) / Math.min(size.width, size.height);
  // For unpublished dimensions use the closest aspect/area example, then scale by
  // area. This is explicitly a heuristic, since output tokens are not linear pixels.
  const row = [...GPT_PRICE_EXAMPLES].sort((a, b) => {
    const distance = (r: number[]) => Math.abs(Math.log((Math.max(r[0], r[1]) / Math.min(r[0], r[1])) / ratio)) * 4
      + Math.abs(Math.log((r[0] * r[1]) / (size.width * size.height)));
    return distance(a) - distance(b);
  })[0];
  const scale = (size.width * size.height) / (row[0] * row[1]);
  const value = roundUsd(row[offset + qualityIndex] * scale + input);
  return {
    estimatedUsd: value, minUsd: value, maxUsd: unknownQuality ? null : value,
    note: (unknownQuality ? 'Desde el costo de High: no hay tarifa por imagen publicada para Xhigh/Max; el costo será mayor. ' : '')
      + (scale !== 1 ? 'Tamaño sin tarifa publicada: aproximación por área. ' : '') + note,
  };
};

export const getProviderCostEstimate = (
  provider: Provider,
  imageConfig?: ProviderImageConfig | null,
  referenceCount = 2,
): ProviderCostEstimate => {
  const references = Number.isFinite(referenceCount) ? Math.max(0, Math.floor(referenceCount)) : 0;
  const config = imageConfig?.provider === provider ? imageConfig : null;
  if (config && (config.provider === 'fal-gpt-image-2' || config.provider === 'fal-gpt-image-2.5-sunburst' || config.provider === 'fal-gpt-image-2.5-flare')) {
    return getGptEstimate(config, references);
  }
  let value = PROVIDER_COSTS[provider];
  let note = 'Tarifa por imagen para las opciones seleccionadas.';
  switch (provider) {
    case 'fal-seedream': value = getSeedreamV45Cost(config); break;
    case 'fal-banana-pro': value = getBananaProCost(config); break;
    case 'openai-gpt-image-1.5': value = getOpenAICost(config); note = 'Estimado de salida; el prompt y las referencias se facturan aparte.'; break;
    case 'fal-nano-banana-2': value = getNanoBanana2Cost(config); break;
    case 'fal-seedream-5': value = getSeedream5Cost(config); break;
    case 'fal-seedream-5-pro': {
      const area = config ? dimensions(config) : null;
      const large = config && 'imageSize' in config && config.imageSize === 'auto_2K';
      value = (large || (area && area.width * area.height > 1536 * 1536) ? 0.135 : 0.0675) + Math.max(0, references - 1) * 0.0045;
      note = 'Tarifa provisional: primera referencia incluida; US$0.0045 por referencia adicional e imagen de salida.';
      break;
    }
    case 'fal-flux-2-edit': {
      const size = config ? dimensions(config) : null;
      // fal bills 1024² output as 1 MP (see the official edit example).
      const outputMP = size ? Math.max(1, Math.ceil(size.width * size.height / (1024 * 1024))) : 1;
      value = 0.012 * (references + outputMP);
      note = 'US$0.012 por MP de entrada y salida; cada referencia se redimensiona a 1 MP. Estimación con redondeo a MP completos.';
      break;
    }
  }
  value = roundUsd(value);
  return { estimatedUsd: value, minUsd: value, maxUsd: value, note };
};

// Numeric compatibility for existing persisted estimated-cost fields. For Xhigh/Max
// this stores the published High baseline, which is only a lower estimate.
export const getProviderCostUsd = (provider: Provider, imageConfig?: ProviderImageConfig | null, referenceCount = 2): number =>
  getProviderCostEstimate(provider, imageConfig, referenceCount).estimatedUsd;

export const getModelPhotoProviderCostUsd = (
  provider: ModelPhotoProvider,
  imageConfig?: ProviderImageConfig | null,
  referenceCount = 0,
): number => getProviderCostUsd(
  provider === 'fal-seedream-v4.5' ? 'fal-seedream' : provider === 'openai-dalle' ? 'openai-gpt-image-1.5' : provider,
  imageConfig, referenceCount,
);
