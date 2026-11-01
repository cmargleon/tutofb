import type { Dispatch, SetStateAction } from 'react';
import type { ProductSceneInput, ProductSceneType } from '../../../../../shared/src/types';
import { handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { resetWizardGeneratedOutputs } from '../stateTransitions';
import type { WizardState } from '../../types';

export const useProductGeneration = ({ state, setState, setFlowError, defaultScenes, defaultPrompt, onScenesChange }: {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  setFlowError: (message: string | null) => void;
  defaultScenes: ProductSceneInput[];
  defaultPrompt: string;
  onScenesChange: () => void;
}) => {
  const handleFiles = async (files: File[], sameItem = false) => {
    let prepared: WizardState['garments'] = [];
    try {
      if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Usa fotografías JPEG, PNG o WebP.');
      prepared = (await handleGarmentFiles(files, state.garments)).filter((item) => !state.garments.some((existing) => existing.id === item.id));
      if (sameItem && prepared.length > 0) {
        prepared = [{ ...prepared[0], files: prepared.flatMap((item) => item.files), originalFileNames: prepared.flatMap((item) => item.originalFileNames),
          originalPhotos: prepared.flatMap((item) => item.originalPhotos).map((photo, index) => ({ ...photo, sourceIndex: index })), isMultiAngle: files.length > 1 }];
      }
      const next = [...state.garments, ...prepared];
      if (next.some((item) => item.originalPhotos.length > 4)) throw new Error('Cada artículo admite hasta 4 fotos de referencia.');
      if (next.reduce((sum, item) => sum + item.originalPhotos.length, 0) > 40) throw new Error('El lote admite hasta 40 fotos.');
      setState((current) => resetWizardGeneratedOutputs({ ...current, garments: [...current.garments, ...prepared.map((item) => ({ ...item, itemKindOverride: current.garments[0]?.itemKindOverride ?? null }))] }));
      setFlowError(null);
    } catch (error) {
      revokeGarmentUrls(prepared);
      setFlowError(error instanceof Error ? error.message : 'No se pudieron preparar las fotos.');
    }
  };
  const toggleScene = (type: ProductSceneType) => {
    onScenesChange();
    setState((current) => ({ ...current,
      productScenes: current.productScenes.some((scene) => scene.type === type)
        ? current.productScenes.filter((scene) => scene.type !== type)
        : [...current.productScenes, { ...defaultScenes.find((scene) => scene.type === type)! }],
    }));
  };
  const changeScenePrompt = (type: ProductSceneType, prompt: string) => {
    onScenesChange();
    setState((current) => ({ ...current,
      productScenes: current.productScenes.map((scene) => scene.type === type ? { ...scene, prompt } : scene),
    }));
  };
  return { handleFiles, toggleScene, changeScenePrompt, defaultScenes, defaultPrompt };
};
