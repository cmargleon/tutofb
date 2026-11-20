import { groupModelCatalogPoses } from '../../../../shared/src/modelPoseCatalog';
import { useModelMarketplaceRules } from '../marketplaceRules/useModelMarketplaceRules';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { selectedModelMarketplacePoses } from '../../../../shared/src/modelMarketplaceRules';
import type { Client, Model, ModelPhotoProvider, ModelPhotoSetsRequest, ModelPhotoSetsPreview, ProviderImageConfig, ModelBaseOperation, ScheduleModelPhotoSetsRequest } from '../../../../shared/src/types';
import { modelBaseResumable, sameBaseSpec } from '../../../../shared/src/modelPhotoSets';
import { activePhotoChannels } from '../../../../shared/src/marketplacePhotoPlan';
import { approveModelIdentity, scheduleModelMarketplaceSets, subscribeModelBaseOperations, previewModelPhotoSets, verifyModelMarketplaceBase } from '../firebase';
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
  const [actionBusy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [operations, setOperations] = useState<ModelBaseOperation[]>([]);
  const [operationError, setOperationError] = useState('');
  useEffect(() => subscribeModelBaseOperations(model.id!, setOperations, error => setOperationError(error.message)), [model.id]);
  const busy = actionBusy || operations.some(op => ['queued', 'generating', 'verifying'].includes(op.status));
  useEffect(() => { options.onBusyChange?.(busy); }, [busy, options.onBusyChange]);
  const operationFor = (shot: ModelPhotoSetsPreview['shots'][number]) => operations.find(op => op.identitySha256 === model.approvedIdentity?.sha256 && sameBaseSpec(op.spec, shot.spec));
  const canGenerate = (shot: ModelPhotoSetsPreview['shots'][number]) => { const op = operationFor(shot); return !shot.poseId && (!op || modelBaseResumable(op)); };
  const [issues, setIssues] = useState<string[]>([]);
  const [identityPoseId, setIdentityPoseId] = useState(model.approvedIdentity?.poseId || model.poses[0]?.id || '');
  const [performer, setPerformer] = useState<'synthetic' | 'real'>(model.approvedIdentity?.performer || 'synthetic');
  const toast = useToast(), confirm = useConfirm();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request: ModelPhotoSetsRequest = { modelId: model.id!, ...(poseRecipeIds ? { poseRecipeIds } : {}), channels: channels.filter(c => active.includes(c)), category, bodyArea, ...(aspectRatio ? { aspectRatio } : {}), ...(provider ? { provider } : {}), ...(provider === options.initialProvider && options.initialImageConfig ? { imageConfig: options.initialImageConfig } : {}) };
  const scheduledRequest = useRef<ScheduleModelPhotoSetsRequest | null>(null);
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
    shots = shots.filter(canGenerate);
    const resumed = shots.filter(shot => operationFor(shot)).length;
    const cost = shots.reduce((sum, shot) => sum + shot.estimatedCostUsd, 0);
    if (!shots.length || !await confirm({ title: `Generar ${shots.length} bases`, description: `Estimación inicial USD ${cost.toFixed(3)}; máximo previsto USD ${(cost * 3).toFixed(3)} con hasta 3 intentos por combinación, incluida la verificación con Gemini. Se detiene al aprobar. El costo real del análisis depende del uso. Las aprobadas se conservan y el proceso continúa aunque cierres la página.${resumed ? ` ${resumed} combinaciones se reanudan tras un error técnico sin imagen; sus intentos con imagen siguen contando para el máximo.` : ''}`, confirmLabel: 'Generar estas bases' })) return;
    const next: ScheduleModelPhotoSetsRequest = { ...request, requestId: crypto.randomUUID(), approvedPreviewId: preview.id,
      combinations: shots.map(shot => ({ channel: shot.spec.channel, shot: shot.spec.shot, ...(shot.spec.poseRecipeId ? { poseRecipeId: shot.spec.poseRecipeId } : {}) })) };
    // Keep the same request after an ambiguous network response; the backend deduplicates it.
    const pending = scheduledRequest.current;
    const data = pending && JSON.stringify({ ...pending, requestId: '' }) === JSON.stringify({ ...next, requestId: '' }) ? pending : next;
    scheduledRequest.current = data;
    await scheduleModelMarketplaceSets(data);
    scheduledRequest.current = null;
    toast({ tone: 'success', title: 'Bases en cola', description: `${shots.length} combinaciones continúan en segundo plano.` });
  });
  const verify = (shot: NonNullable<ModelPhotoSetsPreview>['shots'][number], poseId: string) => run(async () => {
    if (!await confirm({ title: 'Verificar base existente', description: 'Se compara la identidad y composición con Gemini y se comprueba el archivo. Estimación de análisis: USD 0.01. No se genera otra imagen.', confirmLabel: 'Verificar base' })) return;
    setProgress('Verificando identidad y composición…');
    const result = await verifyModelMarketplaceBase({ ...request, channel: shot.spec.channel, shot: shot.spec.shot, ...(shot.spec.poseRecipeId ? { poseRecipeId: shot.spec.poseRecipeId } : {}), poseId });
    setIssues(result.issues);
    toast({ tone: result.approved ? 'success' : 'warning', title: result.approved ? 'Base aprobada para esta toma' : 'Base incompatible', description: result.issues.join(' ') });
  });
  return { catalogGroups: groupModelCatalogPoses(model, operations), rulesLoading, rulesError, poseRecipeIds, setPoseRecipeIds, active, channels, setChannels, category, setCategory, bodyArea, setBodyArea, aspectRatio, setAspectRatio, provider, setProvider, preview, busy, progress, issues: operationError ? [...issues, operationError] : issues, operationFor, canGenerate,
    identityPoseId, setIdentityPoseId, performer, setPerformer, approveIdentity, generate, verify };
}
