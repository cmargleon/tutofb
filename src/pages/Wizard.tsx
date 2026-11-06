import { ProductScenesStep } from '../components/wizard/ProductScenesStep';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { organizer } from '../features/organizer/firebase';
import type { OrganizerDraft } from '../../shared/src/types';
import { Button, LoadingBlock } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { WizardFooter } from '../components/wizard/WizardFooter';
import { ClientModelStep } from '../components/wizard/ClientModelStep';
import { GarmentsStep } from '../components/wizard/GarmentsStep';
import { PoseSelectionStep } from '../components/wizard/PoseSelectionStep';
import { BatchStep } from '../components/wizard/BatchStep';
import { useToast } from '../features/feedback/FeedbackProvider';
import { useWizard } from '../features/generate/hooks/useWizard';
import { GENERATE_WIZARD_MAX_STEP, getGenerateWizardSteps } from '../features/generate/wizard/state';

export const Wizard: React.FC = () => {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const organizerClient = params.get('organizerClient');
  const organizerVariant = params.get('organizerVariant');
  const lastErrorRef = useRef<string | null>(null);
  const {
    state,
    clients,
    models,
    spreadsheetTemplates,
    spreadsheetCategories,
    selectedClientHasSpreadsheetTemplates,
    loadingSpreadsheetTemplates,
    loadingData,
    isSubmitting,
    isAnalyzing,
    excludedItemsNotice,
    error,
    stepperRef,
    selectedModel,
    selectedClient,
    allPosesSelected,
    canAdvance,
    totalJobs,
    uploadSummary,
    compatiblePoseIds,
    promptSourceLabel,
    submitButtonLabel,
    disabledProviders,
    goToStep,
    handleStepSelect,
    canSelectStep,
    handleFiles,
    handleRetryAnalysis,
    removeGarment,
    handleSubmit,
    handleClientChange,
    handleGenerationKindChange,
    product,
    handleOutputModeChange,
    handleSpreadsheetTemplateChange,
    handleSpreadsheetCategoryChange,
    handleSourceSpreadsheetFile,
    handleModelSelect,
    handlePoseToggle,
    handleToggleAllPoses,
    handleProviderChange,
    handleProviderImageConfigChange,
    handlePromptChange,
    handlePromptBlocksChange,
    handleRetryPoseSuggestions,
    handleRetryProductDraftPreparation,
  } = useWizard();
  const isWizardBusy = isSubmitting || isAnalyzing || importing;
  const importOrganizer = async () => {
    if (!organizerClient || !organizerVariant || state.garments.length || !clients.some(client => client.id === organizerClient)) return;
    setImporting(true);
    try {
      const draft = await organizer<OrganizerDraft>({ action: 'draft', clientId: organizerClient, variantId: organizerVariant });
      const files = draft.photos.map(photo => new File([Uint8Array.from(atob(photo.base64), char => char.charCodeAt(0))], photo.name, { type: 'image/jpeg' }));
      handleClientChange(organizerClient);
      await product.handleFiles(files, true, draft);
      setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete('organizerClient'); next.delete('organizerVariant');
        return next;
      }, { replace: true });
    } catch (error) {
      toast({ tone: 'error', title: 'No se pudieron importar las referencias', description: (error as Error).message });
    } finally { setImporting(false); }
  };

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
      <div className="max-w-7xl mx-auto pb-12">
        <LoadingBlock />
      </div>
    );
  }

  const contextSection = (section: 'client' | 'model' | 'output') => (
        <ClientModelStep
          section={section}
          generationKind={state.generationKind}
          isBusy={isWizardBusy}
          clients={clients}
          models={models}
          spreadsheetTemplates={spreadsheetTemplates}
          spreadsheetCategories={spreadsheetCategories}
          selectedClientId={state.selectedClientId}
          selectedModelId={state.selectedModelId}
          outputMode={state.outputMode}
          outputModeChosen={state.outputModeChosen}
          selectedClientHasSpreadsheetTemplates={selectedClientHasSpreadsheetTemplates}
          loadingSpreadsheetTemplates={loadingSpreadsheetTemplates}
          selectedSpreadsheetTemplateId={state.selectedSpreadsheetTemplateId}
          selectedSpreadsheetCategoryId={state.selectedSpreadsheetCategoryId}
          sourceSpreadsheet={state.sourceSpreadsheet}
          onClientChange={handleClientChange}
          onOutputModeChange={handleOutputModeChange}
          onSpreadsheetTemplateChange={handleSpreadsheetTemplateChange}
          onSpreadsheetCategoryChange={handleSpreadsheetCategoryChange}
          onSourceSpreadsheetFile={handleSourceSpreadsheetFile}
          onModelSelect={handleModelSelect}
        />
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <div ref={stepperRef}>
        <WizardStepper
          steps={getGenerateWizardSteps(state.generationKind)}
          currentStep={state.step}
          onStepSelect={handleStepSelect}
          canSelectStep={canSelectStep}
        />
      </div>

      {state.step === 1 && <div className="space-y-6">
        {contextSection('client')}
        {organizerClient && organizerVariant && <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div><h2 className="font-semibold">Referencias aprobadas del organizador</h2>
            <p className="text-sm text-slate-600">Importa el artículo y sus vistas aprobadas al lote.</p></div>
          <Button disabled={isWizardBusy || Boolean(state.garments.length)} loading={importing} onClick={importOrganizer}>Importar referencias</Button>
        </section>}
        {state.selectedClientId && <GarmentsStep
          garments={state.garments}
          isSubmitting={isWizardBusy}
          generationKind={state.generationKind}
          onGenerationKindChange={handleGenerationKindChange}
          onRetryAnalysis={handleRetryAnalysis}
          excludedItemsNotice={excludedItemsNotice}
          onSameItemFiles={(files) => product.handleFiles(files, true)}
          onFiles={handleFiles}
          onRemoveGarment={removeGarment}
        />}
      </div>}

      {state.step === 2 && state.generationKind === 'product' && <ProductScenesStep
        scenes={state.productScenes} defaultScenes={product.defaultScenes} disabled={isWizardBusy} onToggle={product.toggleScene} onPromptChange={product.changeScenePrompt} />}

      {state.step === 2 && state.generationKind === 'garment' && <div className="space-y-6">
        {contextSection('model')}
        <PoseSelectionStep
          selectedModel={selectedModel}
          garments={state.garments}
          selectedPoseIds={state.selectedPoseIds}
          suggestedPoseIds={state.poseSuggestions.suggestedPoseIds}
          compatiblePoseIds={compatiblePoseIds}
          allPosesSelected={allPosesSelected}
          isPreparing={state.poseSuggestions.status === 'preparing'}
          suggestionError={state.poseSuggestions.error}
          missingPoseClassificationCount={state.poseSuggestions.missingPoseClassificationCount}
          onPoseToggle={handlePoseToggle}
          onToggleAllPoses={handleToggleAllPoses}
          onRetrySuggestions={handleRetryPoseSuggestions}
        />
      </div>}

      {state.step === 3 && <div className="space-y-6">
        {contextSection('output')}
        <BatchStep
          clientName={selectedClient?.name}
          modelName={selectedModel?.name}
          state={state}
          isSubmitting={isWizardBusy}
          totalJobs={totalJobs}
          promptSourceLabel={promptSourceLabel}
          submitButtonLabel={submitButtonLabel}
          disabledProviders={disabledProviders}
          defaultProductPrompt={product.defaultPrompt}
          productDraftPreparationStatus={state.productDraftPreparation.status}
          productDraftPreparationError={state.productDraftPreparation.error}
          sourceSpreadsheet={state.sourceSpreadsheet}
          sourceSpreadsheetSummary={state.sourceSpreadsheetSummary}
          onRetryProductDraftPreparation={handleRetryProductDraftPreparation}
          onProviderChange={handleProviderChange}
          onProviderImageConfigChange={handleProviderImageConfigChange}
          onPromptChange={handlePromptChange}
          onPromptBlocksChange={handlePromptBlocksChange}
          onSubmit={handleSubmit}
        />
      </div>}

      <WizardFooter
        currentStep={state.step}
        maxStep={GENERATE_WIZARD_MAX_STEP}
        canAdvance={canAdvance}
        isSubmitting={isWizardBusy}
        onBack={() => goToStep(state.step - 1)}
        onNext={() => goToStep(state.step + 1)}
      />
    </div>
  );
};
