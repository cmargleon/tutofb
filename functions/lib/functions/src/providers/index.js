"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWithProvider = void 0;
const fal_1 = require("./fal");
const openai_1 = require("./openai");
const generateWithProvider = async (provider, request, secrets) => {
    switch (provider) {
        case 'fal-seedream':
            if (!secrets.falKey) {
                throw new Error('FAL_KEY no está configurada.');
            }
            return (0, fal_1.generateWithFalSeedream)(request, secrets.falKey);
        case 'fal-banana-pro':
            if (!secrets.falKey) {
                throw new Error('FAL_KEY no está configurada.');
            }
            return (0, fal_1.generateWithFalBananaPro)(request, secrets.falKey);
        case 'openai-gpt-image-1.5':
            if (!secrets.openaiApiKey) {
                throw new Error('OPENAI_API_KEY no está configurada.');
            }
            return (0, openai_1.generateWithOpenAI)(request, secrets.openaiApiKey);
        default:
            throw new Error(`Proveedor no soportado: ${provider}`);
    }
};
exports.generateWithProvider = generateWithProvider;
//# sourceMappingURL=index.js.map