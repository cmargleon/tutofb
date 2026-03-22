"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFinalGenerationPrompt = exports.buildNegativeBackgroundPrompt = exports.buildBackgroundPrompt = exports.normalizeBackgroundConfig = exports.isActiveCatalogEntity = exports.isArchivedCatalogEntity = exports.isCatalogEntityStatus = exports.isAspectRatio = exports.isProvider = exports.isRole = exports.defaultBackgroundConfig = exports.BACKGROUND_SEPARATION_VALUES = exports.BACKGROUND_REALISM_VALUES = exports.BACKGROUND_CONTRAST_VALUES = exports.BACKGROUND_PROMINENCE_VALUES = exports.BACKGROUND_DOMINANT_COLOR_VALUES = exports.BACKGROUND_LIGHTING_VALUES = exports.BACKGROUND_SCENE_VALUES = exports.BACKGROUND_MODE_VALUES = exports.DEFAULT_TRY_ON_PROMPT = exports.PROVIDER_LABELS = exports.ASPECT_RATIO_VALUES = exports.PROVIDER_VALUES = exports.ROLE_VALUES = void 0;
exports.ROLE_VALUES = ['admin', 'operador', 'revisor'];
exports.PROVIDER_VALUES = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5'];
exports.ASPECT_RATIO_VALUES = ['9:16', '3:4', '2:3', '1:1', '4:3', '3:2', '16:9'];
exports.PROVIDER_LABELS = {
    'fal-seedream': 'fal.ai seedream',
    'fal-banana-pro': 'fal.ai banana-pro',
    'openai-gpt-image-1.5': 'OpenAI gpt-image-1.5',
};
exports.DEFAULT_TRY_ON_PROMPT = `Replace only the clothing worn by the person in the original image with the garment from the reference image.

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
exports.BACKGROUND_MODE_VALUES = [
    'white',
    'bokeh',
    'studio',
    'exterior_natural',
    'exterior_urbano',
    'interior_lifestyle',
    'custom',
];
exports.BACKGROUND_SCENE_VALUES = [
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
exports.BACKGROUND_LIGHTING_VALUES = [
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
exports.BACKGROUND_DOMINANT_COLOR_VALUES = [
    'white',
    'neutral gray',
    'warm beige',
    'soft blue',
    'forest green',
    'ocean blue',
    'sand',
    'black',
];
exports.BACKGROUND_PROMINENCE_VALUES = ['minimal', 'medium', 'editorial'];
exports.BACKGROUND_CONTRAST_VALUES = ['soft', 'medium', 'high'];
exports.BACKGROUND_REALISM_VALUES = ['catalogo_realista', 'campana_lifestyle'];
exports.BACKGROUND_SEPARATION_VALUES = ['standard', 'strong', 'maximum'];
exports.defaultBackgroundConfig = {
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
const modeCopy = {
    white: 'fondo blanco solido limpio de catalogo',
    bokeh: 'fondo con bokeh controlado',
    studio: 'fondo de estudio comercial',
    exterior_natural: 'fondo exterior natural',
    exterior_urbano: 'fondo exterior urbano',
    interior_lifestyle: 'fondo interior lifestyle',
    custom: 'fondo personalizado',
};
const sceneCopy = {
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
const lightingCopy = {
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
const prominenceCopy = {
    minimal: 'protagonismo minimo del fondo',
    medium: 'protagonismo medio del fondo',
    editorial: 'protagonismo editorial del fondo',
};
const contrastCopy = {
    soft: 'contraste suave',
    medium: 'contraste medio',
    high: 'contraste alto',
};
const realismCopy = {
    catalogo_realista: 'realismo de catalogo',
    campana_lifestyle: 'realismo de campana lifestyle',
};
const separationCopy = {
    standard: 'separacion sujeto-fondo estandar',
    strong: 'separacion sujeto-fondo fuerte',
    maximum: 'separacion sujeto-fondo maxima',
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pickEnum = (value, values, fallback) => typeof value === 'string' && values.includes(value) ? value : fallback;
const pickBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const isRole = (value) => exports.ROLE_VALUES.includes(value);
exports.isRole = isRole;
const isProvider = (value) => exports.PROVIDER_VALUES.includes(value);
exports.isProvider = isProvider;
const isAspectRatio = (value) => exports.ASPECT_RATIO_VALUES.includes(value);
exports.isAspectRatio = isAspectRatio;
const isCatalogEntityStatus = (value) => value === 'active' || value === 'archived';
exports.isCatalogEntityStatus = isCatalogEntityStatus;
const isArchivedCatalogEntity = (value) => value?.status === 'archived';
exports.isArchivedCatalogEntity = isArchivedCatalogEntity;
const isActiveCatalogEntity = (value) => !(0, exports.isArchivedCatalogEntity)(value);
exports.isActiveCatalogEntity = isActiveCatalogEntity;
const normalizeBackgroundConfig = (value) => {
    const config = value ?? {};
    const normalized = {
        mode: pickEnum(config.mode, exports.BACKGROUND_MODE_VALUES, exports.defaultBackgroundConfig.mode),
        scene: pickEnum(config.scene, exports.BACKGROUND_SCENE_VALUES, exports.defaultBackgroundConfig.scene),
        lighting: pickEnum(config.lighting, exports.BACKGROUND_LIGHTING_VALUES, exports.defaultBackgroundConfig.lighting),
        bokehStrength: clamp(Number(config.bokehStrength) || 0, 0, 100),
        dominantColor: pickEnum(config.dominantColor, exports.BACKGROUND_DOMINANT_COLOR_VALUES, exports.defaultBackgroundConfig.dominantColor),
        prominence: pickEnum(config.prominence, exports.BACKGROUND_PROMINENCE_VALUES, exports.defaultBackgroundConfig.prominence),
        contrast: pickEnum(config.contrast, exports.BACKGROUND_CONTRAST_VALUES, exports.defaultBackgroundConfig.contrast),
        realism: pickEnum(config.realism, exports.BACKGROUND_REALISM_VALUES, exports.defaultBackgroundConfig.realism),
        separation: pickEnum(config.separation, exports.BACKGROUND_SEPARATION_VALUES, exports.defaultBackgroundConfig.separation),
        avoidExtraPeople: pickBoolean(config.avoidExtraPeople, exports.defaultBackgroundConfig.avoidExtraPeople),
        avoidDistractingProps: pickBoolean(config.avoidDistractingProps, exports.defaultBackgroundConfig.avoidDistractingProps),
        avoidTextSignage: pickBoolean(config.avoidTextSignage, exports.defaultBackgroundConfig.avoidTextSignage),
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
exports.normalizeBackgroundConfig = normalizeBackgroundConfig;
const buildBackgroundPrompt = (backgroundConfig) => {
    const parts = [
        `Crear ${modeCopy[backgroundConfig.mode]}.`,
        `Usar ${lightingCopy[backgroundConfig.lighting]}.`,
        `Mantener ${separationCopy[backgroundConfig.separation]}.`,
    ];
    if (backgroundConfig.mode !== 'white') {
        parts.push(`Escenario: ${sceneCopy[backgroundConfig.scene]}.`, `Color dominante del fondo: ${backgroundConfig.dominantColor}.`, `Aplicar ${prominenceCopy[backgroundConfig.prominence]}.`, `Aplicar ${contrastCopy[backgroundConfig.contrast]}.`, `Buscar ${realismCopy[backgroundConfig.realism]}.`);
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
exports.buildBackgroundPrompt = buildBackgroundPrompt;
const buildNegativeBackgroundPrompt = (backgroundConfig) => {
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
exports.buildNegativeBackgroundPrompt = buildNegativeBackgroundPrompt;
const buildFinalGenerationPrompt = (promptBase, backgroundConfig, garmentIsMultiAngle) => {
    const basePrompt = promptBase.trim() || exports.DEFAULT_TRY_ON_PROMPT;
    const sections = [
        basePrompt,
        `Instrucciones de fondo: ${(0, exports.buildBackgroundPrompt)(backgroundConfig)}`,
    ];
    if (garmentIsMultiAngle) {
        sections.push('La prenda de referencia esta mostrada desde multiples angulos dentro de una sola imagen.');
    }
    const negativeBackgroundPrompt = (0, exports.buildNegativeBackgroundPrompt)(backgroundConfig);
    if (negativeBackgroundPrompt) {
        sections.push(`Evitar en el fondo: ${negativeBackgroundPrompt}.`);
    }
    return sections.filter(Boolean).join('\n\n');
};
exports.buildFinalGenerationPrompt = buildFinalGenerationPrompt;
//# sourceMappingURL=domain.js.map