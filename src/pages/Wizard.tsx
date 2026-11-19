import { activePhotoChannels } from '../../shared/src/marketplacePhotoPlan';
import { MARKETPLACES } from '../../shared/src/marketplaces';
import { MarketplacePhotoPlanPanel } from '../features/generate/MarketplacePhotoPlanPanel';
import { ProductScenesStep } from '../components/wizard/ProductScenesStep';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductWorkflow, workflowUrl } from '../features/organizer/productWorkflow';
import { organizer } from '../features/organizer/firebase';
import type { OrganizerDraft } from '../../shared/src/types';
import { RotateCcw, Wand2 } from 'lucide-react';
import { Button, LoadingBlock, PageHeader } from '../components/ui';
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
  const [params] = useSearchParams();
  const variantId = params.get('variantId') ?? params.get('organizerVariant') ?? '';
  const clientId = params.get('clientId') ?? params.get('organizerClient') ?? '';
  const baseProductId = params.get('baseProductId') ?? '';
  const batchId = params.get('batchId') ?? '';
  return <GenerationWizard key={JSON.stringify([variantId, variantId && clientId, baseProductId, batchId])}
    organizerVariant={variantId} organizerClient={clientId} baseProductId={baseProductId} batchId={batchId} />;
};

const GenerationWizard = ({ organizerVariant, organizerClient, baseProductId, batchId }: {
  organizerVariant: string; organizerClient: string; baseProductId: string; batchId: string;
}) => {
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const scoped = Boolean(organizerVariant || baseProductId);
  const detail = useProductWorkflow(organizerClient, organizerVariant, baseProductId, batchId || undefined);
  const workflow = detail?.workflow;
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
    handlePhotoAttributesChange,
    handlePhotoChannelsChange,
    handlePhotoIdentityChange,
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
    restoringDraft,
    draftNotice,
    dismissDraftNotice,
    hasWork,
    handleReset,
  } = useWizard({
    // Organizer links get their own draft so a plain /generate draft never leaks into them.
    draftScope: scoped ? JSON.stringify([organizerClient, organizerVariant, baseProductId, batchId]) : 'generate',
  });
  const isWizardBusy = isSubmitting || isAnalyzing || importing;
  const importOrganizer = async () => {
    if (!workflow || state.garments.length || !clients.some(client => client.id === organizerClient)) return;
    setImporting(true);
    try {
      const draft = await organizer<OrganizerDraft>({ action: 'draft', ...workflow.context });
      if (!draft.context) throw new Error('La importación no devolvió la identidad de la variante.');
      const files = draft.photos.map(photo => new File([Uint8Array.from(atob(photo.base64), char => char.charCodeAt(0))], photo.name, { type: 'image/jpeg' }));
      handleClientChange(organizerClient);
      await product.handleFiles(files, true, draft);
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
      <div className="tuto-page">
        <LoadingBlock message={restoringDraft ? 'Recuperando el lote que estabas preparando…' : 'Cargando clientes y modelos…'} />
      </div>
    );
  }

  const contextSection = (section: 'client' | 'model' | 'output') => (
        <ClientModelStep
          section={section}
          generationKind={state.generationKind}
          isBusy={isWizardBusy}
          lockClient={scoped}
          clients={clients}
          models={models}
          spreadsheetTemplates={spreadsheetTemplates}
          spreadsheetCategories={spreadsheetCategories}
          selectedClientId={scoped && workflow ? workflow.context.clientId : state.selectedClientId}
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
    <div className="tuto-page">
      <PageHeader
        title="Generar fotos"
        icon={Wand2}
        description="Sube las fotos de referencia, prepara la sesión y envía el lote a generación con revisión automática de calidad."
        actions={hasWork || draftNotice?.failed ? (
          <Button variant="secondary" disabled={isWizardBusy} onClick={() => void handleReset()}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" /> Reiniciar
          </Button>
        ) : undefined}
      />
      {draftNotice && (
        <div role="status" data-testid="wizard-draft-notice"
          className={`tuto-alert ${draftNotice.failed || draftNotice.warnings.length ? 'tuto-alert--warning' : 'tuto-alert--info'} flex flex-wrap items-start justify-between gap-3`}>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{draftNotice.failed
              ? 'No pudimos recuperar el lote que estabas preparando.'
              : `Recuperamos el lote que estabas preparando (guardado ${new Date(draftNotice.savedAt).toLocaleString('es')}).`}</p>
            {draftNotice.warnings.length > 0 && <ul className="list-disc pl-5">
              {draftNotice.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>}
          </div>
          <button type="button" className="tuto-link text-sm" onClick={dismissDraftNotice}>Entendido</button>
        </div>
      )}
      {scoped && <div className="flex flex-wrap items-center gap-3">
        {organizerClient && organizerVariant && <Link className="tuto-link text-sm" to={workflowUrl('/organizador',
          workflow?.context || { clientId: organizerClient, variantId: organizerVariant, baseProductId }, { batchId })}>Volver a la ficha del producto</Link>}
        {workflow && <span className="text-sm text-slate-700">{workflow.baseName} · {[workflow.variant.visual, workflow.variant.color].filter(Boolean).join(' · ')}</span>}
      </div>}
      <div ref={stepperRef} className="scroll-mt-20">
        <WizardStepper
          steps={getGenerateWizardSteps(state.generationKind)}
          currentStep={state.step}
          onStepSelect={handleStepSelect}
          canSelectStep={canSelectStep}
        />
      </div>

      {state.step === 1 && <div className="space-y-6">
        {(!scoped || workflow) && contextSection('client')}
        {scoped && (!organizerClient || !organizerVariant || detail?.error) && <p role="alert" className="tuto-alert tuto-alert--warning">{detail?.error || 'El enlace de generación requiere cliente y variante.'}</p>}
        {scoped && organizerClient && organizerVariant && !detail && <LoadingBlock message="Cargando variante…" />}
        {workflow && <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div><h2 className="font-semibold">Referencias aprobadas del organizador</h2>
            <p className="text-sm text-slate-600">{workflow.variant.referenceState === 'approved' ? 'Importa la variante y sus vistas aprobadas al lote.' : 'Revisa y aprueba las referencias en el Organizador para continuar.'}</p></div>
          <Button disabled={isWizardBusy || Boolean(state.garments.length) || workflow.variant.referenceState !== 'approved' || !clients.some(client => client.id === organizerClient)} loading={importing} onClick={importOrganizer}>Importar referencias</Button>
        </section>}
        {state.selectedClientId && <GarmentsStep
          garments={state.garments}
          importedOnly={scoped}
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

      {selectedClient && state.generationKind === 'garment' && activePhotoChannels(selectedClient.marketplaces).length > 0 && <fieldset disabled={isWizardBusy} className="flex flex-wrap items-center gap-4 rounded-xl border bg-white p-4"><legend className="px-2 text-sm font-semibold">Marketplaces de este pedido</legend>{activePhotoChannels(selectedClient.marketplaces).map(channel => <label className="flex items-center gap-2 text-sm" key={channel}><input type="checkbox" checked={(state.selectedPhotoChannels || activePhotoChannels(selectedClient.marketplaces)).includes(channel)} onChange={e => { const current = state.selectedPhotoChannels || activePhotoChannels(selectedClient.marketplaces); handlePhotoChannelsChange(e.target.checked ? [...current, channel] : current.filter(c => c !== channel)); }} />{MARKETPLACES.find(m => m.id === channel)?.name}</label>)}</fieldset>}
      {state.marketplacePhotoPlan && <MarketplacePhotoPlanPanel plan={state.marketplacePhotoPlan} prompt={state.prompt} onPromptChange={handlePromptChange} disabled={isWizardBusy} onAttributesChange={handlePhotoAttributesChange} onIdentityChange={handlePhotoIdentityChange} />}

      {state.step === 2 && state.generationKind === 'product' && <ProductScenesStep
        scenes={state.productScenes} defaultScenes={product.defaultScenes} disabled={isWizardBusy} onToggle={product.toggleScene} onPromptChange={product.changeScenePrompt} />}

      {state.step === 2 && state.generationKind === 'garment' && <div className="space-y-6">
        {state.marketplacePhotoPlan && <p className="text-sm text-slate-600">Las tomas con modelo requieren sus bases aprobadas para cada destino. Las tomas planas no requieren personas. Si falta una base, completa esa toma en el catálogo del modelo o cambia los destinos del pedido.</p>}
        {(!state.marketplacePhotoPlan || state.marketplacePhotoPlan.tasks.some(t => t.composition === 'model') || state.marketplacePhotoPlan.issues.some(i => i.code.startsWith('base-'))) && contextSection('model')}
        {!state.marketplacePhotoPlan && <PoseSelectionStep
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
        />}
      </div>}

      {state.step === 3 && <div className="space-y-6">
        {!state.marketplacePhotoPlan && contextSection('output')}
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
