"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processJobOnCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const runtime_1 = require("../config/runtime");
const jobWorker_1 = require("../workers/jobWorker");
exports.processJobOnCreate = (0, firestore_1.onDocumentCreated)({
    document: 'jobs/{jobId}',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [runtime_1.FAL_KEY, runtime_1.OPENAI_API_KEY],
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        return;
    }
    const job = snapshot.data();
    if (job.status !== 'pending') {
        return;
    }
    await (0, jobWorker_1.processJob)(event.params.jobId, 'create');
});
//# sourceMappingURL=processJobOnCreate.js.map