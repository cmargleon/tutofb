export type PosePromptCategory = 'full_body' | 'half_body' | 'lower_body' | 'footwear_closeup' | 'portrait';
export type PosePromptOrientation =
  | 'front'
  | 'front_three_quarter'
  | 'profile_left'
  | 'profile_right'
  | 'back'
  | 'back_three_quarter';
export type PosePromptModifier = 'walking' | 'contrapposto';

export type PosePromptProfile = {
  category: PosePromptCategory;
  orientation: PosePromptOrientation;
  modifiers?: PosePromptModifier[];
};

export type PoseRecipe = {
  id: string;
  label: string;
  group: string;
  shotType: string;
  promptProfile: PosePromptProfile;
  promptDirectives?: string[];
  usesReferenceImage?: boolean;
  manualFaceVisible?: boolean;
};


const LOWER_BODY_PROMPT_DIRECTIVES = [
  'Frame the image strictly from the waist to the full feet, with the waistband visible and both feet completely inside the frame.',
  'Do not crop above the waist and do not crop any part of the feet, ankles, or hems.',
  'The full lower garment must be fully visible from waistband to hem.',
  'Keep both legs and the entire silhouette of the garment clearly visible.',
  'Do not show the model face or head.',
];

const FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES = [
  'Frame a close-up centered on the footwear from around the lower shin or ankle down to the full soles.',
  'Keep both shoes or feet completely inside the frame with clear commercial readability.',
  'The footwear must be the primary subject, large enough to inspect shape, silhouette, and upper details.',
  'Do not widen the frame into a lower-body, half-body, or full-body composition.',
  'Do not show the model face, torso, or hands.',
];

const PORTRAIT_BACK_NAPE_PROMPT_DIRECTIVES = [
  'Frame a rear portrait where the camera sees only the back of the head, nape, and upper shoulders.',
  'Do not show the eyes, nose, lips, or a readable cheek line.',
  'The image must read as a clean back portrait, not a side profile or a three-quarter turn.',
];

export const MODEL_POSE_RECIPES: PoseRecipe[] = [
  {
    id: 'full-front',
    label: 'Frente completa',
    group: 'Cuerpo completo',
    shotType: 'full body, standing upright, facing camera directly',
    promptProfile: {
      category: 'full_body',
      orientation: 'front',
    },
    usesReferenceImage: true,
  },
  {
    id: 'full-front-diagonal',
    label: 'Diagonal de frente',
    group: 'Cuerpo completo',
    shotType: 'full body, standing, diagonal front angle, body slightly turned, looking at camera',
    promptProfile: {
      category: 'full_body',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'full-three-quarter',
    label: '3/4 frente',
    group: 'Cuerpo completo',
    shotType: 'full body, standing, three-quarter angle, slight body turn',
    promptProfile: {
      category: 'full_body',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'full-profile-left',
    label: 'Tres cuartos natural',
    group: 'Cuerpo completo',
    shotType: 'full body, natural commercial three-quarter front angle, looking at camera',
    promptProfile: {
      category: 'full_body',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'full-walking',
    label: 'Caminando',
    group: 'Cuerpo completo',
    shotType: 'full body, walking pose, slight movement',
    promptProfile: {
      category: 'full_body',
      orientation: 'front_three_quarter',
      modifiers: ['walking'],
    },
  },
  {
    id: 'full-contrapposto',
    label: 'Contrapposto',
    group: 'Cuerpo completo',
    shotType: 'full body, relaxed contrapposto pose, weight on one leg, facing camera',
    promptProfile: {
      category: 'full_body',
      orientation: 'front',
      modifiers: ['contrapposto'],
    },
  },
  {
    id: 'back-full',
    label: 'Espalda completa',
    group: 'Cuerpo completo',
    shotType: 'full body, commercial back view, garment rear prominent, looking at camera over shoulder without hair or arms covering garment',
    promptProfile: {
      category: 'full_body',
      orientation: 'back',
    },
  },
  {
    id: 'back-diagonal',
    label: 'Espalda diagonal',
    group: 'Cuerpo completo',
    shotType: 'full body, three-quarter back view, body turned away, head slightly toward camera',
    promptProfile: {
      category: 'full_body',
      orientation: 'back_three_quarter',
    },
  },
  {
    id: 'back-three-quarter',
    label: '3/4 espalda',
    group: 'Cuerpo completo',
    shotType: 'full body, rear three-quarter angle, shoulders turned away from camera',
    promptProfile: {
      category: 'full_body',
      orientation: 'back_three_quarter',
    },
  },
  {
    id: 'half-front',
    label: 'Medio cuerpo frente',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, facing camera',
    promptProfile: {
      category: 'half_body',
      orientation: 'front',
    },
  },
  {
    id: 'half-front-diagonal',
    label: 'Medio cuerpo diagonal',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, diagonal front angle',
    promptProfile: {
      category: 'half_body',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'half-three-quarter',
    label: 'Medio cuerpo 3/4',
    group: 'Medio cuerpo',
    shotType: 'half body, waist up, three-quarter angle',
    promptProfile: {
      category: 'half_body',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'half-back',
    label: 'Medio cuerpo espalda',
    group: 'Medio cuerpo',
    shotType: 'half body, commercial back view, garment rear prominent, looking at camera over shoulder, arms and hair clear of garment',
    promptProfile: {
      category: 'half_body',
      orientation: 'back',
    },
  },
  {
    id: 'lower-front',
    label: 'Tren inferior frente',
    group: 'Tren inferior',
    shotType: 'lower body only, waist to feet, front view, facing camera',
    promptProfile: {
      category: 'lower_body',
      orientation: 'front',
    },
    promptDirectives: LOWER_BODY_PROMPT_DIRECTIVES,
  },
  {
    id: 'lower-front-three-quarter',
    label: 'Tren inferior 3/4 frente',
    group: 'Tren inferior',
    shotType: 'lower body only, waist to feet, three-quarter front angle, body slightly turned',
    promptProfile: {
      category: 'lower_body',
      orientation: 'front_three_quarter',
    },
    promptDirectives: LOWER_BODY_PROMPT_DIRECTIVES,
  },
  {
    id: 'lower-back',
    label: 'Tren inferior espalda',
    group: 'Tren inferior',
    shotType: 'lower body only, waist to feet, back view, facing away from camera',
    promptProfile: {
      category: 'lower_body',
      orientation: 'back',
    },
    promptDirectives: LOWER_BODY_PROMPT_DIRECTIVES,
  },
  {
    id: 'lower-back-three-quarter',
    label: 'Tren inferior 3/4 espalda',
    group: 'Tren inferior',
    shotType: 'lower body only, waist to feet, three-quarter back angle, body turned away from camera',
    promptProfile: {
      category: 'lower_body',
      orientation: 'back_three_quarter',
    },
    promptDirectives: LOWER_BODY_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-front-closeup',
    label: 'Calzado frente',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, front view, standing catalog angle',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'front',
    },
    promptDirectives: FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-three-quarter-closeup',
    label: 'Calzado 3/4',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, three-quarter front angle, subtle stance rotation',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'front_three_quarter',
    },
    promptDirectives: FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-three-quarter-left-closeup',
    label: 'Calzado 3/4 izquierdo',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, three-quarter front angle, left side dominant',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'front_three_quarter',
    },
    promptDirectives: [
      ...FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
      'Rotate the stance so the left side of the footwear is the dominant visible side.',
    ],
  },
  {
    id: 'footwear-three-quarter-right-closeup',
    label: 'Calzado 3/4 derecho',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, three-quarter front angle, right side dominant',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'front_three_quarter',
    },
    promptDirectives: [
      ...FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
      'Rotate the stance so the right side of the footwear is the dominant visible side.',
    ],
  },
  {
    id: 'footwear-side-closeup',
    label: 'Calzado lateral',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, clean side profile, catalog readability',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'profile_left',
    },
    promptDirectives: FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-side-right-closeup',
    label: 'Calzado lateral derecho',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, clean right side profile, catalog readability',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'profile_right',
    },
    promptDirectives: FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-back-closeup',
    label: 'Calzado espalda',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, back view, heels facing camera',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'back',
    },
    promptDirectives: FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
  },
  {
    id: 'footwear-back-three-quarter-left-closeup',
    label: 'Calzado 3/4 espalda izquierdo',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, three-quarter back angle, left rear side dominant',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'back_three_quarter',
    },
    promptDirectives: [
      ...FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
      'Rotate the stance so the left rear side of the footwear is the dominant visible side.',
    ],
  },
  {
    id: 'footwear-back-three-quarter-right-closeup',
    label: 'Calzado 3/4 espalda derecho',
    group: 'Calzado',
    shotType: 'footwear close-up, both feet visible, three-quarter back angle, right rear side dominant',
    promptProfile: {
      category: 'footwear_closeup',
      orientation: 'back_three_quarter',
    },
    promptDirectives: [
      ...FOOTWEAR_CLOSEUP_PROMPT_DIRECTIVES,
      'Rotate the stance so the right rear side of the footwear is the dominant visible side.',
    ],
  },
  {
    id: 'portrait-front',
    label: 'Retrato frente',
    group: 'Retrato',
    shotType: 'portrait, face and shoulders, facing camera',
    promptProfile: {
      category: 'portrait',
      orientation: 'front',
    },
  },
  {
    id: 'portrait-three-quarter',
    label: 'Retrato 3/4',
    group: 'Retrato',
    shotType: 'portrait, bust shot, slight angle',
    promptProfile: {
      category: 'portrait',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'portrait-three-quarter-left',
    label: 'Retrato 3/4 izquierdo',
    group: 'Retrato',
    shotType: 'portrait, bust shot, three-quarter angle, left side dominant',
    promptProfile: {
      category: 'portrait',
      orientation: 'front_three_quarter',
    },
    promptDirectives: ['Rotate so the left cheek and left side of the face are the dominant visible side.'],
  },
  {
    id: 'portrait-three-quarter-right',
    label: 'Retrato 3/4 derecho',
    group: 'Retrato',
    shotType: 'portrait, bust shot, three-quarter angle, right side dominant',
    promptProfile: {
      category: 'portrait',
      orientation: 'front_three_quarter',
    },
    promptDirectives: ['Rotate so the right cheek and right side of the face are the dominant visible side.'],
  },
  {
    id: 'portrait-profile-left',
    label: 'Retrato perfil izquierdo',
    group: 'Retrato',
    shotType: 'portrait, strict left side profile, left cheek and left ear facing camera, subject facing right',
    promptProfile: {
      category: 'portrait',
      orientation: 'profile_left',
    },
  },
  {
    id: 'portrait-profile-right',
    label: 'Retrato perfil derecho',
    group: 'Retrato',
    shotType: 'portrait, strict right side profile, right cheek and right ear facing camera, subject facing left',
    promptProfile: {
      category: 'portrait',
      orientation: 'profile_right',
    },
  },
  {
    id: 'portrait-back-nape',
    label: 'Retrato nuca',
    group: 'Retrato',
    shotType: 'portrait, complete back view, only the nape and back of head visible',
    promptProfile: {
      category: 'portrait',
      orientation: 'back',
    },
    promptDirectives: PORTRAIT_BACK_NAPE_PROMPT_DIRECTIVES,
    manualFaceVisible: false,
  },
  {
    id: 'portrait-back-three-quarter-left',
    label: 'Retrato 3/4 espalda izquierdo',
    group: 'Retrato',
    shotType: 'portrait, three-quarter back angle, left rear side dominant',
    promptProfile: {
      category: 'portrait',
      orientation: 'back_three_quarter',
    },
    promptDirectives: ['Rotate so the left rear side of the head and face contour are the dominant visible side.'],
  },
  {
    id: 'portrait-back-three-quarter-right',
    label: 'Retrato 3/4 espalda derecho',
    group: 'Retrato',
    shotType: 'portrait, three-quarter back angle, right rear side dominant',
    promptProfile: {
      category: 'portrait',
      orientation: 'back_three_quarter',
    },
    promptDirectives: ['Rotate so the right rear side of the head and face contour are the dominant visible side.'],
  },
  {
    id: 'accessories-front',
    label: 'Accesorios frente',
    group: 'Accesorios',
    shotType: 'portrait, face and upper shoulders, front view, clear visibility of headwear and eyewear',
    promptProfile: {
      category: 'portrait',
      orientation: 'front',
    },
  },
  {
    id: 'accessories-three-quarter',
    label: 'Accesorios 3/4',
    group: 'Accesorios',
    shotType: 'portrait, face and upper shoulders, three-quarter front angle, clear visibility of headwear and eyewear',
    promptProfile: {
      category: 'portrait',
      orientation: 'front_three_quarter',
    },
  },
  {
    id: 'accessories-half-front',
    label: 'Accesorios medio cuerpo',
    group: 'Accesorios',
    shotType: 'half body, chest up, front view, head and face clearly visible for hats, glasses, and similar accessories',
    promptProfile: {
      category: 'half_body',
      orientation: 'front',
    },
  },
];

export const MODEL_POSE_RECIPES_BY_ID = new Map(MODEL_POSE_RECIPES.map((recipe) => [recipe.id, recipe]));


export default { MODEL_POSE_RECIPES, MODEL_POSE_RECIPES_BY_ID };
