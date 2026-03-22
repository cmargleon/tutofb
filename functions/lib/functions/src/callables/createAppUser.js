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
exports.createAppUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const roles_1 = require("../auth/roles");
const userManagement_helpers_1 = require("./userManagement.helpers");
exports.createAppUser = (0, https_1.onCall)(async (request) => {
    await (0, roles_1.assertCallableRoles)(request, ['admin']);
    const input = (0, userManagement_helpers_1.sanitizeCreateUserInput)(request.data);
    let createdUid = null;
    try {
        const authUser = await admin.auth().createUser({
            email: input.email,
            password: input.password,
            displayName: input.displayName,
            disabled: !input.active,
        });
        createdUid = authUser.uid;
        await (0, userManagement_helpers_1.upsertUserDoc)({
            uid: authUser.uid,
            email: input.email,
            displayName: input.displayName,
            role: input.role,
            active: input.active,
            existingUser: null,
        });
        await (0, userManagement_helpers_1.applyUserClaims)(authUser.uid, {
            role: input.role,
            active: input.active,
        });
        return {
            success: true,
            user: await (0, userManagement_helpers_1.buildUserResponse)(authUser.uid),
        };
    }
    catch (error) {
        if (createdUid) {
            await admin.auth().deleteUser(createdUid).catch(() => undefined);
        }
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const message = typeof error?.message === 'string' ? error.message : 'No se pudo crear el usuario.';
        throw new https_1.HttpsError('internal', message);
    }
});
//# sourceMappingURL=createAppUser.js.map