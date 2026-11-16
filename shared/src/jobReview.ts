import type { Job, JobRejectionReason, JobOutput } from './types';

export const JOB_REJECTION_OPTIONS: Record<JobRejectionReason, { label: string; correction: string }> = {
  incorrect_color: { label: 'Color incorrecto', correction: 'Iguala el color y el tono del artículo a las referencias originales, sin teñirlo con la iluminación de la escena.' },
  altered_shape: { label: 'Forma o proporciones alteradas', correction: 'Respeta la silueta, las proporciones y la construcción del artículo de referencia.' },
  incorrect_logo_text: { label: 'Logo o texto incorrecto', correction: 'Reproduce fielmente el logo y el texto visibles, con su ubicación, tamaño y orientación originales. No inventes inscripciones.' },
  lost_texture_details: { label: 'Pérdida de textura o detalles', correction: 'Conserva la textura y los detalles visibles del material, incluidas costuras, acabados y herrajes cuando corresponda.' },
  framing: { label: 'Encuadre', correction: 'Ajusta el encuadre dentro de la composición prevista para que el artículo y los detalles relevantes queden visibles.' },
  other: { label: 'Otros', correction: 'Corrige el defecto indicado por el operador sin cambiar la identidad del artículo.' },
};

export const buildReviewCorrection = (reasons: JobRejectionReason[], note?: string | null): string =>
  [...reasons.map((reason) => JOB_REJECTION_OPTIONS[reason].correction), note?.trim()].filter(Boolean).join('\n');

export const getJobReviewReferencePaths = (job: Job): string[] => [...new Set([
  ...(job.photoTask?.referencePaths || []),
  ...(job.photoTask ? [] : job.productReferencePaths || []),
  job.garmentFilePath,
  ...(job.garmentReferencePaths || []),
  ...(job.automationReferencePaths || []),
].filter((path): path is string => typeof path === 'string' && Boolean(path.trim())))];

export const getApprovedReviewOutput = (job: Job): JobOutput | null =>
  job.userSelectedOutput || job.retainedApprovedOutput
  || (job.currentOutput?.autoReview?.verdict === 'approved' ? job.currentOutput : null);

export const getJobRegenerationBasePrompt = (job: Job): string =>
  (job.generationKind === 'product' ? job.requestedPromptBase : null) || job.promptBase || job.finalPrompt || '';

export const needsLegacyJobReviewReferences = (job: Job): boolean =>
  !job.photoTask && !job.productReferencePaths && !job.automationReferencePaths && !job.garmentReferencePaths;

export const jobReviewReferenceAsset = (jobId: string, storagePath: string): string =>
  `review-reference/${jobId}/${storagePath}`;
