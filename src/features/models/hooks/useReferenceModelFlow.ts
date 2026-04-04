import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../../feedback/FeedbackProvider';
import {
  DEFAULT_POSE_SELECTION_IDS,
  IDENTITY_CANDIDATE_COUNT,
  MODEL_POSE_GROUPS,
  MODEL_POSE_RECIPES_BY_ID,
  MODEL_POSE_RECIPES,
  PROVIDER_OPTIONS,
} from '../constants';
import {
  buildPendingPosePhotos,
  getAcceptedPoseCount,
  toCandidatePhotoState,
} from '../aiWizard';
import {
  createDefaultModelProviderImageConfigs,
  mapModelPhotoProviderToProvider,
  resolveModelAspectRatioForImageConfig,
} from '../providerImageConfig';
import {
  createModelFromPaths,
  deleteStorageAsset,
  uploadModelReferenceFile,
} from '../firebase';
import {
  buildReferencePoseBasePrompt,
} from '../prompts';
import { buildManualPoseClassification } from '../poseClassification';
import {
  generateCandidatesApi,
  generatePoseApi,
} from '../referenceGenerationApi';
import {
  GeneratedPhotoState,
  ReferenceBackgroundMode,
  ReferenceClothingMode,
  ReferenceIdentityMode,
} from '../types';
import {
  AspectRatio,
  ModelPhotoProvider,
  Provider,
  ProviderImageConfig,
} from '../../../../shared/src/types';

type SetProviderImageConfig = (config: ProviderImageConfig) => void;

interface UseReferenceModelFlowParams {
  newModelName: string;
  selectedClientId: string;
  setNewModelName: (value: string) => void;
  setSelectedClientId: (value: string) => void;
  onSuccess: () => void;
}

interface UploadedReferenceState {
  storagePath: string;
  contentType: string;
  fileSignature: string;
}

const buildFileSignature = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;
const POSE_GENERATION_DELAY_MS = 350;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ModelCreateFlowReferenceState {
  referenceFile: File | null;
  providerOptions: typeof PROVIDER_OPTIONS;
  provider: ModelPhotoProvider;
  setProvider: (provider: ModelPhotoProvider) => void;
  providerImageConfigs: Record<Provider, ProviderImageConfig>;
  providerImageConfig: ProviderImageConfig;
  setProviderImageConfig: SetProviderImageConfig;
  aspectRatio: AspectRatio;
  identityMode: ReferenceIdentityMode;
  setIdentityMode: (mode: ReferenceIdentityMode) => void;
  backgroundMode: ReferenceBackgroundMode;
  setBackgroundMode: (mode: ReferenceBackgroundMode) => void;
  backgroundPrompt: string;
  setBackgroundPrompt: (value: string) => void;
  clothingMode: ReferenceClothingMode;
  setClothingMode: (mode: ReferenceClothingMode) => void;
  clothingPrompt: string;
  setClothingPrompt: (value: string) => void;
  prompt: string;
  updatePrompt: (value: string) => void;
  promptEdited: boolean;
  restoreAutoPrompt: () => void;
  promptExpanded: boolean;
  setPromptExpanded: Dispatch<SetStateAction<boolean>>;
  candidates: GeneratedPhotoState[];
  selectedCandidateIndex: number | null;
  selectedCandidate: GeneratedPhotoState | null;
  generatingCandidates: boolean;
  regeneratingCandidateIndex: number | null;
  canGenerateCandidates: boolean;
  handleGenerateCandidates: () => Promise<void>;
  handleSelectCandidate: (index: number) => void;
  handleRegenerateCandidate: (index: number) => Promise<void>;
  posePhotos: GeneratedPhotoState[];
  selectedPoseIds: string[];
  selectedPoseRecipes: typeof MODEL_POSE_RECIPES;
  generatingPoses: boolean;
  regeneratingPoseIndex: number | null;
  acceptedPoseCount: number;
  allPosesSelected: boolean;
  canGeneratePoses: boolean;
  canSaveModel: boolean;
  busy: boolean;
  poseGroups: typeof MODEL_POSE_GROUPS;
  poseRecipes: typeof MODEL_POSE_RECIPES;
  handleReferenceFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleRemoveReferenceFile: () => Promise<void>;
  handleTogglePose: (poseId: string) => void;
  handleToggleAllPoses: () => void;
  handleGeneratePoseSet: () => Promise<void>;
  handleRegeneratePose: (index: number) => Promise<void>;
  handleRejectPose: (index: number) => void;
  handleAcceptPose: (index: number) => void;
  handleAcceptAllPoses: () => void;
  handleCreateFromReference: () => Promise<void>;
}

export interface UseReferenceModelFlowResult {
  reference: ModelCreateFlowReferenceState;
  isCreating: boolean;
  error: string | null;
}

export const useReferenceModelFlow = ({
  newModelName,
  selectedClientId,
  setNewModelName,
  setSelectedClientId,
  onSuccess,
}: UseReferenceModelFlowParams): UseReferenceModelFlowResult => {
  const toast = useToast();
  const [draftModelId] = useState(() => uuidv4());
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [uploadedReference, setUploadedReference] = useState<UploadedReferenceState | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProviderState] = useState<ModelPhotoProvider>('openai-dalle');
  const [providerImageConfigs, setProviderImageConfigs] = useState<Record<Provider, ProviderImageConfig>>(
    createDefaultModelProviderImageConfigs,
  );
  const [identityMode, setIdentityModeState] = useState<ReferenceIdentityMode>('exact');
  const [backgroundMode, setBackgroundModeState] = useState<ReferenceBackgroundMode>('preserve');
  const [backgroundPrompt, setBackgroundPromptState] = useState('');
  const [clothingMode, setClothingModeState] = useState<ReferenceClothingMode>('preserve');
  const [clothingPrompt, setClothingPromptState] = useState('');
  const [prompt, setPrompt] = useState('');
  const [promptEdited, setPromptEdited] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [candidates, setCandidates] = useState<GeneratedPhotoState[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [regeneratingCandidateIndex, setRegeneratingCandidateIndex] = useState<number | null>(null);
  const [posePhotos, setPosePhotos] = useState<GeneratedPhotoState[]>([]);
  const [selectedPoseIds, setSelectedPoseIds] = useState<string[]>(DEFAULT_POSE_SELECTION_IDS);
  const [generatingPoses, setGeneratingPoses] = useState(false);
  const [regeneratingPoseIndex, setRegeneratingPoseIndex] = useState<number | null>(null);
  const previousClientIdRef = useRef(selectedClientId);

  const mappedProvider = mapModelPhotoProviderToProvider(provider);
  const providerImageConfig = providerImageConfigs[mappedProvider];
  const aspectRatio = resolveModelAspectRatioForImageConfig(providerImageConfig);

  useEffect(() => {
    if (!promptEdited) {
      setPrompt(
        buildReferencePoseBasePrompt({
          identityMode,
          backgroundMode,
          backgroundPrompt,
          clothingMode,
          clothingPrompt,
        }),
      );
    }
  }, [backgroundMode, backgroundPrompt, clothingMode, clothingPrompt, identityMode, promptEdited]);

  const selectedCandidate = useMemo(() => {
    if (identityMode === 'exact') {
      return uploadedReference ? toCandidatePhotoState(uploadedReference) : null;
    }

    return selectedCandidateIndex !== null ? candidates[selectedCandidateIndex] ?? null : null;
  }, [candidates, identityMode, selectedCandidateIndex, uploadedReference]);

  const selectedPoseRecipes = useMemo(
    () => MODEL_POSE_RECIPES.filter((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  ) as typeof MODEL_POSE_RECIPES;

  const acceptedPoseCount = useMemo(() => getAcceptedPoseCount(posePhotos), [posePhotos]);

  const allPosesSelected = useMemo(
    () => MODEL_POSE_RECIPES.every((recipe) => selectedPoseIds.includes(recipe.id)),
    [selectedPoseIds],
  );

  const clearGeneratedPoses = useCallback(() => {
    setPosePhotos([]);
    setRegeneratingPoseIndex(null);
  }, []);

  const clearCandidatesAndPoses = useCallback(() => {
    setCandidates([]);
    setSelectedCandidateIndex(null);
    setRegeneratingCandidateIndex(null);
    clearGeneratedPoses();
  }, [clearGeneratedPoses]);

  const cleanupUploadedReference = useCallback(async (storagePath: string | null | undefined) => {
    if (!storagePath) return;
    try {
      await deleteStorageAsset(storagePath);
    } catch (cleanupError) {
      console.error('No se pudo limpiar la referencia temporal:', cleanupError);
    }
  }, []);

  useEffect(() => {
    if (previousClientIdRef.current === selectedClientId) {
      return;
    }

    const previousReferencePath = uploadedReference?.storagePath || null;
    setUploadedReference(null);
    clearCandidatesAndPoses();
    setError(null);
    previousClientIdRef.current = selectedClientId;

    if (previousReferencePath) {
      void cleanupUploadedReference(previousReferencePath);
    }
  }, [cleanupUploadedReference, clearCandidatesAndPoses, selectedClientId, uploadedReference]);

  const ensureReferenceUploaded = useCallback(async (): Promise<UploadedReferenceState> => {
    if (!referenceFile || !selectedClientId) {
      throw new Error('Sube una foto base y selecciona un cliente antes de continuar.');
    }

    const fileSignature = buildFileSignature(referenceFile);
    if (uploadedReference && uploadedReference.fileSignature === fileSignature) {
      return uploadedReference;
    }

    setIsUploadingReference(true);
    setError(null);
    try {
      const uploaded = await uploadModelReferenceFile(selectedClientId, draftModelId, referenceFile);
      const nextReference = {
        ...uploaded,
        fileSignature,
      };
      if (uploadedReference?.storagePath && uploadedReference.storagePath !== uploaded.storagePath) {
        void cleanupUploadedReference(uploadedReference.storagePath);
      }
      setUploadedReference(nextReference);
      return nextReference;
    } catch (uploadError: any) {
      const message = uploadError?.message || 'No se pudo subir la foto de referencia.';
      setError(message);
      throw new Error(message);
    } finally {
      setIsUploadingReference(false);
    }
  }, [
    cleanupUploadedReference,
    draftModelId,
    referenceFile,
    selectedClientId,
    uploadedReference,
  ]);

  const canGenerateCandidates = Boolean(
    identityMode !== 'exact'
      && referenceFile
      && selectedClientId
      && prompt.trim()
      && !generatingCandidates
      && regeneratingCandidateIndex === null
      && !isUploadingReference,
  );

  const canGeneratePoses = Boolean(
    (identityMode === 'exact'
      ? Boolean(referenceFile && selectedClientId)
      : Boolean(selectedCandidate))
      && selectedPoseRecipes.length > 0
      && !generatingPoses
      && regeneratingPoseIndex === null
      && !isUploadingReference,
  );

  const canSaveModel = Boolean(
    acceptedPoseCount > 0 && newModelName.trim() && selectedClientId,
  );

  const busy = (
    generatingCandidates
    || regeneratingCandidateIndex !== null
    || generatingPoses
    || regeneratingPoseIndex !== null
    || isCreating
    || isUploadingReference
  );

  const setProvider = useCallback((nextProvider: ModelPhotoProvider) => {
    setProviderState(nextProvider);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setProviderImageConfig = useCallback((config: ProviderImageConfig) => {
    setProviderImageConfigs((current) => ({
      ...current,
      [config.provider]: config,
    }));
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setIdentityMode = useCallback((mode: ReferenceIdentityMode) => {
    setIdentityModeState(mode);
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setBackgroundMode = useCallback((mode: ReferenceBackgroundMode) => {
    setBackgroundModeState(mode);
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setBackgroundPrompt = useCallback((value: string) => {
    setBackgroundPromptState(value);
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setClothingMode = useCallback((mode: ReferenceClothingMode) => {
    setClothingModeState(mode);
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const setClothingPrompt = useCallback((value: string) => {
    setClothingPromptState(value);
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const updatePrompt = useCallback((value: string) => {
    setPrompt(value);
    setPromptEdited(true);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const restoreAutoPrompt = useCallback(() => {
    setPromptEdited(false);
    clearCandidatesAndPoses();
  }, [clearCandidatesAndPoses]);

  const handleReferenceFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    if (!nextFile) return;

    const previousReferencePath = uploadedReference?.storagePath || null;
    setReferenceFile(nextFile);
    setUploadedReference(null);
    setError(null);
    clearCandidatesAndPoses();
    setSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);
    if (event.target) {
      event.target.value = '';
    }

    if (previousReferencePath) {
      await cleanupUploadedReference(previousReferencePath);
    }
  }, [cleanupUploadedReference, clearCandidatesAndPoses, uploadedReference]);

  const handleRemoveReferenceFile = useCallback(async () => {
    const previousReferencePath = uploadedReference?.storagePath || null;
    setReferenceFile(null);
    setUploadedReference(null);
    setError(null);
    clearCandidatesAndPoses();
    setSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);

    if (previousReferencePath) {
      await cleanupUploadedReference(previousReferencePath);
    }
  }, [cleanupUploadedReference, clearCandidatesAndPoses, uploadedReference]);

  const generateCandidates = useCallback(async (
    count: number,
  ): Promise<GeneratedPhotoState[]> => {
    const reference = await ensureReferenceUploaded();
    const result = await generateCandidatesApi({
      prompt: prompt.trim(),
      provider,
      aspectRatio,
      providerImageConfig,
      count,
      clientId: selectedClientId,
      modelId: draftModelId,
      identityMode,
      referenceStoragePath: reference.storagePath,
    });

    if (result.errors.length > 0) {
      toast({
        tone: 'warning',
        title: `${result.errors.length} modelo(s) no se pudieron generar`,
        description: result.errors[0]?.message ?? 'Error desconocido',
      });
    }

    return result.photos;
  }, [
    aspectRatio,
    draftModelId,
    ensureReferenceUploaded,
    identityMode,
    prompt,
    provider,
    providerImageConfig,
    selectedClientId,
    toast,
  ]);

  const handleGenerateCandidates = useCallback(async () => {
    if (!canGenerateCandidates) return;

    setGeneratingCandidates(true);
    setError(null);
    clearCandidatesAndPoses();

    try {
      const nextCandidates = await generateCandidates(IDENTITY_CANDIDATE_COUNT);
      setCandidates(nextCandidates);
    } catch (generationError: any) {
      toast({
        tone: 'error',
        title: 'Error al generar los modelos base',
        description: generationError?.message || 'Inténtalo de nuevo.',
      });
    } finally {
      setGeneratingCandidates(false);
    }
  }, [canGenerateCandidates, clearCandidatesAndPoses, generateCandidates, toast]);

  const handleSelectCandidate = useCallback((index: number) => {
    setSelectedCandidateIndex(index);
    clearGeneratedPoses();
  }, [clearGeneratedPoses]);

  const handleRegenerateCandidate = useCallback(async (index: number) => {
    if (!referenceFile) return;

    setRegeneratingCandidateIndex(index);
    setError(null);
    try {
      const regenerated = await generateCandidates(1);
      const nextCandidate = regenerated[0];
      if (!nextCandidate) return;

      setCandidates((prev) =>
        prev.map((candidate, candidateIndex) =>
          candidateIndex === index ? nextCandidate : candidate,
        ),
      );
      if (selectedCandidateIndex === index) {
        clearGeneratedPoses();
      }
    } catch (regenerationError: any) {
      toast({
        tone: 'error',
        title: 'Error al regenerar el modelo base',
        description: regenerationError?.message || 'Inténtalo de nuevo.',
      });
    } finally {
      setRegeneratingCandidateIndex(null);
    }
  }, [
    clearGeneratedPoses,
    generateCandidates,
    referenceFile,
    selectedCandidateIndex,
    toast,
  ]);

  const handleTogglePose = useCallback((poseId: string) => {
    setSelectedPoseIds((current) => {
      if (current.includes(poseId)) return current.filter((id) => id !== poseId);
      return [...current, poseId];
    });
    clearGeneratedPoses();
  }, [clearGeneratedPoses]);

  const handleToggleAllPoses = useCallback(() => {
    const allPoseIds = MODEL_POSE_RECIPES.map((recipe) => recipe.id);
    setSelectedPoseIds((current) =>
      MODEL_POSE_RECIPES.every((recipe) => current.includes(recipe.id))
        ? DEFAULT_POSE_SELECTION_IDS
        : allPoseIds,
    );
    clearGeneratedPoses();
  }, [clearGeneratedPoses]);

  const generatePoseFromCandidate = useCallback(async (
    poseIndex: number,
    candidate: GeneratedPhotoState,
    poseId: string,
  ) => {
    const photo = await generatePoseApi({
      prompt: prompt.trim(),
      provider,
      aspectRatio,
      providerImageConfig,
      clientId: selectedClientId,
      modelId: draftModelId,
      candidate,
      poseId,
    });

    if (!photo) return;

    setPosePhotos((prev) =>
      prev.map((prevPhoto, photoIndex) =>
        photoIndex === poseIndex ? photo : prevPhoto,
      ),
    );
  }, [
    aspectRatio,
    draftModelId,
    prompt,
    provider,
    providerImageConfig,
    selectedClientId,
  ]);

  const handleGeneratePoseSet = useCallback(async () => {
    if (!canGeneratePoses) return;

    setGeneratingPoses(true);
    setError(null);
    setPosePhotos(buildPendingPosePhotos(selectedPoseRecipes));

    try {
      const baseCandidate = selectedCandidate
        ?? (identityMode === 'exact' ? toCandidatePhotoState(await ensureReferenceUploaded()) : null);
      if (!baseCandidate) return;

      for (const [index, pose] of selectedPoseRecipes.entries()) {
        try {
          await generatePoseFromCandidate(index, baseCandidate, pose.id);
        } catch {
          setPosePhotos((prev) =>
            prev.map((photo, photoIndex) =>
              photoIndex === index
                ? { ...photo, loading: false, error: true, rejected: true }
                : photo,
            ),
          );
        }

        if (index < selectedPoseRecipes.length - 1) {
          await sleep(POSE_GENERATION_DELAY_MS);
        }
      }
    } finally {
      setGeneratingPoses(false);
    }
  }, [
    canGeneratePoses,
    ensureReferenceUploaded,
    generatePoseFromCandidate,
    identityMode,
    selectedCandidate,
    selectedPoseRecipes,
  ]);

  const handleRegeneratePose = useCallback(async (index: number) => {
    if (!selectedCandidate) return;

    const poseRecipe = selectedPoseRecipes[index];
    if (!poseRecipe || poseRecipe.usesReferenceImage) return;

    setRegeneratingPoseIndex(index);
    try {
      await generatePoseFromCandidate(index, selectedCandidate, poseRecipe.id);
    } catch (regenerationError: any) {
      toast({
        tone: 'error',
        title: 'Error al regenerar la pose',
        description: regenerationError?.message || 'Inténtalo de nuevo.',
      });
    } finally {
      setRegeneratingPoseIndex(null);
    }
  }, [
    generatePoseFromCandidate,
    selectedCandidate,
    selectedPoseRecipes,
    toast,
  ]);

  const handleRejectPose = useCallback((index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: true } : photo,
      ),
    );
  }, []);

  const handleAcceptPose = useCallback((index: number) => {
    setPosePhotos((prev) =>
      prev.map((photo, photoIndex) =>
        photoIndex === index ? { ...photo, rejected: false } : photo,
      ),
    );
  }, []);

  const handleAcceptAllPoses = useCallback(() => {
    setPosePhotos((prev) => prev.map((photo) => ({ ...photo, rejected: false })));
  }, []);

  const handleCreateFromReference = useCallback(async () => {
    const trimmedName = newModelName.trim();
    if (!trimmedName || !selectedClientId) return;

    const accepted = posePhotos
      .filter((photo) => !photo.rejected && !photo.loading)
      .map((photo) => {
        const recipe = photo.poseRecipeId
          ? MODEL_POSE_RECIPES_BY_ID.get(photo.poseRecipeId)
          : undefined;

        return {
          storagePath: photo.storagePath,
          contentType: photo.contentType,
          aiClassification: recipe ? buildManualPoseClassification(recipe) : null,
        };
      });

    if (accepted.length === 0) {
      toast({
        tone: 'warning',
        title: 'Sin fotos aceptadas',
        description: 'Acepta al menos una pose antes de guardar el modelo.',
      });
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      await createModelFromPaths(selectedClientId, trimmedName, accepted, {
        modelId: draftModelId,
      });

      const acceptedPaths = new Set(accepted.map((photo) => photo.storagePath));
      if (uploadedReference?.storagePath && !acceptedPaths.has(uploadedReference.storagePath)) {
        void cleanupUploadedReference(uploadedReference.storagePath);
      }

      setNewModelName('');
      setSelectedClientId('');
      setReferenceFile(null);
      setUploadedReference(null);
      setCandidates([]);
      setSelectedCandidateIndex(null);
      setPosePhotos([]);
      setSelectedPoseIds(DEFAULT_POSE_SELECTION_IDS);
      setPromptEdited(false);
      setBackgroundPromptState('');
      setClothingPromptState('');
      setBackgroundModeState('preserve');
      setClothingModeState('preserve');
      setIdentityModeState('exact');
      onSuccess();
    } catch (createError: any) {
      const message = createError?.message || 'No se pudo guardar el modelo.';
      setError(message);
      toast({
        tone: 'error',
        title: 'Error al guardar el modelo',
        description: message,
      });
    } finally {
      setIsCreating(false);
    }
  }, [
    cleanupUploadedReference,
    draftModelId,
    newModelName,
    onSuccess,
    posePhotos,
    selectedClientId,
    setNewModelName,
    setSelectedClientId,
    toast,
    uploadedReference,
  ]);

  return {
    isCreating,
    error,
    reference: {
      referenceFile,
      providerOptions: PROVIDER_OPTIONS,
      provider,
      setProvider,
      providerImageConfigs,
      providerImageConfig,
      setProviderImageConfig,
      aspectRatio,
      identityMode,
      setIdentityMode,
      backgroundMode,
      setBackgroundMode,
      backgroundPrompt,
      setBackgroundPrompt,
      clothingMode,
      setClothingMode,
      clothingPrompt,
      setClothingPrompt,
      prompt,
      updatePrompt,
      promptEdited,
      restoreAutoPrompt,
      promptExpanded,
      setPromptExpanded,
      candidates,
      selectedCandidateIndex,
      selectedCandidate,
      generatingCandidates,
      regeneratingCandidateIndex,
      canGenerateCandidates,
      handleGenerateCandidates,
      handleSelectCandidate,
      handleRegenerateCandidate,
      posePhotos,
      selectedPoseIds,
      selectedPoseRecipes,
      generatingPoses,
      regeneratingPoseIndex,
      acceptedPoseCount,
      allPosesSelected,
      canGeneratePoses,
      canSaveModel,
      busy,
      poseGroups: MODEL_POSE_GROUPS,
      poseRecipes: MODEL_POSE_RECIPES,
      handleReferenceFileChange,
      handleRemoveReferenceFile,
      handleTogglePose,
      handleToggleAllPoses,
      handleGeneratePoseSet,
      handleRegeneratePose,
      handleRejectPose,
      handleAcceptPose,
      handleAcceptAllPoses,
      handleCreateFromReference,
    },
  };
};
