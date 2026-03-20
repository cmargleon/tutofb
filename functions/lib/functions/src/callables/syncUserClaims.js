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
exports.syncUserClaims = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
const loadUser = async (uid) => {
    const snapshot = await (0, appFirestore_1.getAppFirestore)().collection('users').doc(uid).get();
    if (!snapshot.exists) {
        return null;
    }
    return snapshot.data();
};
const applyClaimsFromUser = async (uid, user) => {
    await admin.auth().setCustomUserClaims(uid, {
        role: user.role,
        active: user.active,
    });
};
exports.syncUserClaims = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para sincronizar claims.');
    }
    const targetUid = typeof request.data?.uid === 'string' && request.data.uid.trim()
        ? request.data.uid.trim()
        : request.auth.uid;
    const callerRole = await (0, roles_1.getRequestRole)(request);
    const callerIsAdmin = callerRole === 'admin';
    if (!callerIsAdmin && targetUid !== request.auth.uid) {
        throw new https_1.HttpsError('permission-denied', 'Solo un administrador puede sincronizar claims de otros usuarios.');
    }
    if (callerIsAdmin && request.data?.role && !['admin', 'operador', 'revisor'].includes(request.data.role)) {
        throw new https_1.HttpsError('invalid-argument', 'El rol solicitado no es válido.');
    }
    const targetUser = await loadUser(targetUid);
    if (!targetUser) {
        throw new https_1.HttpsError('not-found', 'No se encontró el documento del usuario.');
    }
    if (!targetUser.active) {
        await applyClaimsFromUser(targetUid, targetUser);
        return {
            success: true,
            uid: targetUid,
            role: targetUser.role,
            active: targetUser.active,
        };
    }
    if (callerIsAdmin && request.data?.role && request.data.role !== targetUser.role) {
        await (0, appFirestore_1.getAppFirestore)().collection('users').doc(targetUid).update({
            role: request.data.role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const refreshedUser = await loadUser(targetUid);
        if (!refreshedUser) {
            throw new https_1.HttpsError('internal', 'No se pudo recargar el usuario después de actualizar el rol.');
        }
        await applyClaimsFromUser(targetUid, refreshedUser);
        return {
            success: true,
            uid: targetUid,
            role: refreshedUser.role,
            active: refreshedUser.active,
        };
    }
    await applyClaimsFromUser(targetUid, targetUser);
    return {
        success: true,
        uid: targetUid,
        role: targetUser.role,
        active: targetUser.active,
    };
});
//# sourceMappingURL=syncUserClaims.js.map