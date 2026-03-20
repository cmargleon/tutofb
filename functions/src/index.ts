import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();

setGlobalOptions({ maxInstances: 10 });

// Export callables
export * from './callables/createGenerationBatch';
export * from './callables/regenerateJob';
export * from './callables/syncUserClaims';
export * from './admin/rebuildAnalytics';

// Export triggers
export * from './triggers/onJobStatusChange';
export * from './triggers/onClientDelete';
export * from './triggers/onModelDelete';
export * from './triggers/processJobOnCreate';
export * from './triggers/processJobOnRequeue';
export * from './triggers/analyticsTriggers';
