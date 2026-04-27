import React from 'react';
import { Wand2 } from 'lucide-react';
import { ModelCreateFlowReferenceState } from '../../../features/models/hooks/useReferenceModelFlow';
import { Button } from '../../ui';
import { CandidatePhotoCard } from '../CandidatePhotoCard';

interface ModelReferenceCandidatesSectionProps {
  reference: ModelCreateFlowReferenceState;
}

export const ModelReferenceCandidatesSection: React.FC<ModelReferenceCandidatesSectionProps> = ({
  reference,
}) => (
  <>
    <Button
      type="button"
      variant="secondary"
      size="md"
      loading={reference.generatingCandidates}
      disabled={!reference.canGenerateCandidates}
      onClick={() => void reference.handleGenerateCandidates()}
      className="w-full justify-center"
    >
      <Wand2 className="h-4 w-4" />
      {reference.candidates.length > 0 ? 'Regenerar 4 modelos base' : 'Generar 4 modelos base'}
    </Button>

    {reference.candidates.length > 0 ? (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            Elige 1 modelo base para generar las poses
          </p>
          {reference.selectedCandidate ? (
            <span className="text-xs font-medium text-emerald-600">Modelo base seleccionado</span>
          ) : (
            <span className="text-xs text-gray-500">Selecciona uno para continuar</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {reference.candidates.map((candidate, index) => (
            <CandidatePhotoCard
              key={`${candidate.storagePath}-${index}`}
              storagePath={candidate.storagePath}
              index={index}
              isSelected={reference.selectedCandidateIndex === index}
              isRegenerating={reference.regeneratingCandidateIndex === index}
              disabled={reference.busy || reference.selectedProviderDisabled}
              onSelect={() => reference.handleSelectCandidate(index)}
              onRegenerate={() => void reference.handleRegenerateCandidate(index)}
            />
          ))}
        </div>
      </div>
    ) : null}

    {reference.candidates.length > 0 && !reference.selectedCandidate ? (
      <p className="text-sm text-amber-700">
        Primero elige 1 modelo base de las cuatro opciones generadas.
      </p>
    ) : null}
  </>
);
