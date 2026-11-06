import type { ClientAutomationConfig, Model } from './types';

export const getModelGender = (model: Pick<Model, 'identityTraits'>): 'male' | 'female' | null => {
  const sex = model.identityTraits?.sex?.trim().toLowerCase();
  if (['male', 'masculino', 'hombre'].includes(sex || '')) return 'male';
  if (['female', 'femenino', 'mujer'].includes(sex || '')) return 'female';
  return null;
};

export const getClientGenderModelDefaults = (
  clientId: string, config: ClientAutomationConfig | undefined, models: Model[],
): Pick<ClientAutomationConfig, 'defaultMaleModelId' | 'defaultFemaleModelId'> => {
  const available = models.filter(model => model.id && model.clientId === clientId && model.active !== false && model.status !== 'archived');
  const result: Pick<ClientAutomationConfig, 'defaultMaleModelId' | 'defaultFemaleModelId'> = {};
  for (const [gender, key] of [['male', 'defaultMaleModelId'], ['female', 'defaultFemaleModelId']] as const) {
    const candidates = available.filter(model => getModelGender(model) === gender);
    const id = config?.[key] || (candidates.length === 1 ? candidates[0].id : undefined);
    if (id) result[key] = id;
  }
  return result;
};
