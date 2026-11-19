import { useModelMarketplaceRules } from '../marketplaceRules/useModelMarketplaceRules';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { selectedModelMarketplacePoses } from '../../../../shared/src/modelMarketplaceRules';
import type { Client, Model, ModelPhotoProvider, ModelPhotoSetsRequest, ModelPhotoSetsPreview, ProviderImageConfig, GenerateModelBaseRequest } from '../../../../shared/src/types';
import { sameBaseSpec } from '../../../../shared/src/modelPhotoSets';
import { activePhotoChannels } from '../../../../shared/src/marketplacePhotoPlan';
import { approveModelIdentity, generateModelMarketplaceBase, previewModelPhotoSets, verifyModelMarketplaceBase } from '../firebase';
import { useConfirm, useToast } from '../../feedback/FeedbackProvider';

export function useModelPhotoSets(model: Model, client?: Client, options: { wizard?: boolean; onBusyChange?: (busy: boolean) => void; initialProvider?: ModelPhotoProvider; initialImageConfig?: ProviderImageConfig } = {}) {
  const active = activePhotoChannels(client?.marketplaces);
  const [channels, setChannels] = useState(active);
  const initializedClient = useRef(Boolean(client));
  useEffect(() => { if (client && !initializedClient.current) { initializedClient.current = true; setChannels(activePhotoChannels(client.marketplaces)); } }, [client]);
  const { rules, loading: rulesLoading, error: rulesError } = useModelMarketplaceRules();
  const selectedChannels = channels.filter(channel => active.includes(channel));
  const suggestedPoseIds = selectedModelMarketplacePoses(selectedChannels, rules);
  const existingPoseIds = [...new Set(model.poses.flatMap(pose => pose.marketplaceBaseSpec?.poseRecipeId ? [pose.marketplaceBaseSpec.poseRecipeId] : []))];
  // Historical catalogue sets keep their general recipe until marketplace rules are configured.
  const defaultPoseIds = options.wizard || selectedChannels.some(channel => rules[channel]) ? suggestedPoseIds : existingPoseIds.length ? existingPoseIds : undefined;
  const selectionKey = JSON.stringify([model.id, [...selectedChannels].sort(), suggestedPoseIds]);
  const [manualSelection, setManualSelection] = useState<{ key: string; ids: string[] | undefined } | null>(null);
  const poseRecipeIds = manualSelection?.key === selectionKey ? manualSelection.ids : defaultPoseIds;
  const setPoseRecipeIds = (update: SetStateAction<string[] | undefined>) => setManualSelection(current => {
    const previous = current?.key === selectionKey ? current.ids : defaultPoseIds;
    return { key: selectionKey, ids: typeof update === 'function' ? update(previous) : update };
  });
  const [category, setCategory] = useState<ModelPhotoSetsRequest['category']>('ordinary');
  const [bodyArea, setBodyArea] = useState<ModelPhotoSetsRequest['bodyArea']>('upper_body');
  const [aspectRatio, setAspectRatio] = useState<ModelPhotoSetsRequest['aspectRatio']>();
  const [provider, setProvider] = useState<ModelPhotoProvider | undefined>(options.initialProvider);
  const [preview, setPreview] = useState<ModelPhotoSetsPreview | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [identityPoseId, setIdentityPoseId] = useState(model.approvedIdentity?.poseId || model.poses[0]?.id || '');
  const [performer, setPerformer] = useState<'synthetic' | 'real'>(model.approvedIdentity?.performer || 'synthetic');
  const toast = useToast(), confirm = useConfirm();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request: ModelPhotoSetsRequest = { modelId: model.id!, ...(poseRecipeIds ? { poseRecipeIds } : {}), channels: channels.filter(c => active.includes(c)), category, bodyArea, ...(aspectRatio ? { aspectRatio } : {}), ...(provider ? { provider } : {}), ...(provider === options.initialProvider && options.initialImageConfig ? { imageConfig: options.initialImageConfig } : {}) };
  const requestIds = useRef(new Map<string, GenerateModelBaseRequest>());
  const running = useRef(false);
  const requestSignature = JSON.stringify(request);
  useEffect(() => { setIssues([]); }, [requestSignature]);
  const signature = JSON.stringify([rules, request, model.approvedIdentity, model.marketplaceBaseApprovals, model.poses]);
  useEffect(() => {
    let stale = false;
    setPreview(null);
    if (rulesLoading) return;
    void previewModelPhotoSets(request).then(result => { if (!stale) setPreview(result); }).catch(error => { if (!stale) setIssues([error.message]); });
    return () => { stale = true; };
  }, [signature, rulesLoading]);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; options.onBusyChange?.(true);
    setBusy(true); setIssues([]);
    try { await action(); }
    catch (error) { const message = error instanceof Error ? error.message : 'Operación fallida'; setIssues([message]); toast({ tone: 'error', title: 'Revisa el set', description: message }); }
    finally { running.current = false; options.onBusyChange?.(false); if (mounted.current) { setBusy(false); setProgress(''); } }
  };
  const approveIdentity = () => run(async () => {
    if (model.approvedIdentity && model.approvedIdentity.poseId !== identityPoseId && !await confirm({ title: 'Cambiar identidad aprobada', description: 'Los sets vinculados a otra identidad necesitarán verificación de nuevo.', confirmLabel: 'Aprobar esta identidad' })) return;
    await approveModelIdentity(model.id!, identityPoseId, performer);
    toast({ tone: 'success', title: 'Identidad aprobada', description: 'Ya puedes preparar las bases de sus marketplaces.' });
  });
  const generate = (shots: NonNullable<ModelPhotoSetsPreview>['shots']) => run(async () => {
    shots = shots.filter(shot => !shot.poseId);
    if (!preview || preview.issues.length) return;
    const cost = shots.reduce((sum, shot) => sum + shot.estimatedCostUsd, 0);
    if (!shots.length || !await confirm({ title: `Generar ${shots.length} bases`, description: `Estimación USD ${cost.toFixed(3)}, incluida la verificación visual; sin reintentos automáticos. Las combinaciones incompatibles indicadas quedan excluidas del cobro. Se conservarán las candidatas que no se aprueben.`, confirmLabel: 'Generar estas bases' })) return;
    const results: string[] = [];
    for (const [index, shot] of shots.entries()) {
      setProgress(`${index + 1} / ${shots.length} · ${shot.spec.channel} · ${shot.spec.shot}`);
      const scoped = { ...request, channels: [shot.spec.channel] };
      const fresh = await previewModelPhotoSets(scoped);
      const freshShot = fresh.shots.find(s => sameBaseSpec(s.spec, shot.spec));
      if (!freshShot || freshShot.estimatedCostUsd > shot.estimatedCostUsd || fresh.identitySha256 !== preview?.identitySha256) throw new Error('La receta, identidad o costo cambió. Revisa la estimación antes de continuar.');
      if (freshShot.poseId) continue;
      const key = JSON.stringify([shot.spec, fresh.identitySha256, fresh.provider, request.imageConfig || null]);
      const generationRequest = requestIds.current.get(key) || { ...scoped, channel: shot.spec.channel, shot: shot.spec.shot, ...(shot.spec.poseRecipeId ? { poseRecipeId: shot.spec.poseRecipeId } : {}), requestId: crypto.randomUUID(), approvedPreviewId: fresh.id };
      requestIds.current.set(key, generationRequest);
      try {
        const result = await generateModelMarketplaceBase(generationRequest);
        requestIds.current.delete(key);
        results.push(...result.issues.map(issue => `${shot.spec.channel} · ${shot.spec.poseRecipeId || shot.spec.shot}: ${issue}`));
      } catch (error) {
        if ((error as { details?: { modelBaseOperationFailed?: boolean } })?.details?.modelBaseOperationFailed) requestIds.current.delete(key);
        results.push(`${shot.spec.channel} · ${shot.spec.poseRecipeId || shot.spec.shot}: ${error instanceof Error ? error.message : 'Error de generación'}`);
      }
    }
    setIssues(results);
    toast({ tone: results.length ? 'warning' : 'success', title: results.length ? 'Bases con incidencias' : 'Bases verificadas', description: `${shots.length} tomas procesadas.` });
  });
  const verify = (shot: NonNullable<ModelPhotoSetsPreview>['shots'][number], poseId: string) => run(async () => {
    if (!await confirm({ title: 'Verificar base existente', description: 'Se compara la identidad y composición con Gemini y se comprueba el archivo. Estimación de análisis: USD 0.01. No se genera otra imagen.', confirmLabel: 'Verificar base' })) return;
    setProgress('Verificando identidad y composición…');
    const result = await verifyModelMarketplaceBase({ ...request, channel: shot.spec.channel, shot: shot.spec.shot, ...(shot.spec.poseRecipeId ? { poseRecipeId: shot.spec.poseRecipeId } : {}), poseId });
    setIssues(result.issues);
    toast({ tone: result.approved ? 'success' : 'warning', title: result.approved ? 'Base aprobada para esta toma' : 'Base incompatible', description: result.issues.join(' ') });
  });
  return { rulesLoading, rulesError, poseRecipeIds, setPoseRecipeIds, active, channels, setChannels, category, setCategory, bodyArea, setBodyArea, aspectRatio, setAspectRatio, provider, setProvider, preview, busy, progress, issues,
    identityPoseId, setIdentityPoseId, performer, setPerformer, approveIdentity, generate, verify };
}
