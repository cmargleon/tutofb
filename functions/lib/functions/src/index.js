"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const v2_1 = require("firebase-functions/v2");
admin.initializeApp();
(0, v2_1.setGlobalOptions)({ maxInstances: 10 });
// Export callables
__exportStar(require("./callables/createGenerationBatch"), exports);
__exportStar(require("./callables/regenerateJob"), exports);
__exportStar(require("./callables/regenerateFailedBatchJobs"), exports);
__exportStar(require("./callables/cancelPendingBatchJobs"), exports);
__exportStar(require("./callables/regenerateJobsBulk"), exports);
__exportStar(require("./callables/searchArchive"), exports);
__exportStar(require("./callables/syncUserClaims"), exports);
__exportStar(require("./callables/createAppUser"), exports);
__exportStar(require("./callables/updateAppUser"), exports);
__exportStar(require("./callables/archiveAppUser"), exports);
__exportStar(require("./callables/restoreAppUser"), exports);
__exportStar(require("./callables/permanentlyDeleteAppUser"), exports);
__exportStar(require("./callables/permanentlyDeleteClient"), exports);
__exportStar(require("./callables/permanentlyDeleteModel"), exports);
__exportStar(require("./callables/generateModelPose"), exports);
__exportStar(require("./admin/rebuildAnalytics"), exports);
__exportStar(require("./admin/getSystemHealth"), exports);
__exportStar(require("./admin/updateSystemAlertSettings"), exports);
__exportStar(require("./http/downloadBatchZip"), exports);
__exportStar(require("./http/downloadJobImage"), exports);
__exportStar(require("./http/downloadSelectedJobsZip"), exports);
// Export triggers
__exportStar(require("./triggers/onJobStatusChange"), exports);
__exportStar(require("./triggers/onClientDelete"), exports);
__exportStar(require("./triggers/onModelDelete"), exports);
__exportStar(require("./triggers/processJobOnCreate"), exports);
__exportStar(require("./triggers/processJobOnRequeue"), exports);
__exportStar(require("./triggers/requeueExpiredJobs"), exports);
__exportStar(require("./triggers/analyticsTriggers"), exports);
__exportStar(require("./triggers/syncClaimsOnUserWrite"), exports);
//# sourceMappingURL=index.js.map