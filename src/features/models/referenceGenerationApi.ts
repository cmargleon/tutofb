import { v4 as uuidv4 } from 'uuid';
import { generateModelPoses } from './firebase';
import { buildReferenceCandidatePrompt, buildReferencePosePrompt } from './prompts';
import {
  buildGeneratedPosePhotoState,
  buildReferencePosePhotoState,
  toCandidatePhotoState,
} from './aiWizard';
import { MODEL_POSE_RECIPES } from './constants';
import { GeneratedPhotoState } from './types';
import { AspectRatio, ModelPhotoProvider, ProviderImageConfig } from '../../../shared/src/types';

export interface GenerateCandidatesParams {
  prompt: string;
  provider: ModelPhotoProvider;
  aspectRatio: AspectRatio;
  providerImageConfig: ProviderImageConfig;
  count: number;
  clientId: string;
  modelId: string;
  identityMode: 'exact' | 'similar';
  referenceStoragePath: string;
}

export interface GenerateCandidatesResult {
  photos: GeneratedPhotoState[];
  errors: Array<{ message?: string }>;
}

export const generateCandidatesApi = async (
  params: GenerateCandidatesParams,
): Promise<GenerateCandidatesResult> => {
  const response = await generateModelPoses({
    prompt: buildReferenceCandidatePrompt(params.prompt),
    provider: params.provider,
    aspectRatio: params.aspectRatio,
    imageConfig: params.providerImageConfig,
    count: params.count,
    tempSessionId: uuidv4(),
    clientId: params.clientId,
    modelId: params.modelId,
    stage: 'identity',
    referenceStoragePath: params.referenceStoragePath,
    preserveReferenceDetails: params.identityMode === 'exact',
  });

  return {
    photos: response.photos.map(toCandidatePhotoState),
    errors: response.errors,
  };
};

export interface GeneratePoseParams {
  prompt: string;
  provider: ModelPhotoProvider;
  aspectRatio: AspectRatio;
  providerImageConfig: ProviderImageConfig;
  clientId: string;
  modelId: string;
  candidate: GeneratedPhotoState;
  poseId: string;
}

export const generatePoseApi = async (
  params: GeneratePoseParams,
): Promise<GeneratedPhotoState | null> => {
  const poseRecipe = MODEL_POSE_RECIPES.find((recipe) => recipe.id === params.poseId);
  if (!poseRecipe) return null;

  if (poseRecipe.usesReferenceImage) {
    return buildReferencePosePhotoState(params.candidate, poseRecipe);
  }

  const response = await generateModelPoses({
    prompt: buildReferencePosePrompt(params.prompt, poseRecipe.shotType),
    provider: params.provider,
    aspectRatio: params.aspectRatio,
    imageConfig: params.providerImageConfig,
    count: 1,
    tempSessionId: uuidv4(),
    clientId: params.clientId,
    modelId: params.modelId,
    stage: 'pose',
    referenceStoragePath: params.candidate.storagePath,
    preserveReferenceDetails: true,
  });

  const photo = response.photos[0];
  return buildGeneratedPosePhotoState(photo, poseRecipe);
};
