import { Job, MAX_PHOTO_EDIT_INSTRUCTIONS } from '../../../shared/src/types';

export const validatePhotoEditInstructions = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PHOTO_EDIT_INSTRUCTIONS) {
    throw new Error(`Escribe el cambio que quieres aplicar (máximo ${MAX_PHOTO_EDIT_INSTRUCTIONS} caracteres).`);
  }
  return value.trim();
};

export const buildPhotoEditPrompt = (instructions: string): string =>
  `Edita la imagen de partida aplicando únicamente el cambio solicitado. Conserva todo lo que no se haya pedido cambiar, especialmente la identidad de las personas y los detalles del producto: forma, proporciones, colores, textura, logotipos y textos. Conserva la composición y el encuadre salvo que el cambio lo requiera. No reconstruyas la foto desde otras referencias.\n\nCambio solicitado:\n${instructions}`;

/** Execution-only projection: never write these prompt/reference overrides back to the job. */
export const getPhotoEditExecutionJob = (job: Job): Job => {
  const edit = job.imageEdit;
  if (!edit) return job;
  return {
    ...job,
    provider: edit.provider,
    imageConfig: edit.imageConfig,
    aspectRatio: edit.aspectRatio,
    poseImagePath: edit.sourceImagePath,
    garmentFilePath: edit.sourceImagePath,
    productReferencePaths: [edit.sourceImagePath],
    automationManaged: false,
    photoTask: undefined,
    promptFormat: undefined,
    requestedPromptBase: edit.instructions,
    promptBase: edit.instructions,
    finalPrompt: buildPhotoEditPrompt(edit.instructions),
    autoReviewMaxAttempts: 1,
  };
};
