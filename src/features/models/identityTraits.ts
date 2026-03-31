import { ModelIdentityTraits } from '../../../shared/src/types';

export const createEmptyModelIdentityTraits = (): ModelIdentityTraits => ({
  sex: null,
  age: null,
  skin: null,
  hairColor: null,
  hairLength: null,
  build: null,
});

export const normalizeModelIdentityTraits = (
  value: Partial<ModelIdentityTraits> | null | undefined,
): ModelIdentityTraits | null => {
  const normalized: ModelIdentityTraits = {
    sex: typeof value?.sex === 'string' && value.sex.trim() ? value.sex.trim() : null,
    age: typeof value?.age === 'string' && value.age.trim() ? value.age.trim() : null,
    skin: typeof value?.skin === 'string' && value.skin.trim() ? value.skin.trim() : null,
    hairColor: typeof value?.hairColor === 'string' && value.hairColor.trim() ? value.hairColor.trim() : null,
    hairLength: typeof value?.hairLength === 'string' && value.hairLength.trim() ? value.hairLength.trim() : null,
    build: typeof value?.build === 'string' && value.build.trim() ? value.build.trim() : null,
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
};

export const buildModelIdentityTraitsFromAiForm = (value: {
  sex: string;
  age: string;
  skin: string;
  hairColor: string;
  hairLength: string;
  build: string;
}): ModelIdentityTraits => ({
  sex: value.sex || null,
  age: value.age || null,
  skin: value.skin || null,
  hairColor: value.hairColor || null,
  hairLength: value.hairLength || null,
  build: value.build || null,
});
