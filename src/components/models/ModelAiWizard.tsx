import React from 'react';
import { WizardStepper } from '../WizardStepper';
import {
  ModelCreateFlowAiState,
  ModelCreateFlowSharedState,
} from '../../features/models/hooks/useModelCreateFlow';
import { AiCandidatesStep } from './ai-wizard/AiCandidatesStep';
import { AiIdentityStep } from './ai-wizard/AiIdentityStep';
import { AiPosesStep } from './ai-wizard/AiPosesStep';

interface ModelAiWizardProps {
  shared: ModelCreateFlowSharedState;
  ai: ModelCreateFlowAiState;
}

export const ModelAiWizard: React.FC<ModelAiWizardProps> = ({ shared, ai }) => (
  <div className="space-y-6">
    <WizardStepper
      steps={ai.wizardSteps}
      currentStep={ai.wizardStep}
      onStepSelect={(stepId) => void ai.handleStepSelect(stepId)}
      canSelectStep={ai.canSelectStep}
    />

    {ai.wizardStep === 1 ? <AiIdentityStep ai={ai} /> : null}
    {ai.wizardStep === 2 ? <AiCandidatesStep ai={ai} /> : null}
    {ai.wizardStep === 3 && ai.selectedCandidate ? <AiPosesStep shared={shared} ai={ai} /> : null}
  </div>
);
