"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requeueExpiredJobsOnSchedule = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const jobWorker_1 = require("../workers/jobWorker");
exports.requeueExpiredJobsOnSchedule = (0, scheduler_1.onSchedule)({
    schedule: 'every 5 minutes',
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    await (0, jobWorker_1.requeueExpiredJobs)();
});
//# sourceMappingURL=requeueExpiredJobs.js.map