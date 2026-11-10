import React from 'react';
import { Check } from 'lucide-react';
import { WizardStepDefinition } from '../features/wizard/types';

interface WizardStepperProps {
  steps: WizardStepDefinition[];
  currentStep: number;
  onStepSelect?: (stepId: number) => void;
  canSelectStep?: (stepId: number) => boolean;
}

/** Horizontal step indicator shared by the generation and model wizards. Styles: .tuto-stepper / .tuto-step. */
export const WizardStepper: React.FC<WizardStepperProps> = ({
  steps,
  currentStep,
  onStepSelect,
  canSelectStep,
}) => (
  <nav aria-label="Progreso del asistente" className="mb-6">
    <ol role="list" className="tuto-stepper">
      {steps.map((step, stepIdx) => {
        const state = step.id === currentStep ? 'current' : step.id < currentStep ? 'done' : 'upcoming';
        const caption = state === 'done' ? 'Completado' : state === 'current' ? 'En curso' : `Paso ${stepIdx + 1}`;
        return (
          <li key={step.name} className="flex min-w-0 flex-1">
            <button
              type="button"
              className="tuto-step w-full"
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              onClick={() => onStepSelect?.(step.id)}
              disabled={canSelectStep ? !canSelectStep(step.id) : false}
            >
              <span className="tuto-step-index" aria-hidden="true">{state === 'done' ? <Check /> : stepIdx + 1}</span>
              <span className="min-w-0">
                <span className="tuto-step-label">{step.name}</span>
                <span className="tuto-step-caption">{caption}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  </nav>
);
