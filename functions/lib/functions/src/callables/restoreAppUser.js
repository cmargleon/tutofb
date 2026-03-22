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
exports.restoreAppUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const userManagement_helpers_1 = require("./userManagement.helpers");
exports.restoreAppUser = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
    if (!uid) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el usuario a restaurar.');
    }
    const existingUser = await (0, userManagement_helpers_1.loadUserDoc)(uid);
    if (!existingUser) {
        throw new https_1.HttpsError('not-found', 'No se encontró el usuario seleccionado.');
    }
    await admin.firestore().collection('users').doc(uid).set({
        active: false,
        status: 'active',
        archivedAt: null,
        archivedByUid: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await admin.auth().updateUser(uid, {
        disabled: true,
    });
    await (0, userManagement_helpers_1.applyUserClaims)(uid, {
        role: existingUser.role,
        active: false,
    });
    return { success: true, uid };
});
//# sourceMappingURL=restoreAppUser.js.map