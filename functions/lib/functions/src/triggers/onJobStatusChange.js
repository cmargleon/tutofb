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
Object.defineProperty(exports, "__esModule", { value: true });
exports.onJobStatusChange = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const appFirestore_1 = require("../firebase/appFirestore");
exports.onJobStatusChange = (0, firestore_1.onDocumentUpdated)('jobs/{jobId}', async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const before = snapshot.before.data();
    const after = snapshot.after.data();
    if (before.status === after.status)
        return;
    const db = (0, appFirestore_1.getAppFirestore)();
    const batchRef = db.collection('batches').doc(after.batchId);
    // Update batch counters
    await db.runTransaction(async (transaction) => {
        const batchSnap = await transaction.get(batchRef);
        if (!batchSnap.exists)
            return;
        const batchData = batchSnap.data();
        let pendingJobs = batchData.pendingJobs;
        let processingJobs = batchData.processingJobs;
        let completedJobs = batchData.completedJobs;
        let failedJobs = batchData.failedJobs;
        // Remove from old status
        if (before.status === 'pending')
            pendingJobs--;
        if (before.status === 'processing')
            processingJobs--;
        if (before.status === 'completed')
            completedJobs--;
        if (before.status === 'failed')
            failedJobs--;
        // Add to new status
        if (after.status === 'pending')
            pendingJobs++;
        if (after.status === 'processing')
            processingJobs++;
        if (after.status === 'completed')
            completedJobs++;
        if (after.status === 'failed')
            failedJobs++;
        let status = batchData.status;
        if (completedJobs === batchData.totalJobs)
            status = 'completed';
        else if (failedJobs === batchData.totalJobs)
            status = 'failed';
        else if (completedJobs + failedJobs === batchData.totalJobs)
            status = 'partial_failed';
        else if (processingJobs > 0)
            status = 'processing';
        else
            status = 'pending';
        transaction.update(batchRef, {
            pendingJobs,
            processingJobs,
            completedJobs,
            failedJobs,
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    });
});
//# sourceMappingURL=onJobStatusChange.js.map