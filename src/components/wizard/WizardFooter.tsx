import React from 'react';

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
  <div className="mt-8 flex items-center justify-between">
    <button
      type="button"
      disabled={currentStep === 1 || isSubmitting}
      onClick={onBack}
      className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Volver
    </button>

    {currentStep < maxStep ? (
      <button
        type="button"
        disabled={!canAdvance || isSubmitting}
        onClick={onNext}
        className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continuar
      </button>
    ) : null}
  </div>
);
