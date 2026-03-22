"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permanentlyDeleteModel = void 0;
const https_1 = require("firebase-functions/v2/https");
const domain_1 = require("../../../shared/src/domain");
const roles_1 = require("../auth/roles");
const appFirestore_1 = require("../firebase/appFirestore");
exports.permanentlyDeleteModel = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id) {
        throw new https_1.HttpsError('invalid-argument', 'Debes indicar el modelo a borrar.');
    }
    const db = (0, appFirestore_1.getAppFirestore)();
    const modelRef = db.collection('models').doc(id);
    const modelSnapshot = await modelRef.get();
    if (!modelSnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'No se encontró el modelo seleccionado.');
    }
    const model = modelSnapshot.data();
    if (!(0, domain_1.isArchivedCatalogEntity)(model)) {
        throw new https_1.HttpsError('failed-precondition', 'Primero archiva el modelo antes de borrarlo definitivamente.');
    }
    await modelRef.delete();
    return {
        success: true,
        id,
    };
});
//# sourceMappingURL=permanentlyDeleteModel.js.map