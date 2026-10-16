import { HttpsError } from 'firebase-functions/v2/https';
import { isAspectRatio, isProvider } from '../../../shared/src/domain';
import { isProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import type { CreateProductGenerationBatchRequest } from '../../../shared/src/types';

const text = (value: unknown, name: string, max: number, allowEmpty = false): string => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new HttpsError('invalid-argument', `${name} inválido.`);
  }
  return value.trim();
};
const identifier = (value: unknown, name: string): string => {
  const result = text(value, name, 200);
  if (!/^[\w @.:+-]+$/.test(result) || result.includes('..')) throw new HttpsError('invalid-argument', `${name} inválido.`);
  return result;
};
export const validateProductGenerationInput = (value: unknown, uid: string, maxJobs: number): CreateProductGenerationBatchRequest => {
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const data = value as CreateProductGenerationBatchRequest;
  if (!isProvider(data.provider)) throw new HttpsError('invalid-argument', 'Proveedor inválido.');
  if (data.imageConfig != null && (!isProviderImageConfig(data.imageConfig) || data.imageConfig.provider !== data.provider)) throw new HttpsError('invalid-argument', 'La configuración de imagen no coincide con el proveedor.');
  if (data.aspectRatio != null && !isAspectRatio(data.aspectRatio)) throw new HttpsError('invalid-argument', 'Formato de imagen inválido.');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 40) throw new HttpsError('invalid-argument', 'Selecciona entre 1 y 40 objetos.');
  if (!Array.isArray(data.scenes) || !data.scenes.length || data.scenes.length > PRODUCT_SCENES.length) throw new HttpsError('invalid-argument', 'Selecciona al menos una escena.');
  const items = data.items.map((item) => {
    if (!item || !Array.isArray(item.referencePaths) || !item.referencePaths.length || item.referencePaths.length > 4) throw new HttpsError('invalid-argument', 'Cada objeto requiere entre 1 y 4 fotos.');
    const referencePaths = item.referencePaths.map((path) => {
      if (typeof path !== 'string' || path.length > 1024 || !path.startsWith(`garments/drafts/${uid}/`) || path.includes('..') || path.includes('//')) {
        throw new HttpsError('permission-denied', 'La imagen no pertenece al usuario.');
      }
      return path;
    });
    return { id: identifier(item.id, 'Objeto'), name: text(item.name, 'Nombre del objeto', 200), referencePaths };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new HttpsError('invalid-argument', 'Hay objetos duplicados.');
  if (items.reduce((sum, item) => sum + item.referencePaths.length, 0) > 40) throw new HttpsError('invalid-argument', 'Máximo 40 fotos por lote.');
  const scenes = data.scenes.map((scene) => {
    if (!scene || !PRODUCT_SCENES.some((preset) => preset.type === scene.type)) throw new HttpsError('invalid-argument', 'Escena inválida.');
    return { type: scene.type, prompt: text(scene.prompt, 'Prompt de escena', 4000) };
  });
  if (new Set(scenes.map((scene) => scene.type)).size !== scenes.length) throw new HttpsError('invalid-argument', 'Hay escenas duplicadas.');
  if (items.length * scenes.length > maxJobs) throw new HttpsError('out-of-range', `El lote excede el límite de ${maxJobs} imágenes.`);
  return { requestId: identifier(data.requestId, 'Solicitud'), clientId: identifier(data.clientId, 'Cliente'), items, scenes,
    provider: data.provider, prompt: text(data.prompt, 'Instrucciones generales', 8000, true),
    ...(data.aspectRatio ? { aspectRatio: data.aspectRatio } : {}), ...(data.imageConfig ? { imageConfig: data.imageConfig } : {}),
  };
};
