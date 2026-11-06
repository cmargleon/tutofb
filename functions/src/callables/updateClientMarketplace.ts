import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { UpdateClientMarketplaceRequest } from '../../../shared/src/types';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const saveClientMarketplace = async (input: UpdateClientMarketplaceRequest, db: Firestore = getAppFirestore()) => {
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,200}$/.test(input.clientId)
    || !isMarketplaceId(input.marketplaceId)
    || Object.keys(input).some(key => !['clientId', 'marketplaceId', 'enabled', 'settings'].includes(key))
    || (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    || (input.enabled === undefined && input.settings === undefined)) {
    throw new HttpsError('invalid-argument', 'Configuración de marketplace inválida.');
  }
  const settings = input.settings;
  if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || Object.entries(settings).some(([key, value]) => !['region', 'sellerId'].includes(key)
      || typeof value !== 'string' || value.length > (key === 'region' ? 80 : 200) || /[\u0000-\u001f]/.test(value)))) {
    throw new HttpsError('invalid-argument', 'Solo se permiten región e identificador de vendedor, sin credenciales.');
  }
  const ref = db.collection('clients').doc(input.clientId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.status === 'archived') throw new HttpsError('not-found', 'Cliente no disponible.');
    const previous = snapshot.data()?.marketplaces?.[input.marketplaceId] ?? {};
    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      [`marketplaces.${input.marketplaceId}`]: {
        ...previous, enabled: previous.enabled === true,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(settings === undefined ? {} : { settings: { ...previous.settings,
          ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, value.trim()])) } }),
        updatedAt: now,
      },
      updatedAt: now,
    });
  });
  return { success: true };
};

export const updateClientMarketplace = onCall<UpdateClientMarketplaceRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  return saveClientMarketplace(request.data);
});
