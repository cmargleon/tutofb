import { useEffect, useState } from 'react';
import type { OrganizerProductContext, OrganizerProductWorkflow } from '../../../shared/src/types';
import { organizer } from './firebase';

export function workflowUrl(
  path: '/organizador' | '/generate' | '/catalogo',
  context: Pick<OrganizerProductContext, 'clientId' | 'variantId'> & Partial<Pick<OrganizerProductContext, 'baseProductId'>>,
  options: { batchId?: string; view?: 'photos' | 'export' } = {},
) {
  const params = new URLSearchParams({ clientId: context.clientId, variantId: context.variantId });
  if (context.baseProductId) params.set('baseProductId', context.baseProductId);
  if (options.batchId) params.set('batchId', options.batchId);
  if (options.view) params.set('view', options.view);
  return `${path}?${params}`;
}

export function useProductWorkflow(clientId: string, variantId: string, baseProductId: string, batchId?: string, revision = 0) {
  const key = JSON.stringify([clientId, variantId, baseProductId, batchId, revision]);
  const [result, setResult] = useState<{ key: string; workflow?: OrganizerProductWorkflow; error?: string }>();
  useEffect(() => {
    if (!clientId || !variantId) return;
    let active = true;
    void organizer<OrganizerProductWorkflow>({
      action: 'workflow', clientId, variantId, baseProductId: baseProductId || undefined, batchId,
    }).then(workflow => { if (active) setResult({ key, workflow }); })
      .catch(error => { if (active) setResult({ key, error: error.message }); });
    return () => { active = false; };
  }, [key, clientId, variantId, baseProductId, batchId]);
  return result?.key === key ? result : undefined;
}
