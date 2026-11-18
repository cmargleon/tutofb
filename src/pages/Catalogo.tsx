import { MarketplaceExportDrawer } from '../features/marketplaces/MarketplaceExportDrawer';
import { useProductWorkflow, workflowUrl } from '../features/organizer/productWorkflow';
import React, { useEffect, useMemo, useState } from 'react';
import { Images } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadingBlock, PageHeader } from '../components/ui';
import { RetryFailedJobsDialog } from '../components/evaluation/RetryFailedJobsDialog';
import { useRole } from '../features/auth/AuthProvider';
import { CatalogSortOrder, useCatalogJobs } from '../features/catalog/useCatalogJobs';
import { useCatalogBatchActions } from '../features/catalog/useCatalogBatchActions';
import { useCatalogBatchSelection } from '../features/catalog/useCatalogBatchSelection';
import { useCatalogDisplayGroups } from '../features/catalog/useCatalogDisplayGroups';
import { useCatalogLightbox } from '../features/catalog/useCatalogLightbox';
import { Client } from '../../shared/src/types';
import { CatalogBatchExportPanel } from '../components/catalog/CatalogBatchExportPanel';
import { CatalogBatchStatusPanel } from '../components/catalog/CatalogBatchStatusPanel';
import { CatalogFilters } from '../components/catalog/CatalogFilters';
import { CatalogGarmentSection } from '../components/catalog/CatalogGarmentSection';
import { CatalogLightbox } from '../components/catalog/CatalogLightbox';
import { CatalogPageSummary, CatalogPaginationControls } from '../components/catalog/CatalogPageSummary';
import { CatalogStatusMessages } from '../components/catalog/CatalogStatusMessages';
import { useSystemConfig } from '../features/system/useSystemConfig';
import { MasterCatalog } from '../features/catalog/MasterCatalog';

export const Catalogo: React.FC<{ client?: Client }> = ({ client }) => {
  const [params] = useSearchParams();
  return client && params.get('catalogView') === 'products' ? <MasterCatalog client={client} /> : <CatalogPhotos client={client} />;
};

const CatalogPhotos: React.FC<{ client?: Client }> = ({ client }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlClientId = client?.id ?? searchParams.get('clientId') ?? '';
  const batchParam = client ? 'productBatchId' : 'batchId';
  const urlBatchId = searchParams.get(batchParam) ?? '';
  const variantId = client ? '' : searchParams.get('variantId') ?? '';
  const baseProductId = client ? '' : searchParams.get('baseProductId') ?? '';
  const scoped = Boolean(variantId || baseProductId);
  const productDetail = useProductWorkflow(urlClientId, variantId, baseProductId, urlBatchId || undefined);
  const workflow = scoped && urlBatchId ? productDetail?.workflow : undefined;
  const generation = workflow?.generations.find(item => item.batchId === urlBatchId);
  const masterProductId = generation?.masterProductIds.length === 1 ? generation.masterProductIds[0] : undefined;
  const exportOpen = scoped && searchParams.get('view') === 'export';
  const role = useRole();
  const { config: systemConfig } = useSystemConfig();
  const selectedClientId = scoped && !generation ? '' : urlClientId;
  const selectedBatchId = scoped && !generation ? '' : urlBatchId;
  const [pageSize, setPageSize] = useState<number>(25);
  const [sortOrder, setSortOrder] = useState<CatalogSortOrder>('desc');

  const {
    batches,
    garmentGroups,
    generatingJobs,
    loading,
    error,
    currentPage,
    totalPages,
    hasPreviousPage,
    hasNextPage,
    goToPreviousPage,
    goToNextPage,
  } = useCatalogJobs({
    clientId: selectedClientId || null,
    batchId: selectedBatchId || null,
    pageSize,
    sortOrder,
    includeAllBatchJobs: scoped,
  });

  const {
    clients,
    batchLinkError,
    batchOptions,
    selectedBatch,
    selectedBatchIsGenerating,
    selectedBatchLabel,
    handleClientChange,
    handleBatchChange,
  } = useCatalogBatchSelection({
    client,
    searchParams,
    setSearchParams,
    selectedClientId,
    selectedBatchId,
    batchParam,
    batches,
  });

  const relatedGroups = useMemo(() => generation
    ? garmentGroups.filter(group => generation.itemIds.includes(group.garmentId))
    : garmentGroups, [generation, garmentGroups]);
  // The scoped subscription already includes queued jobs, so each thumbnail reflects its live job.
  const relatedGenerating = useMemo(() => scoped ? [] : generatingJobs, [scoped, generatingJobs]);

  const {
    displayGarmentGroups,
    pendingRegenerationJobIds,
    visibleJobsCount,
    handleRegenerationQueued,
    handleRegenerationCancelled,
    resetPendingRegenerations,
  } = useCatalogDisplayGroups({ generatingJobs: relatedGenerating, sortOrder, garmentGroups: relatedGroups });

  const {
    lightbox,
    setLightbox,
    resolvedLightboxJob,
    previousLightboxTarget,
    nextLightboxTarget,
    openLightboxForJob,
    handleCloseLightbox,
  } = useCatalogLightbox(displayGarmentGroups);

  const batchActions = useCatalogBatchActions({ selectedBatchId, selectedBatch });

  useEffect(() => {
    setLightbox(null);
    batchActions.resetBatchActionFeedback();
    resetPendingRegenerations();
  }, [currentPage, pageSize, selectedBatchId, selectedClientId, variantId, sortOrder]);

  const pageLabel = totalPages ? `Página ${currentPage} de ${totalPages}` : `Página ${currentPage}`;

  const paginationControls = selectedClientId && !loading && !error ? (
    <CatalogPaginationControls
      hasPreviousPage={hasPreviousPage}
      hasNextPage={hasNextPage}
      onPreviousPage={goToPreviousPage}
      onNextPage={goToNextPage}
    />
  ) : null;

  const summaryProps = {
    selectedBatchLabel,
    pageLabel,
    isClientScoped: Boolean(client),
    garmentGroupsCount: displayGarmentGroups.length,
    visibleJobsCount,
    paginationControls,
  };

  const closeExport = () => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete('view');
    return next;
  }, { replace: true });

  if (scoped && (!workflow || !generation)) return <div className="tuto-page">
    <PageHeader title="Revisión del producto" icon={Images} />
    {urlClientId && variantId && <Link className="tuto-link" to={workflowUrl('/organizador', { clientId: urlClientId, variantId, baseProductId })}>Volver a la ficha del producto</Link>}
    {!urlClientId || !variantId || !urlBatchId || productDetail?.error
      ? <p role="alert" className="tuto-alert tuto-alert--warning">{productDetail?.error || 'El enlace de revisión requiere cliente, variante y lote.'}</p>
      : <LoadingBlock message="Comprobando la relación con el lote…" />}
  </div>;

  return (
    <div className="flex flex-col h-full">
      <div className={`flex-1 space-y-5 ${client ? '' : 'tuto-page !gap-0'}`}>
        {workflow && generation && <section className="tuto-surface space-y-3 p-5">
          <p className="text-sm text-slate-600">{selectedBatch?.clientNameSnapshot || 'Cliente'} · Producto base {workflow.variant.base}</p>
          <h1 className="text-xl font-semibold">{workflow.baseName} · Revisión</h1>
          <p className="text-sm text-slate-700">Variante {[workflow.variant.visual, workflow.variant.color, workflow.variant.pack, workflow.variant.capacity].filter(Boolean).join(' · ')} · Lote <span className="break-all font-mono text-xs">{generation.batchId}</span></p>
          <nav aria-label="Recorrido del producto" className="flex flex-wrap gap-4 text-sm">
            <Link className="tuto-link" to={workflowUrl('/organizador', workflow.context, { batchId: generation.batchId })}>Volver a la ficha del producto</Link>
            {masterProductId && <Link className="tuto-link font-semibold" to={workflowUrl('/catalogo', workflow.context, { batchId: generation.batchId, view: 'export' })}>Siguiente paso · Validar exportación por canal</Link>}
          </nav>
          {!masterProductId && <p className="text-sm text-amber-800">El lote tiene varias fichas comerciales para esta variante. La exportación individual no se puede determinar desde este enlace.</p>}
        </section>}
        {!client && !scoped && <PageHeader title="Catálogo" icon={Images} description="Fotografías aprobadas y fallidas por cliente, lote y prenda. Revisa, regenera o exporta a marketplaces." />}
        {!scoped && <nav aria-label="Vistas del catálogo" className="flex gap-5 border-b border-slate-200 pb-3 text-sm"><Link className="tuto-link" to={client ? '?tab=productos&catalogView=products' : `/catalogo/productos${urlClientId ? `?clientId=${encodeURIComponent(urlClientId)}` : ''}`}>Productos maestros</Link><span aria-current="page" className="font-semibold text-emerald-800">Fotografías</span></nav>}
        {!scoped && <div className="tuto-surface p-4">
          <CatalogFilters
            client={client}
            clients={clients}
            selectedClientId={selectedClientId}
            selectedBatchId={selectedBatchId}
            batchOptions={batchOptions}
            pageSize={pageSize}
            sortOrder={sortOrder}
            onClientChange={handleClientChange}
            onBatchChange={handleBatchChange}
            onPageSizeChange={setPageSize}
            onSortOrderChange={setSortOrder}
          />

          {selectedClientId && !loading && !error && (
            <CatalogPageSummary
              className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
              {...summaryProps}
            />
          )}

          {!client && selectedBatch?.organizerOrigin && <Link className="tuto-link mt-3 inline-block text-sm" to={
            workflowUrl('/organizador', { clientId: selectedBatch.clientId, ...selectedBatch.organizerOrigin }, { batchId: selectedBatch.id })
          }>Abrir ficha del producto</Link>}

          <CatalogBatchStatusPanel
            selectedBatch={selectedBatch}
            canRegenerate={role.canRegenerate}
            hasError={Boolean(error)}
            selectedBatchIsGenerating={selectedBatchIsGenerating}
            isCancellingBatch={batchActions.isCancellingBatch}
            isRegeneratingFailed={batchActions.isRegeneratingFailed}
            batchActionMessage={batchActions.batchActionMessage}
            onCancelBatch={() => void batchActions.handleCancelBatchProcessing()}
            onOpenRetryDialog={() => batchActions.setIsRetryDialogOpen(true)}
          />

          <CatalogBatchExportPanel
            selectedBatch={selectedBatch}
            hasError={Boolean(error)}
            batchLinkError={batchLinkError}
            spreadsheetEditStatus={batchActions.spreadsheetEditStatus}
            spreadsheetEditError={batchActions.spreadsheetEditError}
            isExportingSpreadsheet={batchActions.isExportingSpreadsheet}
            onEditSpreadsheet={() => void batchActions.handleEditSpreadsheet()}
            onExportSpreadsheet={() => void batchActions.handleExportSpreadsheet()}
          />
        </div>}

        {scoped && loading && <LoadingBlock message="Cargando trabajos de la variante…" />}
        {scoped && (error || batchLinkError) && <p role="alert" className="tuto-alert tuto-alert--warning">{error || batchLinkError}</p>}
        {scoped && !loading && !error && !displayGarmentGroups.length &&
          <p className="text-sm text-slate-600">Los trabajos de esta variante ya no están disponibles en el lote.</p>}
        {!scoped && <CatalogStatusMessages
          selectedClientId={selectedClientId}
          selectedBatchId={selectedBatchId}
          selectedBatch={selectedBatch}
          selectedBatchIsGenerating={selectedBatchIsGenerating}
          loading={loading}
          error={error}
          batchLinkError={batchLinkError}
          garmentGroupsCount={displayGarmentGroups.length}
        />}

        <RetryFailedJobsDialog
          isOpen={batchActions.isRetryDialogOpen}
          isSubmitting={batchActions.isRegeneratingFailed}
          failedJobsCount={selectedBatch?.failedJobs || 0}
          scopeLabel="este lote"
          disabledProviders={systemConfig.disabledProviders}
          onClose={() => batchActions.setIsRetryDialogOpen(false)}
          onSubmit={async (provider) => {
            batchActions.setIsRetryDialogOpen(false);
            await batchActions.handleRegenerateFailedJobs(provider);
          }}
        />

        {!loading && displayGarmentGroups.length > 0 && (
          <div className="space-y-4">
            {displayGarmentGroups.map((group) => (
              <CatalogGarmentSection
                key={group.garmentId}
                group={group}
                deferGallery={Boolean(selectedBatchId)}
                showProductPhotoStatus={scoped}
                onImageClick={openLightboxForJob}
                onRegenerationQueued={handleRegenerationQueued}
                onRegenerationCancelled={handleRegenerationCancelled}
                pendingRegenerationJobIds={pendingRegenerationJobIds}
              />
            ))}
            {!scoped && <CatalogPageSummary
              className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
              {...summaryProps}
            />}
          </div>
        )}
      </div>

      {exportOpen && workflow && generation && masterProductId && <MarketplaceExportDrawer
        key={`${generation.batchId}:${masterProductId}`}
        scope={{ clientId: workflow.context.clientId, batchIds: [generation.batchId], masterProductId, organizerContext: workflow.context }}
        onClose={closeExport} />}
      {lightbox && resolvedLightboxJob && (!scoped || generation?.itemIds.includes(resolvedLightboxJob.garmentId) &&
        resolvedLightboxJob.batchId === generation.batchId && resolvedLightboxJob.clientId === selectedClientId) && (
        <CatalogLightbox
          job={resolvedLightboxJob}
          disabledProviders={systemConfig.disabledProviders}
          canGoPrevious={Boolean(previousLightboxTarget)}
          canGoNext={Boolean(nextLightboxTarget)}
          onClose={handleCloseLightbox}
          onPrevious={() => previousLightboxTarget && setLightbox(previousLightboxTarget)}
          onNext={() => nextLightboxTarget && setLightbox(nextLightboxTarget)}
        />
      )}
    </div>
  );
};
