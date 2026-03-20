"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recursiveDeleteDocuments = void 0;
const appFirestore_1 = require("../firebase/appFirestore");
const db = (0, appFirestore_1.getAppFirestore)();
const recursiveDeleteDocuments = async (docs) => {
    for (const docSnapshot of docs) {
        await db.recursiveDelete(docSnapshot.ref);
    }
};
exports.recursiveDeleteDocuments = recursiveDeleteDocuments;
//# sourceMappingURL=recursiveDelete.js.map