import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();

setGlobalOptions({ maxInstances: 10 });

// Export callables
export * from './callables/createGenerationBatch';
export * from './callables/classifyGarmentViewsWithGemini';
export * from './callables/importClientSpreadsheetTemplate';
export * from './callables/deleteClientSpreadsheetTemplate';
export * from './callables/updateClientSpreadsheetTemplateCategory';
export * from './callables/previewProductDrafts';
export * from './callables/regenerateJob';
export * from './callables/retryJobAutoReview';
export * from './callables/cancelJobGeneration';
export * from './callables/cancelBatchProcessing';
export * from './callables/selectJobOutput';
export * from './callables/updateBatchProductDraft';
export * from './callables/exportBatchSpreadsheet';
export * from './callables/regenerateFailedBatchJobs';
export * from './callables/cancelPendingBatchJobs';
export * from './callables/regenerateJobsBulk';
export * from './callables/searchArchive';
export * from './callables/syncUserClaims';
export * from './callables/createAppUser';
export * from './callables/updateAppUser';
export * from './callables/archiveAppUser';
export * from './callables/restoreAppUser';
export * from './callables/permanentlyDeleteAppUser';
export * from './callables/permanentlyDeleteClient';
export * from './callables/permanentlyDeleteModel';
export * from './callables/generateModelPose';
export * from './admin/rebuildAnalytics';
export * from './admin/getSystemHealth';
export * from './admin/updateSystemAlertSettings';
export * from './admin/tagModelPosesWithGemini';
export * from './callables/updateSystemConfig';
export * from './callables/getSystemConfig';
export * from './http/downloadBatchZip';
export * from './http/downloadJobImage';
export * from './http/downloadSelectedJobsZip';

// Export triggers
export * from './triggers/onJobStatusChange';
export * from './triggers/onClientDelete';
export * from './triggers/onModelDelete';
export * from './triggers/processJobOnCreate';
export * from './triggers/processJobOnRequeue';
export * from './triggers/requeueExpiredJobs';
export * from './triggers/analyticsTriggers';
export * from './triggers/onModelWrite';
export * from './triggers/syncClaimsOnUserWrite';
export * from './triggers/storageCleanupSchedule';
