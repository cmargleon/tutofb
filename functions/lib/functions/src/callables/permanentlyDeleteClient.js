"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permanentlyDeleteClient = void 0;
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
exports.permanentlyDeleteClient = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el cliente a borrar.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const clientRef = db.collection('clients').doc(id);
    const clientSnapshot = await clientRef.get();
    if (!clientSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'No se encontró el cliente seleccionado.');
    }
    const client = clientSnapshot.data();
    if (!(0, domain_1.isArchivedCatalogEntity)(client)) {
        throw new https_1.HttpsError('failed-precondition', 'Primero archiva el cliente antes de borrarlo definitivamente.');
    }
    await clientRef.delete();
    return {
        success: true,
        id,
    };
});
//# sourceMappingURL=permanentlyDeleteClient.js.map