import React from 'react';
import { AlertCircle } from 'lucide-react';
import { LoadingBlock, PageHeader } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { ClientModelStep } from '../components/wizard/ClientModelStep';
import { GarmentsStep } from '../components/wizard/GarmentsStep';
import { BatchStep } from '../components/wizard/BatchStep';
import { useWizard } from '../features/generate/hooks/useWizard';

const STEPS = [
  { id: 1, name: 'Cliente y modelo' },
  { id: 2, name: 'Prendas' },
  { id: 3, name: 'Lote' },
];

export const Wizard: React.FC = () => {
  const {
    state,
    clients,
    models,
    loadingData,
    isSubmitting,
    error,
    stepperRef,
    selectedModel,
    allPosesSelected,
    canAdvance,
    totalJobs,
    uploadSummary,
    experimentProviderError,
    experimentProviderOptions,
    submitButtonLabel,
    goToStep,
    handleStepSelect,
    canSelectStep,
    handleFiles,
    removeGarment,
    handleSubmit,
    handleClientChange,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleToggleExperiment,
    handleExperimentModeChange,
    handleExperimentProviderChange,
    handleProviderChange,
    handleAspectRatioChange,
    handlePromptChange,
  } = useWizard();

  if (loadingData) {
    return (
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Generar imágenes"
          description="Configura el lote usando cliente, modelo, prendas y proveedor antes de mandarlo al sistema."
        />
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Generar imágenes"
        description="Replica el flujo operativo del catálogo: eliges cliente y modelo, subes prendas con agrupado automático y generas un trabajo por cada combinación pose-prenda."
      />

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div ref={stepperRef}>
          <WizardStepper
            steps={STEPS}
            currentStep={state.step}
            onStepSelect={handleStepSelect}
            canSelectStep={canSelectStep}
          />
        </div>

        {state.step === 1 && (
          <ClientModelStep
            clients={clients}
            models={models}
            selectedClientId={state.selectedClientId}
            selectedModelId={state.selectedModelId}
            selectedPoseIds={state.selectedPoseIds}
            selectedModel={selectedModel}
            allPosesSelected={allPosesSelected}
            onClientChange={handleClientChange}
            onModelSelect={handleModelSelect}
            onPoseToggle={handlePoseToggle}
            onToggleAllPoses={handleToggleAllPoses}
          />
        )}

        {state.step === 2 && (
          <GarmentsStep
            garments={state.garments}
            isSubmitting={isSubmitting}
            onFiles={handleFiles}
            onRemoveGarment={removeGarment}
          />
        )}

        {state.step === 3 && (
          <BatchStep
            state={state}
            garments={state.garments}
            isSubmitting={isSubmitting}
            totalJobs={totalJobs}
            uploadSummary={uploadSummary}
            experimentProviderError={experimentProviderError}
            experimentProviderOptions={experimentProviderOptions}
            submitButtonLabel={submitButtonLabel}
            onToggleExperiment={handleToggleExperiment}
            onExperimentModeChange={handleExperimentModeChange}
            onExperimentProviderChange={handleExperimentProviderChange}
            onProviderChange={handleProviderChange}
            onAspectRatioChange={handleAspectRatioChange}
            onPromptChange={handlePromptChange}
            onSubmit={handleSubmit}
          />
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            disabled={state.step === 1 || isSubmitting}
            onClick={() => goToStep(state.step - 1)}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Volver
          </button>

          {state.step < 3 && (
            <button
              type="button"
              disabled={!canAdvance || isSubmitting}
              onClick={() => goToStep(state.step + 1)}
              className="rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continuar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
