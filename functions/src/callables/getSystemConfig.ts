import { onCall } from 'firebase-functions/v2/https';
import { GetSystemConfigResponse } from '../../../shared/src/types';
import { assertCallableRoles } from '../auth/roles';
import { getSystemConfigDocRef, sanitizeSystemConfig, DEFAULT_SYSTEM_CONFIG } from '../admin/systemConfig';

export const getSystemConfig = onCall<Record<string, never>, Promise<GetSystemConfigResponse>>(
  async (request) => {
    await assertCallableRoles(request, ['admin']);
    const snapshot = await getSystemConfigDocRef().get();
    const config = snapshot.exists
      ? sanitizeSystemConfig(snapshot.data() as any)
      : { ...DEFAULT_SYSTEM_CONFIG };
    return { config };
  },
);
