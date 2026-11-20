import React from 'react';
import { ModelCreateFlowAiState } from '../../../features/models/hooks/useModelCreateFlow';
import { Button } from '../../ui';
import { CandidatePhotoCard } from '../CandidatePhotoCard';

interface AiCandidatesStepProps {
  ai: ModelCreateFlowAiState;
}

export const AiCandidatesStep: React.FC<AiCandidatesStepProps> = ({ ai }) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-gray-700">Elige 1 candidato como modelo base</p>
      {ai.selectedCandidate ? (
        <span className="text-xs font-medium text-emerald-600">Modelo base seleccionado</span>
      ) : null}
    </div>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {ai.candidates.map((photo, index) => (
        <CandidatePhotoCard
          key={`${photo.storagePath}-${index}`}
          storagePath={photo.storagePath}
          index={index}
          isSelected={ai.selectedCandidateIndex === index}
          isRegenerating={ai.regeneratingCandidateIndex === index}
          disabled={ai.busy || ai.identityLocked || ai.selectedProviderDisabled}
          onSelect={() => ai.handleSelectCandidate(index)}
          onRegenerate={() => void ai.handleRegenerateCandidate(index)}
        />
      ))}
    </div>

    {ai.createProgress && <p role="status" aria-live="polite" className="text-sm font-medium text-indigo-700">{ai.createProgress}</p>}
    {ai.createError && <p role="alert" className="text-sm text-red-700">{ai.createError}</p>}
    <div className="flex items-center justify-between pt-2">
      <Button
        type="button"
        variant="ghost"
        size="md"
        disabled={ai.busy || ai.identityLocked}
        onClick={() => void ai.handleStepSelect(1)}
      >
        Reiniciar
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        loading={Boolean(ai.createProgress)}
        disabled={!ai.selectedCandidate || ai.busy}
        onClick={() => void ai.handleCreateFromAI()}
      >
        {ai.createProgress || 'Continuar a Poses'}
      </Button>
    </div>
  </div>
);
