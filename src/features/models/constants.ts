import { AspectRatio, ModelPhotoProvider } from '../../../shared/src/types';
import { PoseRecipe, PoseGroupOption } from './types';

export const IDENTITY_CANDIDATE_COUNT = 4;

export const MODEL_POSE_RECIPES: PoseRecipe[] = [
  {
    id: 'full-front',
    label: 'Frente completa',
    group: 'Cuerpo completo',
    shotType: 'full body, standing upright, facing camera directly',
    usesReferenceImage: true,
  },
  {
    id: 'full-front-diagonal',
    label: 'Diagonal de frente',
    group: 'Cuerpo completo',
    shotType: 'full body, standing, diagonal front angle, body slightly turned, looking at camera',
  },
  {
    id: 'full-three-quarter',
    label: '3/4 frente',
    group: 'Cuerpo completo',
    shotType: 'full body, standing, three-quarter angle, slight body turn',
  },
  {
    id: 'full-profile-left',
    label: 'Perfil lateral',
    group: 'Cuerpo completo',
    shotType: 'full body, side profile, facing left',
  },
  {
    id: 'full-walking',
    label: 'Caminando',
    group: 'Cuerpo completo',
    shotType: 'full body, walking pose, slight movement',
  },
  {
    id: 'full-contrapposto',
    label: 'Contrapposto',
    group: 'Cuerpo completo',
    shotType: 'full body, relaxed contrapposto pose, weight on one leg, facing camera',
  },
  {
    id: 'back-full',
    label: 'Espalda completa',
    group: 'Cuerpo completo',
    shotType: 'full body, back view, facing away from camera',
  },
  {
    id: 'back-diagonal',
    label: 'Espalda diagonal',
    group: 'Cuerpo completo',
    shotType: 'full body, three-quarter back view, body turned away, head slightly toward camera',
  },
  {
    id: 'back-three-quarter',
    label: '3/4 espalda',
    group: 'Cuerpo completo',
    shotType: 'full body, rear three-quarter angle, shoulders turned away from camera',
  },
  {
    id: 'half-front',
    label: 'Medio cuerpo frente',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, facing camera',
  },
  {
    id: 'half-front-diagonal',
    label: 'Medio cuerpo diagonal',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, diagonal front angle',
  },
  {
    id: 'half-three-quarter',
    label: 'Medio cuerpo 3/4',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, three-quarter angle',
  },
  {
    id: 'half-back',
    label: 'Medio cuerpo espalda',
    group: 'Medio cuerpo',
    shotType: 'half body, back view, waist up, facing away',
  },
  {
    id: 'portrait-front',
    label: 'Retrato frente',
    group: 'Retrato',
    shotType: 'portrait, face and shoulders, facing camera',
  },
  {
    id: 'portrait-three-quarter',
    label: 'Retrato 3/4',
    group: 'Retrato',
    shotType: 'portrait, bust shot, slight angle',
  },
];

export const MODEL_POSE_RECIPES_BY_ID = new Map(MODEL_POSE_RECIPES.map((recipe) => [recipe.id, recipe]));

export const MODEL_POSE_GROUPS = Array.from(
  MODEL_POSE_RECIPES.reduce((groups, recipe) => {
    const existing = groups.get(recipe.group) ?? [];
    existing.push(recipe);
    groups.set(recipe.group, existing);
    return groups;
  }, new Map<string, PoseRecipe[]>()),
).map(([group, options]) => ({ group, options }));

const toPoseGroupId = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const MODEL_POSE_GROUP_OPTIONS: PoseGroupOption[] = MODEL_POSE_GROUPS.map(({ group, options }) => ({
  id: toPoseGroupId(group),
  label: group,
  poseIds: options.map((pose) => pose.id),
}));

export const DEFAULT_POSE_SELECTION_IDS: string[] = [];

export const AI_WIZARD_STEPS = [
  { id: 1, name: 'Configurar' },
  { id: 2, name: 'Candidatos' },
  { id: 3, name: 'Poses' },
];

export const AI_WIZARD_MAX_STEP = AI_WIZARD_STEPS[AI_WIZARD_STEPS.length - 1]?.id ?? 3;

export const SEX_OPTIONS = [
  { value: 'female', label: 'Femenino' },
  { value: 'male', label: 'Masculino' },
  { value: 'non-binary', label: 'No binario' },
];

export const AGE_OPTIONS = [
  { value: 'baby, 0-12 months old', label: 'Bebé (0–12 meses)' },
  { value: 'toddler, 1-3 years old', label: 'Bebé caminador (1–3 años)' },
  { value: 'child, 4-7 years old', label: 'Niño/a (4–7 años)' },
  { value: 'child, 8-12 years old', label: 'Niño/a (8–12 años)' },
  { value: 'teen, 13-17 years old', label: 'Adolescente (13–17 años)' },
  { value: '18-25', label: 'Adulto/a 18–25' },
  { value: '25-35', label: 'Adulto/a 25–35' },
  { value: '35-45', label: 'Adulto/a 35–45' },
  { value: '45-55', label: 'Adulto/a 45–55' },
  { value: '55-65', label: 'Adulto/a 55–65' },
  { value: '65+', label: 'Adulto/a 65+' },
];

export const SKIN_OPTIONS = [
  { value: 'very fair', label: 'Muy claro' },
  { value: 'fair', label: 'Claro' },
  { value: 'medium', label: 'Medio' },
  { value: 'olive', label: 'Oliva' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'very dark', label: 'Muy oscuro' },
];

export const HAIR_COLOR_OPTIONS = [
  { value: 'blonde', label: 'Rubio' },
  { value: 'brunette', label: 'Castaño' },
  { value: 'black', label: 'Negro' },
  { value: 'red', label: 'Pelirrojo' },
  { value: 'gray', label: 'Gris' },
  { value: 'white', label: 'Blanco' },
];

export const HAIR_LENGTH_OPTIONS = [
  { value: 'short', label: 'Corto' },
  { value: 'medium-length', label: 'Medio' },
  { value: 'long', label: 'Largo' },
];

export const BUILD_OPTIONS = [
  { value: 'slim', label: 'Delgado/a' },
  { value: 'athletic', label: 'Atlético/a' },
  { value: 'average', label: 'Normal' },
  { value: 'curvy', label: 'Curvilíneo/a' },
];

export const BACKGROUND_OPTIONS = [
  { value: 'pure white seamless backdrop, no shadows', label: 'Blanco puro' },
  { value: 'light gray seamless paper backdrop', label: 'Gris claro' },
  { value: 'medium gray seamless studio backdrop', label: 'Gris medio' },
  { value: 'warm beige seamless backdrop', label: 'Beige cálido' },
  { value: 'cool sand-toned seamless backdrop', label: 'Arena fría' },
  { value: 'soft off-white seamless backdrop', label: 'Blanco roto' },
  { value: 'matte black seamless backdrop', label: 'Negro mate' },
  { value: 'very light dusty rose seamless backdrop', label: 'Rosa pálido' },
  { value: 'soft sage green seamless backdrop', label: 'Verde salvia' },
  { value: 'pale powder blue seamless backdrop', label: 'Azul pálido' },
  { value: 'subtle warm gradient from off-white to light beige', label: 'Degradado beige' },
  { value: 'subtle cool gradient from white to light gray', label: 'Degradado gris' },
  { value: 'smooth matte concrete texture, very minimal', label: 'Cemento suave' },
  { value: 'clean white minimalist studio floor and wall corner', label: 'Estudio con piso' },
];

export const TOP_OPTIONS = [
  { value: '', label: 'Sin top' },
  { value: 'plain white t-shirt', label: 'Playera blanca' },
  { value: 'plain black t-shirt', label: 'Playera negra' },
  { value: 'plain white tank top', label: 'Musculosa blanca' },
  { value: 'plain black tank top', label: 'Musculosa negra' },
  { value: 'plain white long-sleeve shirt', label: 'Manga larga blanca' },
  { value: 'plain black long-sleeve shirt', label: 'Manga larga negra' },
];

export const BOTTOM_OPTIONS = [
  { value: '', label: 'Sin parte baja' },
  { value: 'plain white shorts', label: 'Shorts blancos' },
  { value: 'plain black shorts', label: 'Shorts negros' },
  { value: 'plain white pants', label: 'Pantalón blanco' },
  { value: 'plain black pants', label: 'Pantalón negro' },
  { value: 'plain white skirt', label: 'Falda blanca' },
  { value: 'plain black skirt', label: 'Falda negra' },
];

export const FOOTWEAR_OPTIONS = [
  { value: '', label: 'Sin calzado' },
  { value: 'plain white sneakers', label: 'Zapatillas blancas' },
  { value: 'plain black sneakers', label: 'Zapatillas negras' },
];

export const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '3:4', label: '3:4 (retrato)' },
  { value: '9:16', label: '9:16 (vertical)' },
  { value: '2:3', label: '2:3' },
  { value: '1:1', label: '1:1 (cuadrado)' },
];

export const PROVIDER_OPTIONS: { value: ModelPhotoProvider; label: string; hint: string }[] = [
  { value: 'fal-seedream-v4.5', label: 'Seedream v4.5 (fal.ai)',    hint: 'ByteDance · ~$0.04/foto' },
  { value: 'fal-banana-pro',    label: 'Nano Banana Pro (fal.ai)',  hint: 'Gemini Pro · ~$0.04/foto' },
  { value: 'openai-dalle',      label: 'OpenAI gpt-image-1.5',      hint: 'Alta fidelidad · ~$0.04/foto' },
  { value: 'fal-nano-banana-2', label: 'Nano Banana 2 (fal.ai)',    hint: 'Gemini 3.1 Flash · ~$0.05/foto' },
  { value: 'fal-seedream-5',    label: 'Seedream 5 Lite (fal.ai)',  hint: 'ByteDance v5 · ~$0.035/foto' },
];
