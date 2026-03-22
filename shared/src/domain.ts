import {
  AspectRatio,
  BackgroundConfig,
  BackgroundContrast,
  BackgroundDominantColor,
  BackgroundLighting,
  BackgroundMode,
  BackgroundProminence,
  BackgroundRealism,
  BackgroundScene,
  BackgroundSeparation,
  Provider,
  Role,
  CatalogEntityStatus,
} from './types';

export const ROLE_VALUES: Role[] = ['admin', 'operador', 'revisor'];
export const PROVIDER_VALUES: Provider[] = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5'];
export const ASPECT_RATIO_VALUES: AspectRatio[] = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  'fal-seedream': 'fal.ai seedream',
  'fal-banana-pro': 'fal.ai banana-pro',
  'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
};

export const DEFAULT_TRY_ON_PROMPT =
  `Replace only the clothing worn by the person in the original image with the garment from the reference image.

Strictly preserve:
    •    the model's identity (face and body)
    •    exact pose
    •    original lighting
    •    camera angle and framing
    •    original background

Fit the new garment naturally onto the model's body, ensuring:
    •    correct anatomy and proportions
    •    realistic fabric folds and tension
    •    proper draping according to the pose

The garment must:
    •    retain its original color, texture, and design
    •    not be altered or stylized
    •    match the perspective of the scene

Output a photorealistic, high-detail fashion catalog image with consistent lighting and no visual artifacts.`;

export const BACKGROUND_MODE_VALUES: BackgroundMode[] = [
  'white',
  'bokeh',
  'studio',
  'exterior_natural',
  'exterior_urbano',
  'interior_lifestyle',
  'custom',
];

export const BACKGROUND_SCENE_VALUES: BackgroundScene[] = [
  'none',
  'arquitectura_moderna',
  'calle_limpia',
  'terraza',
  'fachada_neutra',
  'bosque',
  'mar',
  'sendero',
  'jardin',
  'campo',
  'living_minimalista',
  'estudio_creativo',
  'cafe_elegante',
  'vestidor',
  'gimnasio_premium',
  'papel_seamless',
  'cemento_suave',
];

export const BACKGROUND_LIGHTING_VALUES: BackgroundLighting[] = [
  'clear_soft_daylight',
  'warm_soft_daylight',
  'cool_soft_daylight',
  'studio_diffused',
  'high_key',
  'editorial',
  'dramatic',
  'overcast_soft',
  'golden_hour',
];

export const BACKGROUND_DOMINANT_COLOR_VALUES: BackgroundDominantColor[] = [
  'white',
  'neutral gray',
  'warm beige',
  'soft blue',
  'forest green',
  'ocean blue',
  'sand',
  'black',
];

export const BACKGROUND_PROMINENCE_VALUES: BackgroundProminence[] = ['minimal', 'medium', 'editorial'];
export const BACKGROUND_CONTRAST_VALUES: BackgroundContrast[] = ['soft', 'medium', 'high'];
export const BACKGROUND_REALISM_VALUES: BackgroundRealism[] = ['catalogo_realista', 'campana_lifestyle'];
export const BACKGROUND_SEPARATION_VALUES: BackgroundSeparation[] = ['standard', 'strong', 'maximum'];

export const defaultBackgroundConfig: BackgroundConfig = {
  mode: 'white',
  scene: 'none',
  lighting: 'clear_soft_daylight',
  bokehStrength: 45,
  dominantColor: 'white',
  prominence: 'minimal',
  contrast: 'soft',
  realism: 'catalogo_realista',
  separation: 'strong',
  avoidExtraPeople: true,
  avoidDistractingProps: true,
  avoidTextSignage: true,
  customDetail: '',
};

const modeCopy: Record<BackgroundMode, string> = {
  white: 'fondo blanco solido limpio de catalogo',
  bokeh: 'fondo con bokeh controlado',
  studio: 'fondo de estudio comercial',
  exterior_natural: 'fondo exterior natural',
  exterior_urbano: 'fondo exterior urbano',
  interior_lifestyle: 'fondo interior lifestyle',
  custom: 'fondo personalizado',
};

const sceneCopy: Record<BackgroundScene, string> = {
  none: 'sin escenario adicional',
  arquitectura_moderna: 'arquitectura moderna',
  calle_limpia: 'calle limpia',
  terraza: 'terraza',
  fachada_neutra: 'fachada neutra',
  bosque: 'bosque',
  mar: 'mar',
  sendero: 'sendero',
  jardin: 'jardin',
  campo: 'campo',
  living_minimalista: 'living minimalista',
  estudio_creativo: 'estudio creativo',
  cafe_elegante: 'cafe elegante',
  vestidor: 'vestidor',
  gimnasio_premium: 'gimnasio premium',
  papel_seamless: 'papel seamless',
  cemento_suave: 'cemento suave',
};

const lightingCopy: Record<BackgroundLighting, string> = {
  clear_soft_daylight: 'luz clara suave',
  warm_soft_daylight: 'luz calida suave',
  cool_soft_daylight: 'luz fria suave',
  studio_diffused: 'luz de estudio difusa',
  high_key: 'luz high key',
  editorial: 'luz editorial',
  dramatic: 'luz dramatica',
  overcast_soft: 'luz de nublado suave',
  golden_hour: 'luz de golden hour',
};

const prominenceCopy: Record<BackgroundProminence, string> = {
  minimal: 'protagonismo minimo del fondo',
  medium: 'protagonismo medio del fondo',
  editorial: 'protagonismo editorial del fondo',
};

const contrastCopy: Record<BackgroundContrast, string> = {
  soft: 'contraste suave',
  medium: 'contraste medio',
  high: 'contraste alto',
};

const realismCopy: Record<BackgroundRealism, string> = {
  catalogo_realista: 'realismo de catalogo',
  campana_lifestyle: 'realismo de campana lifestyle',
};

const separationCopy: Record<BackgroundSeparation, string> = {
  standard: 'separacion sujeto-fondo estandar',
  strong: 'separacion sujeto-fondo fuerte',
  maximum: 'separacion sujeto-fondo maxima',
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const pickEnum = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;

const pickBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export const isRole = (value: unknown): value is Role => ROLE_VALUES.includes(value as Role);
export const isProvider = (value: unknown): value is Provider => PROVIDER_VALUES.includes(value as Provider);
export const isAspectRatio = (value: unknown): value is AspectRatio => ASPECT_RATIO_VALUES.includes(value as AspectRatio);
export const isCatalogEntityStatus = (value: unknown): value is CatalogEntityStatus =>
  value === 'active' || value === 'archived';
export const isArchivedCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  value?.status === 'archived';
export const isActiveCatalogEntity = (value: { status?: CatalogEntityStatus | null } | null | undefined): boolean =>
  !isArchivedCatalogEntity(value);

export const normalizeBackgroundConfig = (value: Partial<BackgroundConfig> | null | undefined): BackgroundConfig => {
  const config = value ?? {};
  const normalized: BackgroundConfig = {
    mode: pickEnum(config.mode, BACKGROUND_MODE_VALUES, defaultBackgroundConfig.mode),
    scene: pickEnum(config.scene, BACKGROUND_SCENE_VALUES, defaultBackgroundConfig.scene),
    lighting: pickEnum(config.lighting, BACKGROUND_LIGHTING_VALUES, defaultBackgroundConfig.lighting),
    bokehStrength: clamp(Number(config.bokehStrength) || 0, 0, 100),
    dominantColor: pickEnum(
      config.dominantColor,
      BACKGROUND_DOMINANT_COLOR_VALUES,
      defaultBackgroundConfig.dominantColor,
    ),
    prominence: pickEnum(config.prominence, BACKGROUND_PROMINENCE_VALUES, defaultBackgroundConfig.prominence),
    contrast: pickEnum(config.contrast, BACKGROUND_CONTRAST_VALUES, defaultBackgroundConfig.contrast),
    realism: pickEnum(config.realism, BACKGROUND_REALISM_VALUES, defaultBackgroundConfig.realism),
    separation: pickEnum(config.separation, BACKGROUND_SEPARATION_VALUES, defaultBackgroundConfig.separation),
    avoidExtraPeople: pickBoolean(config.avoidExtraPeople, defaultBackgroundConfig.avoidExtraPeople),
    avoidDistractingProps: pickBoolean(
      config.avoidDistractingProps,
      defaultBackgroundConfig.avoidDistractingProps,
    ),
    avoidTextSignage: pickBoolean(config.avoidTextSignage, defaultBackgroundConfig.avoidTextSignage),
    customDetail: typeof config.customDetail === 'string' ? config.customDetail.trim() : '',
  };

  if (normalized.mode === 'white') {
    normalized.scene = 'none';
    normalized.bokehStrength = 0;
    normalized.dominantColor = 'white';
    normalized.prominence = 'minimal';
  }

  return normalized;
};

export const buildBackgroundPrompt = (backgroundConfig: BackgroundConfig): string => {
  const parts: string[] = [
    `Crear ${modeCopy[backgroundConfig.mode]}.`,
    `Usar ${lightingCopy[backgroundConfig.lighting]}.`,
    `Mantener ${separationCopy[backgroundConfig.separation]}.`,
  ];

  if (backgroundConfig.mode !== 'white') {
    parts.push(
      `Escenario: ${sceneCopy[backgroundConfig.scene]}.`,
      `Color dominante del fondo: ${backgroundConfig.dominantColor}.`,
      `Aplicar ${prominenceCopy[backgroundConfig.prominence]}.`,
      `Aplicar ${contrastCopy[backgroundConfig.contrast]}.`,
      `Buscar ${realismCopy[backgroundConfig.realism]}.`,
    );

    if (backgroundConfig.bokehStrength > 0) {
      parts.push(`Desenfoque tipo bokeh al ${backgroundConfig.bokehStrength}% en el fondo.`);
    }
  }

  if (backgroundConfig.avoidExtraPeople) {
    parts.push('No agregar gente extra.');
  }

  if (backgroundConfig.avoidDistractingProps) {
    parts.push('No agregar props distractores ni elementos que compitan con la prenda.');
  }

  if (backgroundConfig.avoidTextSignage) {
    parts.push('No agregar texto, rotulos ni senaletica.');
  }

  if (backgroundConfig.customDetail) {
    parts.push(`Detalle extra de fondo: ${backgroundConfig.customDetail}.`);
  }

  return parts.join(' ');
};

export const buildNegativeBackgroundPrompt = (backgroundConfig: BackgroundConfig): string => {
  const negativeParts = [
    'fondos desordenados o sucios',
    'perspectivas de fondo rotas',
    'recortes deficientes alrededor de la persona',
  ];

  if (backgroundConfig.avoidExtraPeople) {
    negativeParts.push('gente extra');
  }

  if (backgroundConfig.avoidDistractingProps) {
    negativeParts.push('props distractores');
  }

  if (backgroundConfig.avoidTextSignage) {
    negativeParts.push('texto, senaletica o carteles');
  }

  if (backgroundConfig.mode === 'white') {
    negativeParts.push('fondos grises, coloridos o con textura visible');
  }

  return negativeParts.join(', ');
};

export const buildFinalGenerationPrompt = (
  promptBase: string,
  backgroundConfig: BackgroundConfig,
  garmentIsMultiAngle: boolean,
): string => {
  const basePrompt = promptBase.trim() || DEFAULT_TRY_ON_PROMPT;
  const sections = [
    basePrompt,
    `Instrucciones de fondo: ${buildBackgroundPrompt(backgroundConfig)}`,
  ];

  if (garmentIsMultiAngle) {
    sections.push('La prenda de referencia esta mostrada desde multiples angulos dentro de una sola imagen.');
  }

  const negativeBackgroundPrompt = buildNegativeBackgroundPrompt(backgroundConfig);
  if (negativeBackgroundPrompt) {
    sections.push(`Evitar en el fondo: ${negativeBackgroundPrompt}.`);
  }

  return sections.filter(Boolean).join('\n\n');
};
