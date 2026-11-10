import React, { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
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

export const Catalogo: React.FC<{ client?: Client }> = ({ client }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlClientId = client?.id ?? searchParams.get('clientId') ?? '';
  const batchParam = client ? 'productBatchId' : 'batchId';
  const urlBatchId = searchParams.get(batchParam) ?? '';
  const role = useRole();
  const { config: systemConfig } = useSystemConfig();
  const selectedClientId = urlClientId;
  const selectedBatchId = urlBatchId;
  const [pageSize, setPageSize] = useState<number>(25);
  const [sortOrder, setSortOrder] = useState<CatalogSortOrder>('desc');

  const {
    batches,
    garmentGroups,
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

  const {
    displayGarmentGroups,
    pendingRegenerationJobIds,
    visibleJobsCount,
    handleRegenerationQueued,
    handleRegenerationCancelled,
    resetPendingRegenerations,
  } = useCatalogDisplayGroups({ selectedBatchId, sortOrder, garmentGroups });

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
  }, [currentPage, pageSize, selectedBatchId, selectedClientId, sortOrder]);

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

  return (
    <div className="flex flex-col h-full">
      <div className={`flex-1 space-y-5 ${client ? '' : 'tuto-page !gap-0'}`}>
        {!client && <PageHeader title="Catálogo" icon={Images} description="Fotografías aprobadas y fallidas por cliente, lote y prenda. Revisa, regenera o exporta a marketplaces." />}
        <div className="tuto-surface p-4">
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
        </div>

        <CatalogStatusMessages
          selectedClientId={selectedClientId}
          selectedBatchId={selectedBatchId}
          selectedBatch={selectedBatch}
          selectedBatchIsGenerating={selectedBatchIsGenerating}
          loading={loading}
          error={error}
          batchLinkError={batchLinkError}
          garmentGroupsCount={displayGarmentGroups.length}
        />

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
                onImageClick={openLightboxForJob}
                onRegenerationQueued={handleRegenerationQueued}
                onRegenerationCancelled={handleRegenerationCancelled}
                pendingRegenerationJobIds={pendingRegenerationJobIds}
              />
            ))}
            <CatalogPageSummary
              className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between"
              {...summaryProps}
            />
          </div>
        )}
      </div>

      {lightbox && resolvedLightboxJob && (
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
