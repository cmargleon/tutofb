import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { AspectRatio, ModelPhotoProvider } from '../../../../shared/src/types';
import {
  AGE_OPTIONS,
  ASPECT_OPTIONS,
  BACKGROUND_OPTIONS,
  BOTTOM_OPTIONS,
  BUILD_OPTIONS,
  FOOTWEAR_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  PROVIDER_OPTIONS,
  SEX_OPTIONS,
  SKIN_OPTIONS,
  TOP_OPTIONS,
} from '../constants';
import { buildIdentityPrompt } from '../prompts';

type SetState<T> = Dispatch<SetStateAction<T>>;

export interface AiIdentityFormState {
  sexOptions: typeof SEX_OPTIONS;
  ageOptions: typeof AGE_OPTIONS;
  skinOptions: typeof SKIN_OPTIONS;
  hairColorOptions: typeof HAIR_COLOR_OPTIONS;
  hairLengthOptions: typeof HAIR_LENGTH_OPTIONS;
  buildOptions: typeof BUILD_OPTIONS;
  backgroundOptions: typeof BACKGROUND_OPTIONS;
  topOptions: typeof TOP_OPTIONS;
  bottomOptions: typeof BOTTOM_OPTIONS;
  footwearOptions: typeof FOOTWEAR_OPTIONS;
  aspectOptions: typeof ASPECT_OPTIONS;
  providerOptions: typeof PROVIDER_OPTIONS;
  sex: string;
  setSex: SetState<string>;
  age: string;
  setAge: SetState<string>;
  skin: string;
  setSkin: SetState<string>;
  hairColor: string;
  setHairColor: SetState<string>;
  hairLength: string;
  setHairLength: SetState<string>;
  build: string;
  setBuild: SetState<string>;
  background: string;
  setBackground: SetState<string>;
  bokeh: number;
  handleBokehChange: (value: number) => void;
  top: string;
  setTop: SetState<string>;
  bottom: string;
  setBottom: SetState<string>;
  footwear: string;
  setFootwear: SetState<string>;
  provider: ModelPhotoProvider;
  setProvider: SetState<ModelPhotoProvider>;
  aspectRatio: AspectRatio;
  setAspectRatio: SetState<AspectRatio>;
  prompt: string;
  updatePrompt: (value: string) => void;
  promptEdited: boolean;
  restoreAutoPrompt: () => void;
  promptExpanded: boolean;
  setPromptExpanded: SetState<boolean>;
}

export const useAiIdentityForm = (): AiIdentityFormState => {
  const [sex, setSex] = useState('female');
  const [age, setAge] = useState('25-35');
  const [skin, setSkin] = useState('medium');
  const [hairColor, setHairColor] = useState('brunette');
  const [hairLength, setHairLength] = useState('medium-length');
  const [build, setBuild] = useState('average');
  const [background, setBackground] = useState('pure white seamless backdrop, no shadows');
  const [bokeh, setBokeh] = useState(0);
  const [top, setTop] = useState('plain white t-shirt');
  const [bottom, setBottom] = useState('plain black pants');
  const [footwear, setFootwear] = useState('plain white sneakers');
  const [provider, setProvider] = useState<ModelPhotoProvider>('openai-dalle');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4');
  const [prompt, setPrompt] = useState('');
  const [promptEdited, setPromptEdited] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  useEffect(() => {
    if (!promptEdited) {
      setPrompt(
        buildIdentityPrompt({
          sex,
          age,
          skin,
          hairColor,
          hairLength,
          build,
          background,
          bokeh,
          top,
          bottom,
          footwear,
        }),
      );
    }
  }, [sex, age, skin, hairColor, hairLength, build, background, bokeh, top, bottom, footwear, promptEdited]);

  const handleBokehChange = useCallback((value: number) => {
    setBokeh(value);
    setPromptEdited(false);
  }, []);

  const updatePrompt = useCallback((value: string) => {
    setPrompt(value);
    setPromptEdited(true);
  }, []);

  const restoreAutoPrompt = useCallback(() => setPromptEdited(false), []);

  return {
    sexOptions: SEX_OPTIONS,
    ageOptions: AGE_OPTIONS,
    skinOptions: SKIN_OPTIONS,
    hairColorOptions: HAIR_COLOR_OPTIONS,
    hairLengthOptions: HAIR_LENGTH_OPTIONS,
    buildOptions: BUILD_OPTIONS,
    backgroundOptions: BACKGROUND_OPTIONS,
    topOptions: TOP_OPTIONS,
    bottomOptions: BOTTOM_OPTIONS,
    footwearOptions: FOOTWEAR_OPTIONS,
    aspectOptions: ASPECT_OPTIONS,
    providerOptions: PROVIDER_OPTIONS,
    sex,
    setSex,
    age,
    setAge,
    skin,
    setSkin,
    hairColor,
    setHairColor,
    hairLength,
    setHairLength,
    build,
    setBuild,
    background,
    setBackground,
    bokeh,
    handleBokehChange,
    top,
    setTop,
    bottom,
    setBottom,
    footwear,
    setFootwear,
    provider,
    setProvider,
    aspectRatio,
    setAspectRatio,
    prompt,
    updatePrompt,
    promptEdited,
    restoreAutoPrompt,
    promptExpanded,
    setPromptExpanded,
  };
};
