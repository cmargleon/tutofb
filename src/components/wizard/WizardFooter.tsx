import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../ui';

interface WizardFooterProps {
  currentStep: number;
  maxStep: number;
  canAdvance: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onNext: () => void;
}

export const WizardFooter: React.FC<WizardFooterProps> = ({
  currentStep,
  maxStep,
  canAdvance,
  isSubmitting,
  onBack,
  onNext,
}) => (
  <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
    <Button variant="secondary" icon={ArrowLeft} disabled={currentStep === 1 || isSubmitting} onClick={onBack}>
      Volver
    </Button>

    <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">Paso {currentStep} de {maxStep}</span>

    {currentStep < maxStep ? (
      <Button disabled={!canAdvance || isSubmitting} onClick={onNext}>
        Continuar
        <ArrowRight aria-hidden="true" />
      </Button>
    ) : <span aria-hidden="true" />}
  </div>
);
