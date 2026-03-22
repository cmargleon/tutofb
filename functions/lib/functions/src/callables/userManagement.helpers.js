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
exports.buildUserResponse = exports.upsertUserDoc = exports.applyUserClaims = exports.sanitizeUpdateUserInput = exports.sanitizeCreateUserInput = exports.loadUserDoc = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const appFirestore_1 = require("../firebase/appFirestore");
const loadUserDoc = async (uid) => {
    const snapshot = await (0, appFirestore_1.getAppFirestore)().collection('users').doc(uid).get();
    if (!snapshot.exists) {
        return null;
    }
    return snapshot.data();
};
exports.loadUserDoc = loadUserDoc;
const normalizeEmail = (value) => {
    if (typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un email válido.');
    }
    const email = value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar un email válido.');
    }
    return email;
};
const normalizeDisplayName = (value) => {
    if (typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el nombre del usuario.');
    }
    const displayName = value.trim();
    if (!displayName) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el nombre del usuario.');
    }
    return displayName;
};
const normalizeRole = (value) => {
    if (!(0, domain_1.isRole)(value)) {
        throw new https_1.HttpsError('invalid-argument', 'El rol indicado no es válido.');
    }
    return value;
};
const normalizeActive = (value) => {
    if (typeof value !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar si el usuario estará activo.');
    }
    return value;
};
const normalizePassword = (value, required) => {
    if (value == null || value === '') {
        if (required) {
            throw new https_1.HttpsError('invalid-argument', 'Debes indicar una contraseña inicial.');
        }
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'La contraseña no es válida.');
    }
    const password = value.trim();
    if (password.length < 8) {
        throw new https_1.HttpsError('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.');
    }
    return password;
};
const sanitizeCreateUserInput = (data) => {
    const payload = (data || {});
    return {
        email: normalizeEmail(payload.email),
        displayName: normalizeDisplayName(payload.displayName),
        password: normalizePassword(payload.password, true),
        role: normalizeRole(payload.role),
        active: normalizeActive(payload.active),
    };
};
exports.sanitizeCreateUserInput = sanitizeCreateUserInput;
const sanitizeUpdateUserInput = (data) => {
    const payload = (data || {});
    const uid = typeof payload.uid === 'string' ? payload.uid.trim() : '';
    if (!uid) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el usuario a actualizar.');
    }
    return {
        uid,
        email: normalizeEmail(payload.email),
        displayName: normalizeDisplayName(payload.displayName),
        password: normalizePassword(payload.password, false),
        role: normalizeRole(payload.role),
        active: normalizeActive(payload.active),
    };
};
exports.sanitizeUpdateUserInput = sanitizeUpdateUserInput;
const applyUserClaims = async (uid, user) => {
    await admin.auth().setCustomUserClaims(uid, {
        role: user.role,
        active: user.active,
    });
};
exports.applyUserClaims = applyUserClaims;
const upsertUserDoc = async ({ uid, email, displayName, role, active, existingUser, }) => {
    const payload = {
        uid,
        email,
        displayName,
        role,
        active,
        status: existingUser?.status ?? 'active',
        archivedAt: existingUser?.archivedAt ?? null,
        archivedByUid: existingUser?.archivedByUid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (!existingUser) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        payload.lastLoginAt = null;
    }
    await (0, appFirestore_1.getAppFirestore)().collection('users').doc(uid).set(payload, { merge: true });
};
exports.upsertUserDoc = upsertUserDoc;
const buildUserResponse = async (uid) => {
    const user = await (0, exports.loadUserDoc)(uid);
    if (!user) {
        throw new https_1.HttpsError('internal', 'No se pudo cargar el usuario actualizado.');
    }
    return user;
};
exports.buildUserResponse = buildUserResponse;
//# sourceMappingURL=userManagement.helpers.js.map