import type { Dispatch, SetStateAction } from 'react';
import { createDefaultProductScenes } from '../../../../../shared/src/productGeneration';
import type { ProductSceneType } from '../../../../../shared/src/types';
import { handleGarmentFiles, revokeGarmentUrls } from '../../garments';
import { resetWizardGeneratedOutputs } from '../stateTransitions';
import type { WizardState } from '../../types';

export const useProductGeneration = ({ state, setState, setFlowError }: {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  setFlowError: (message: string | null) => void;
}) => {
  const handleFiles = async (files: File[], sameItem = false) => {
    let prepared: WizardState['garments'] = [];
    try {
      if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Usa fotografías JPEG, PNG o WebP.');
      prepared = await handleGarmentFiles(files, []);
      if (sameItem && prepared.length > 0) {
        prepared = [{ ...prepared[0], files: prepared.flatMap((item) => item.files), originalFileNames: prepared.flatMap((item) => item.originalFileNames),
          originalPhotos: prepared.flatMap((item) => item.originalPhotos).map((photo, index) => ({ ...photo, sourceIndex: index })), isMultiAngle: files.length > 1 }];
      }
      const next = [...state.garments, ...prepared];
      if (next.some((item) => item.originalPhotos.length > 4)) throw new Error('Cada objeto admite hasta 4 fotos de referencia.');
      if (next.reduce((sum, item) => sum + item.originalPhotos.length, 0) > 40) throw new Error('El lote admite hasta 40 fotos.');
      setState((current) => resetWizardGeneratedOutputs({ ...current, garments: [...current.garments, ...prepared] }));
      setFlowError(null);
    } catch (error) {
      revokeGarmentUrls(prepared);
      setFlowError(error instanceof Error ? error.message : 'No se pudieron preparar los objetos.');
    }
  };
  const toggleScene = (type: ProductSceneType) => setState((current) => ({ ...current,
    productScenes: current.productScenes.some((scene) => scene.type === type)
      ? current.productScenes.filter((scene) => scene.type !== type)
      : [...current.productScenes, createDefaultProductScenes().find((scene) => scene.type === type)!],
  }));
  const changeScenePrompt = (type: ProductSceneType, prompt: string) => setState((current) => ({ ...current,
    productScenes: current.productScenes.map((scene) => scene.type === type ? { ...scene, prompt } : scene),
  }));
  return { handleFiles, toggleScene, changeScenePrompt };
};
