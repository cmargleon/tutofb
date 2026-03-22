import React from 'react';
import { Check } from 'lucide-react';
import { WizardStepDefinition } from '../features/wizard/types';

interface WizardStepperProps {
  steps: WizardStepDefinition[];
  currentStep: number;
  onStepSelect?: (stepId: number) => void;
  canSelectStep?: (stepId: number) => boolean;
}

export const WizardStepper: React.FC<WizardStepperProps> = ({
  steps,
  currentStep,
  onStepSelect,
  canSelectStep,
}) => {
  const gridTemplateColumns = `repeat(${steps.length}, minmax(0, 1fr))`;

  return (
    <nav aria-label="Progress" className="mb-8">
      <ol role="list" className="grid items-start gap-0" style={{ gridTemplateColumns }}>
        {steps.map((step, stepIdx) => (
          <li key={step.name} className="relative">
            {stepIdx !== steps.length - 1 ? (
              <div className="pointer-events-none absolute left-1/2 top-4 h-0.5 w-full -translate-y-1/2 bg-gray-200" aria-hidden="true">
                <div
                  className={`h-full transition-all ${
                    step.id < currentStep ? 'w-full bg-indigo-600' : 'w-0 bg-indigo-600'
                  }`}
                />
              </div>
            ) : null}

            <div className="relative z-10 flex flex-col items-center px-2 text-center">
              {step.id < currentStep ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(step.id)}
                  disabled={canSelectStep ? !canSelectStep(step.id) : false}
                  className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-indigo-600 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                >
                  <Check className="h-5 w-5 text-white" aria-hidden="true" />
                  <span className="sr-only">{step.name}</span>
                </button>
              ) : step.id === currentStep ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(step.id)}
                  disabled={canSelectStep ? !canSelectStep(step.id) : false}
                  className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-indigo-600 bg-white disabled:cursor-not-allowed"
                  aria-current="step"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" aria-hidden="true" />
                  <span className="sr-only">{step.name}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(step.id)}
                  disabled={canSelectStep ? !canSelectStep(step.id) : false}
                  className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-gray-300 bg-white transition enabled:hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-transparent" aria-hidden="true" />
                  <span className="sr-only">{step.name}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onStepSelect?.(step.id)}
                disabled={canSelectStep ? !canSelectStep(step.id) : false}
                className="mt-3 cursor-pointer text-center text-xs font-medium text-gray-500 transition enabled:hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              >
                {step.name}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
};
