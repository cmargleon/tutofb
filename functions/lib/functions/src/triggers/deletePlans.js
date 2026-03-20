"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLiveOutputPaths = void 0;
const extractLiveOutputPaths = (outputs) => Array.from(new Set(outputs
    .filter((output) => output.resultImagePath && !output.storageDeletedAt)
    .map((output) => output.resultImagePath)));
exports.extractLiveOutputPaths = extractLiveOutputPaths;
//# sourceMappingURL=deletePlans.js.map