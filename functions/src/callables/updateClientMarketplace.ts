import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { UpdateClientMarketplaceRequest } from '../../../shared/src/types';
import { conflictingFields } from '../../../shared/src/fieldConcurrency';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { isPhotoRecipe } from '../../../shared/src/marketplacePhotoRecipe';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const saveClientMarketplace = async (input: UpdateClientMarketplaceRequest, db: Firestore = getAppFirestore()) => {
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,200}$/.test(input.clientId)
    || !isMarketplaceId(input.marketplaceId)
    || Object.keys(input).some(key => !['clientId', 'marketplaceId', 'enabled', 'settings', 'expected', 'photoRecipe', 'expectedPhotoRecipeRevision'].includes(key))
    || (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    || (input.enabled === undefined && input.settings === undefined && input.photoRecipe === undefined)) {
    throw new HttpsError('invalid-argument', 'Configuración de marketplace inválida.');
  }
  if (input.photoRecipe !== undefined && (input.photoRecipe !== null && !isPhotoRecipe(input.photoRecipe, input.marketplaceId)
    || !Number.isSafeInteger(input.expectedPhotoRecipeRevision) || input.expectedPhotoRecipeRevision! < 0)) {
    throw new HttpsError('invalid-argument', 'Receta fotográfica o versión esperada inválida.');
  }
  const settings = input.settings;
  if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || Object.entries(settings).some(([key, value]) => !['region', 'sellerId'].includes(key)
      || typeof value !== 'string' || value.length > (key === 'region' ? 80 : 200) || /[\u0000-\u001f]/.test(value)))) {
    throw new HttpsError('invalid-argument', 'Solo se permiten región e identificador de vendedor, sin credenciales.');
  }
  if (input.expected !== undefined && (!input.expected || typeof input.expected !== 'object' || Array.isArray(input.expected)
    || Object.entries(input.expected).some(([key, value]) => !['enabled', 'region', 'sellerId'].includes(key)
      || (key === 'enabled' ? typeof value !== 'boolean' : typeof value !== 'string'))))
    throw new HttpsError('invalid-argument', 'Estado esperado inválido.');
  const ref = db.collection('clients').doc(input.clientId);
  const saved = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
    const previous = snapshot.data()?.marketplaces?.[input.marketplaceId] ?? {};
    const current = { enabled: previous.enabled === true, region: previous.settings?.region ?? '', sellerId: previous.settings?.sellerId ?? '' };
    const patch = { ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...settings };
    const conflicts = conflictingFields(current, patch, input.expected);
    if (conflicts.length) throw new HttpsError('aborted', 'El marketplace cambió en otra sesión. Revisa los valores actuales antes de guardar.', { conflicts, current });
    const revision = previous.photoRecipeRevision ?? 0;
    if (input.photoRecipe !== undefined && input.expectedPhotoRecipeRevision !== revision)
      throw new HttpsError('aborted', 'La receta fotográfica cambió en otra sesión. Recarga su versión antes de guardar.', {
        current: { ...current, photoRecipe: previous.photoRecipe ?? null, photoRecipeRevision: revision },
      });
    const recipePatch = input.photoRecipe === undefined ? {} : {
      photoRecipe: input.photoRecipe,
      photoRecipeRevision: revision + 1,
    };
    const { photoRecipe: previousRecipe, ...previousFields } = previous;
    const recipe = input.photoRecipe === undefined ? previousRecipe : input.photoRecipe;
    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      [`marketplaces.${input.marketplaceId}`]: {
        ...previousFields, enabled: previous.enabled === true,
        ...(recipe == null ? {} : { photoRecipe: recipe }),
        ...(recipePatch.photoRecipeRevision === undefined ? {} : { photoRecipeRevision: recipePatch.photoRecipeRevision }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(settings === undefined ? {} : { settings: { ...previous.settings,
          ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, value.trim()])) } }),
        updatedAt: now,
      },
      updatedAt: now,
    });
    return { ...current, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])), ...recipePatch };
  });
  return { success: true, current: saved };
};

export const updateClientMarketplace = onCall<UpdateClientMarketplaceRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  return saveClientMarketplace(request.data);
});
