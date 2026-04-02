import React from 'react';
import {
  ModelCreateFlowReferenceState,
  ModelCreateFlowSharedState,
} from '../../features/models/hooks/useModelCreateFlow';
import { ModelReferenceUploadSection } from './reference/ModelReferenceUploadSection';
import { ModelReferenceOptionsSection } from './reference/ModelReferenceOptionsSection';
import { ModelReferenceCandidatesSection } from './reference/ModelReferenceCandidatesSection';
import { ModelReferencePosesSection } from './reference/ModelReferencePosesSection';

interface ModelReferenceFormProps {
  shared: ModelCreateFlowSharedState;
  reference: ModelCreateFlowReferenceState;
}

export const ModelReferenceForm: React.FC<ModelReferenceFormProps> = ({ shared, reference }) => (
  <div className="space-y-5">
    <ModelReferenceUploadSection
      referenceFile={reference.referenceFile}
      busy={reference.busy}
      onFileChange={(event) => void reference.handleReferenceFileChange(event)}
      onRemove={() => void reference.handleRemoveReferenceFile()}
    />

    <ModelReferenceOptionsSection reference={reference} />

    {reference.identityMode === 'similar' ? (
      <ModelReferenceCandidatesSection reference={reference} />
    ) : (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        En modo <strong>Igual</strong>, la foto de referencia se usa directamente como modelo base. Puedes ir
        directo a elegir las poses.
      </div>
    )}

    {(reference.identityMode === 'exact' || reference.selectedCandidate) ? (
      <ModelReferencePosesSection reference={reference} shared={shared} />
    ) : null}
  </div>
);
