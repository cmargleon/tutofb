export interface CanSelectWizardStepOptions {
  targetStep: number;
  currentStep: number;
  maxStep: number;
  isBusy?: boolean;
  isStepComplete: (stepId: number) => boolean;
}

export const clampWizardStep = (step: number, minStep: number, maxStep: number): number =>
  Math.min(maxStep, Math.max(minStep, step));

export const canSelectWizardStep = ({
  targetStep,
  currentStep,
  maxStep,
  isBusy = false,
  isStepComplete,
}: CanSelectWizardStepOptions): boolean => {
  const nextStep = clampWizardStep(targetStep, 1, maxStep);

  if (isBusy && nextStep !== currentStep) {
    return false;
  }

  if (nextStep <= currentStep) {
    return true;
  }

  for (let stepId = 1; stepId < nextStep; stepId += 1) {
    if (!isStepComplete(stepId)) {
      return false;
    }
  }

  return true;
};
