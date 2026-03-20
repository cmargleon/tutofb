"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppFirestore = exports.APP_FIRESTORE_DATABASE_ID = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
exports.APP_FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
let firestoreInstance = null;
const getAppFirestore = () => {
    if (!firestoreInstance) {
        firestoreInstance = (0, firestore_1.getFirestore)((0, app_1.getApp)(), exports.APP_FIRESTORE_DATABASE_ID);
    }
    return firestoreInstance;
};
exports.getAppFirestore = getAppFirestore;
//# sourceMappingURL=appFirestore.js.map