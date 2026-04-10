import { WizardState, createInitialPoseSuggestionState, createInitialProductDraftPreparationState } from '../types';

export const resetWizardGeneratedOutputs = (state: WizardState): WizardState => ({
  ...state,
  selectedPoseIds: [],
  poseSuggestions: createInitialPoseSuggestionState(),
  productDrafts: [],
  productDraftPreparation: createInitialProductDraftPreparationState(),
});

export const resetWizardProductDrafts = (state: WizardState): WizardState => ({
  ...state,
  productDrafts: [],
  productDraftPreparation: createInitialProductDraftPreparationState(),
});

export const resetWizardProductDraftPreparation = (state: WizardState): WizardState => ({
  ...state,
  productDraftPreparation: createInitialProductDraftPreparationState(),
});

export const replaceWizardProductDraftRows = (
  state: WizardState,
  garmentId: string,
  rows: WizardState['productDrafts'][number]['rows'],
): WizardState => ({
  ...state,
  productDrafts: state.productDrafts.map((entry) =>
    entry.garmentId === garmentId
      ? { ...entry, rows }
      : entry,
  ),
});
