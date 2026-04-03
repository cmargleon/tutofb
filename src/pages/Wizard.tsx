import React, { useEffect, useRef } from 'react';
import { LoadingBlock, PageHeader } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { WizardFooter } from '../components/wizard/WizardFooter';
import { ClientModelStep } from '../components/wizard/ClientModelStep';
import { GarmentsStep } from '../components/wizard/GarmentsStep';
import { PoseSelectionStep } from '../components/wizard/PoseSelectionStep';
import { BatchStep } from '../components/wizard/BatchStep';
import { useToast } from '../features/feedback/FeedbackProvider';
import { useWizard } from '../features/generate/hooks/useWizard';
import { GENERATE_WIZARD_MAX_STEP, GENERATE_WIZARD_STEPS } from '../features/generate/wizard/state';

export const Wizard: React.FC = () => {
  const toast = useToast();
  const lastErrorRef = useRef<string | null>(null);
  const {
    state,
    clients,
    models,
    spreadsheetTemplates,
    spreadsheetCategories,
    loadingData,
    isSubmitting,
    error,
    stepperRef,
    selectedModel,
    allPosesSelected,
    canAdvance,
    totalJobs,
    uploadSummary,
    promptSourceLabel,
    submitButtonLabel,
    disabledProviders,
    goToStep,
    handleStepSelect,
    canSelectStep,
    handleFiles,
    removeGarment,
    handleSubmit,
    handleClientChange,
    handleOutputModeChange,
    handleSpreadsheetTemplateChange,
    handleSpreadsheetCategoryChange,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleProviderChange,
    handleProviderImageConfigChange,
    handlePromptChange,
    handleRetryPoseSuggestions,
    handleRetryProductDraftPreparation,
  } = useWizard();
  const isWizardBusy = isSubmitting || state.poseSuggestions.status === 'preparing';

  useEffect(() => {
    if (!error) {
      lastErrorRef.current = null;
      return;
    }

    if (lastErrorRef.current === error) {
      return;
    }

    lastErrorRef.current = error;
    toast({
      tone: 'error',
      title: 'No pudimos continuar',
      description: error,
      durationMs: 6500,
    });
  }, [error, toast]);

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
        description="Replica el flujo operativo del catálogo: eliges cliente y modelo, subes prendas, confirmas las poses sugeridas y generas un trabajo por cada combinación compatible pose-prenda."
      />

      <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-6 shadow-sm">
        <div ref={stepperRef}>
          <WizardStepper
            steps={GENERATE_WIZARD_STEPS}
            currentStep={state.step}
            onStepSelect={handleStepSelect}
            canSelectStep={canSelectStep}
          />
        </div>

        {state.step === 1 && (
          <ClientModelStep
            clients={clients}
            models={models}
            spreadsheetTemplates={spreadsheetTemplates}
            spreadsheetCategories={spreadsheetCategories}
            selectedClientId={state.selectedClientId}
            selectedModelId={state.selectedModelId}
            outputMode={state.outputMode}
            selectedSpreadsheetTemplateId={state.selectedSpreadsheetTemplateId}
            selectedSpreadsheetCategoryId={state.selectedSpreadsheetCategoryId}
            onClientChange={handleClientChange}
            onOutputModeChange={handleOutputModeChange}
            onSpreadsheetTemplateChange={handleSpreadsheetTemplateChange}
            onSpreadsheetCategoryChange={handleSpreadsheetCategoryChange}
            onModelSelect={handleModelSelect}
          />
        )}

        {state.step === 2 && (
          <GarmentsStep
            garments={state.garments}
            isSubmitting={isWizardBusy}
            onFiles={handleFiles}
            onRemoveGarment={removeGarment}
          />
        )}

        {state.step === 3 && (
          <PoseSelectionStep
            selectedModel={selectedModel}
            garments={state.garments}
            selectedPoseIds={state.selectedPoseIds}
            suggestedPoseIds={state.poseSuggestions.suggestedPoseIds}
            allPosesSelected={allPosesSelected}
            isPreparing={state.poseSuggestions.status === 'preparing'}
            suggestionError={state.poseSuggestions.error}
            missingPoseClassificationCount={state.poseSuggestions.missingPoseClassificationCount}
            onPoseToggle={handlePoseToggle}
            onToggleAllPoses={handleToggleAllPoses}
            onRetrySuggestions={handleRetryPoseSuggestions}
          />
        )}

        {state.step === 4 && (
          <BatchStep
            state={state}
            garments={state.garments}
            isSubmitting={isWizardBusy}
            totalJobs={totalJobs}
            uploadSummary={uploadSummary}
            promptSourceLabel={promptSourceLabel}
            submitButtonLabel={submitButtonLabel}
            disabledProviders={disabledProviders}
            productDraftPreparationStatus={state.productDraftPreparation.status}
            productDraftPreparationError={state.productDraftPreparation.error}
            onRetryProductDraftPreparation={handleRetryProductDraftPreparation}
            onProviderChange={handleProviderChange}
            onProviderImageConfigChange={handleProviderImageConfigChange}
            onPromptChange={handlePromptChange}
            onSubmit={handleSubmit}
          />
        )}

        <WizardFooter
          currentStep={state.step}
          maxStep={GENERATE_WIZARD_MAX_STEP}
          canAdvance={canAdvance}
          isSubmitting={isWizardBusy}
          onBack={() => goToStep(state.step - 1)}
          onNext={() => goToStep(state.step + 1)}
        />
      </div>
    </div>
  );
};
