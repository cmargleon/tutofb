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
exports.permanentlyDeleteAppUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const roles_1 = require("../auth/roles");
const userManagement_helpers_1 = require("./userManagement.helpers");
exports.permanentlyDeleteAppUser = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
    }
    const uid = typeof request.data?.uid === 'string' ? request.data.uid.trim() : '';
    if (!uid) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el usuario a borrar.');
    }
    if (request.auth.uid === uid) {
        throw new https_1.HttpsError('permission-denied', 'No puedes borrar tu propia cuenta desde este panel.');
    }
    const existingUser = await (0, userManagement_helpers_1.loadUserDoc)(uid);
    if (!existingUser) {
        throw new https_1.HttpsError('not-found', 'No se encontró el usuario seleccionado.');
    }
    if (!(0, domain_1.isArchivedCatalogEntity)(existingUser)) {
        throw new https_1.HttpsError('failed-precondition', 'Primero archiva el usuario antes de borrarlo definitivamente.');
    }
    try {
        await admin.auth().deleteUser(uid);
    }
    catch (error) {
        if (error?.code === 'auth/user-not-found') {
            throw new https_1.HttpsError('not-found', 'El usuario ya no existe en Firebase Auth.');
        }
        throw new https_1.HttpsError('internal', 'No se pudo borrar el usuario en Firebase Auth.');
    }
    await admin.firestore().collection('users').doc(uid).delete();
    return {
        success: true,
        uid,
    };
});
//# sourceMappingURL=permanentlyDeleteAppUser.js.map