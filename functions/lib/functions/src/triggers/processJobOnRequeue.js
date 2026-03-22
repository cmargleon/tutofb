"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processJobOnRequeue = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const runtime_1 = require("../config/runtime");
const jobWorker_1 = require("../workers/jobWorker");
exports.processJobOnRequeue = (0, firestore_1.onDocumentUpdated)({
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [runtime_1.FAL_KEY, runtime_1.OPENAI_API_KEY, runtime_1.GEMINI_API_KEY],
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const before = snapshot.before.data();
    const after = snapshot.after.data();
    if (before.status !== 'pending' && after.status === 'pending') {
        await (0, jobWorker_1.processJob)(event.params.jobId, 'requeue');
    }
});
//# sourceMappingURL=processJobOnRequeue.js.map