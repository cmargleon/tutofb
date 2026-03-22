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
exports.updateAppUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const userManagement_helpers_1 = require("./userManagement.helpers");
const domain_1 = require("../../../shared/src/domain");
exports.updateAppUser = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
    }
    const input = (0, userManagement_helpers_1.sanitizeUpdateUserInput)(request.data);
    const uid = input.uid;
    const existingUser = await (0, userManagement_helpers_1.loadUserDoc)(uid);
    if (existingUser && (0, domain_1.isArchivedCatalogEntity)(existingUser)) {
        throw new https_1.HttpsError('failed-precondition', 'El usuario está archivado. Restáuralo antes de editarlo.');
    }
    if (request.auth.uid === uid && (!input.active || input.role !== 'admin')) {
        throw new https_1.HttpsError('permission-denied', 'No puedes desactivar tu propia cuenta ni quitarte el rol admin desde este panel.');
    }
    try {
        await admin.auth().getUser(uid);
    }
    catch (error) {
        if (error?.code === 'auth/user-not-found') {
            throw new https_1.HttpsError('not-found', 'El usuario no existe en Firebase Auth.');
        }
        throw new https_1.HttpsError('internal', 'No se pudo cargar el usuario solicitado.');
    }
    try {
        const authProfileUpdates = {
            email: input.email,
            displayName: input.displayName,
        };
        if (input.password) {
            authProfileUpdates.password = input.password;
        }
        await admin.auth().updateUser(uid, authProfileUpdates);
        await (0, userManagement_helpers_1.upsertUserDoc)({
            uid,
            email: input.email,
            displayName: input.displayName,
            role: input.role,
            active: input.active,
            existingUser,
        });
        await admin.auth().updateUser(uid, {
            disabled: !input.active,
        });
        await (0, userManagement_helpers_1.applyUserClaims)(uid, {
            role: input.role,
            active: input.active,
        });
        return {
            success: true,
            user: await (0, userManagement_helpers_1.buildUserResponse)(uid),
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error?.code === 'auth/user-not-found') {
            throw new https_1.HttpsError('not-found', 'El usuario ya no existe en Firebase Auth.');
        }
        const message = typeof error?.message === 'string' ? error.message : 'No se pudo actualizar el usuario.';
        throw new https_1.HttpsError('internal', message);
    }
});
//# sourceMappingURL=updateAppUser.js.map