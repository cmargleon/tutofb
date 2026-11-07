import type { ModelIdentityTraits, PoseAiClassification } from './model';
import type { Role } from './common';
export interface ManglarClientSaveRequest {
    id?: string;
    name?: string;
    generationPromptBase?: string | null;
    expected?: { name?: string; generationPromptBase?: string | null };
}
export interface ManglarModelSaveRequest {
    id?: string;
    clientId: string;
    name: string;
    identityTraits?: ModelIdentityTraits | null;
    posesToAdd?: Array<{
        storagePath: string;
        fileName: string;
        aiClassification?: PoseAiClassification | null;
    }>;
    poseIdsToRemove?: string[];
    generatedPhotoCount?: number;
    generatedPhotoCostUsd?: number;
}
export interface ManglarEntityStateRequest {
    id: string;
}
export interface ManglarJobFlagRequest {
    jobId: string;
    flagged: boolean;
}
export interface ManglarPoseReplaceRequest {
    modelId: string;
    poseId: string;
    storagePath: string;
    aiClassification?: PoseAiClassification | null;
    estimatedCostUsd?: number;
}
export interface ManglarPoseClassifyRequest {
    modelId: string;
    poseIds?: string[];
}
export interface ManglarAccessRequest {
    uid: string;
    enabled: boolean;
    clientIds: string[] | null;
}
export interface ManglarConnectionListRequest {
    ownerUid?: string;
}
export interface ManglarConnectionRevokeRequest {
    connectionId: string;
}
export interface ManglarGetRequest {
    id: string;
}
export interface ManglarQueryRequest {
    clientId?: string;
    batchId?: string;
    jobId?: string;
    modelId?: string;
    templateId?: string;
    status?: string;
    provider?: string;
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
    cursor?: string;
    fields?: string[];
    detail?: boolean;
    sort?: 'newest' | 'oldest' | 'documentId';
}
export interface ManglarAnalyticsRequest extends ManglarQueryRequest {
    dataset: 'summary' | 'daily' | 'clients' | 'providers' | 'clientProviders' | 'clientModels' | 'gemini' | 'modelGenerations' | 'alerts';
}
export interface ManglarFinanceQueryRequest extends ManglarQueryRequest {
    dataset: 'events' | 'jobs' | 'batches' | 'clients' | 'models' | 'providers' | 'pricing' | 'fixedCosts' | 'fxRates';
    period?: string;
}
export interface ManglarUploadRequest {
    purpose: 'reference' | 'modelPose' | 'spreadsheetTemplate' | 'sourceSpreadsheet' | 'modelBundle';
    clientId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    modelId?: string;
}
export interface ManglarFileRequest {
    storagePath: string;
}
export interface ManglarDriveImportRequest {
    clientId: string;
    itemId: string;
    fileName: string;
    driveFile: {
        folderId: string;
        fileId: string;
        version?: string;
        revisionId?: string;
    };
}
export interface ManglarImageRequest {
    jobId: string;
    outputId?: string;
}
export interface ManglarZipRequest {
    batchId: string;
    jobIds?: string[];
    selectedOutputIdsByJobId?: Record<string, string>;
}
export interface ManglarBackfillRequest {
    dryRun?: boolean;
    provider?: import('./model').ModelPhotoProvider;
    chunkSize?: number;
    cursor?: string | null;
}
export interface ManglarUserCreateRequest {
    email: string;
    displayName: string;
    password: string;
    role: Role;
    active: boolean;
}
export interface ManglarUserUpdateRequest {
    uid: string;
    email: string;
    displayName: string;
    role: Role;
    active: boolean;
    password?: string;
}
export interface ManglarSyncClaimsRequest {
    uid?: string;
    role?: Role;
}
export interface ManglarDraftRequest {
    id?: string;
    clientId: string;
    items: Array<{
        id: string;
        name: string;
        photos: Array<{
            id: string;
            storagePath: string;
            fileName: string;
            sourceIndex: number;
        }>;
    }>;
    generationKind?: 'garment' | 'product';
}
export interface ManglarDraftCorrectRequest {
    id: string;
    generationKind: 'garment' | 'product';
}
export interface ManglarDraftClassifyRequest {
    id: string;
    spreadsheetTemplateId?: string;
    fallbackCategoryId?: string;
}
export interface ManglarDraftGetRequest {
    id: string;
}
export interface ManglarAuthorization {
    operationId: string;
    confirmationToken: string;
    confirmedBudgetUsd?: number;
}
export interface ManglarGarmentDraftGenerationRequest {
    draftId: string;
    request: import('./batch').CreateGenerationBatchRequest;
}
export interface ManglarProductDraftGenerationRequest {
    draftId: string;
    request: import('./productGeneration').CreateProductGenerationBatchRequest;
}
export interface ManglarExecutePlanRequest {
    planId: string;
    confirmedBudgetUsd: number;
}

export interface ManglarClientSaveResponse { id: string; values: { name: string; generationPromptBase: string | null } }
