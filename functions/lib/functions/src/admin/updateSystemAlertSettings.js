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
exports.updateSystemAlertSettings = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const systemAlerts_1 = require("./systemAlerts");
exports.updateSystemAlertSettings = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const db = (0, appFirestore_1.getAppFirestore)();
    const userSnapshot = await db.collection('users').doc(request.auth.uid).get();
    const updatedByDisplayName = userSnapshot.exists && typeof userSnapshot.data()?.displayName === 'string'
        ? userSnapshot.data().displayName
        : null;
    const settings = (0, systemAlerts_1.sanitizeSystemAlertSettings)(request.data || {});
    await (0, systemAlerts_1.getSystemAlertSettingsDocRef)().set({
        ...settings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth.uid,
        updatedByDisplayName,
    }, { merge: true });
    return {
        success: true,
        settings: {
            ...settings,
            updatedByUid: request.auth.uid,
            updatedByDisplayName,
        },
    };
});
//# sourceMappingURL=updateSystemAlertSettings.js.map