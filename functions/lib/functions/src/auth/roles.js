"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertUserRoles = exports.assertCallableRoles = exports.getUserRole = exports.getRequestRole = void 0;
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
const getRequestRole = async (request) => {
    if (!request.auth) {
        return null;
    }
    return (0, exports.getUserRole)(request.auth.uid, request.auth.token.role);
};
exports.getRequestRole = getRequestRole;
const getUserRole = async (uid, tokenRole) => {
    if (tokenRole === 'admin' || tokenRole === 'operador' || tokenRole === 'revisor') {
        return tokenRole;
    }
    const user = await loadUserDoc(uid);
    if (!user || !user.active || (0, domain_1.isArchivedCatalogEntity)(user)) {
        return null;
    }
    return user.role;
};
exports.getUserRole = getUserRole;
const assertCallableRoles = async (request, allowedRoles) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
    }
    const role = await (0, exports.getRequestRole)(request);
    if (!role || !allowedRoles.includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'No tienes permisos para ejecutar esta acción.');
    }
    return role;
};
exports.assertCallableRoles = assertCallableRoles;
const assertUserRoles = async (uid, tokenRole, allowedRoles) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para continuar.');
    }
    const role = await (0, exports.getUserRole)(uid, tokenRole);
    if (!role || !allowedRoles.includes(role)) {
        throw new https_1.HttpsError('permission-denied', 'No tienes permisos para ejecutar esta acción.');
    }
    return role;
};
exports.assertUserRoles = assertUserRoles;
//# sourceMappingURL=roles.js.map