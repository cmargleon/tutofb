"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCallableRoles = exports.getRequestRole = void 0;
const https_1 = require("firebase-functions/v2/https");
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
    const tokenRole = request.auth.token.role;
    if (tokenRole === 'admin' || tokenRole === 'operador' || tokenRole === 'revisor') {
        return tokenRole;
    }
    const user = await loadUserDoc(request.auth.uid);
    if (!user || !user.active) {
        return null;
    }
    return user.role;
};
exports.getRequestRole = getRequestRole;
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
//# sourceMappingURL=roles.js.map