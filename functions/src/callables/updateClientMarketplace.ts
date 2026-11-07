import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { UpdateClientMarketplaceRequest } from '../../../shared/src/types';
import { conflictingFields } from '../../../shared/src/fieldConcurrency';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { assertCallableRoles } from '../auth/roles';
import { getAppFirestore } from '../firebase/appFirestore';

export const saveClientMarketplace = async (input: UpdateClientMarketplaceRequest, db: Firestore = getAppFirestore()) => {
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,200}$/.test(input.clientId)
    || !isMarketplaceId(input.marketplaceId)
    || Object.keys(input).some(key => !['clientId', 'marketplaceId', 'enabled', 'settings', 'expected'].includes(key))
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
    return { ...current, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])) };
  });
  return { success: true, current: saved };
};

export const updateClientMarketplace = onCall<UpdateClientMarketplaceRequest>(async request => {
  await assertCallableRoles(request, ['admin']);
  return saveClientMarketplace(request.data);
});
