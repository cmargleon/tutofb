import { ModelPosesEditGrid } from './ModelPosesEditGrid';
import { ModelPosesViewGrid } from './ModelPosesViewGrid';
import type { UseModelLibraryResult } from '../../features/models/hooks/useModelLibrary';
import { PoseSelectionChips } from './PoseSelectionChips';
import { MODEL_POSE_GROUPS, MODEL_POSE_RECIPES_BY_ID } from '../../features/models/constants';
import { useState } from 'react';
import type { Client, Model, ModelPhotoSetsPreview, ModelPhotoProvider, ProviderImageConfig, ModelBaseOperation } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { MODEL_SET_SHOT_LABELS } from '../../../shared/src/modelPhotoSets';
import { PHOTO_RECIPE_CATEGORIES } from '../../../shared/src/marketplacePhotoRecipe';
import { PHOTO_LABELS } from '../../features/generate/MarketplacePhotoPlanPreview';
import { useModelPhotoSets } from '../../features/models/hooks/useModelPhotoSets';
import { PROVIDER_OPTIONS } from '../../features/models/constants';
import { Alert, Button, ImageThumb } from '../ui';

const OPERATION_LABELS = { queued: 'En cola', generating: 'Generando', verifying: 'Verificando con Gemini', approved: 'Aprobada', needs_attention: 'Revisión manual', failed: 'Error técnico · revisión manual' };

function BaseOperationHistory({ operation, approved }: { operation: ModelBaseOperation; approved: boolean }) {
  return <div className="space-y-1 text-xs text-slate-600">
    <p role="status">{approved ? 'Aprobada' : OPERATION_LABELS[operation.status]} · intento {operation.attemptNumber} de 3</p>
    {!approved && operation.error && <Alert tone="warning">Error técnico: {operation.error}. No se regenera automáticamente.</Alert>}
    {!approved && operation.status === 'needs_attention' && operation.result?.issues.length ? <Alert tone="warning">{operation.result.issues.join(' ')}</Alert> : null}
    <details>
      <summary>Historial de intentos y costos</summary>
      {operation.attempts.map(attempt => <div className="my-2 space-y-1" key={attempt.number}>
        <p>Intento {attempt.number} · generación ${(attempt.generationCostUsd ?? 0).toFixed(4)} · Gemini {attempt.reviewCostUsd === undefined ? 'pendiente o no disponible' : `$${attempt.reviewCostUsd.toFixed(4)} estimados`}</p>
        {attempt.storagePath && <ImageThumb storagePath={attempt.storagePath} alt={`Intento ${attempt.number}`} previewOnClick />}
        <p>{attempt.error || (attempt.verification?.approved ? 'Aprobada' : attempt.verification?.issues.join(' ')) || 'Pendiente'}</p>
      </div>)}
      {operation.technicalErrors?.map((attempt, i) => <p key={`technical-${i}`}>Error técnico previo, sin imagen ni intento consumido: {attempt.error || 'operación interrumpida'}</p>)}
    </details>
  </div>;
}

function BaseShot({ model, shot, sets }: { model: Model; shot: ModelPhotoSetsPreview['shots'][number]; sets: ReturnType<typeof useModelPhotoSets> }) {
  const [existing, setExisting] = useState('');
  const label = shot.spec.poseRecipeId ? MODEL_POSE_RECIPES_BY_ID.get(shot.spec.poseRecipeId)?.label || shot.spec.poseRecipeId : MODEL_SET_SHOT_LABELS[shot.spec.shot];
  const operation = sets.operationFor(shot);
  const poseId = shot.poseId || shot.candidatePoseIds.at(-1);
  const pose = model.poses.find(p => p.id === poseId);
  return <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="relative aspect-[4/3] bg-slate-100">
      {pose ? <ImageThumb storagePath={pose.storagePath} alt={label} previewOnClick /> : <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-500">{label}<br />{PHOTO_LABELS[shot.spec.bodyArea]}</div>}
      <span className={`absolute left-3 top-3 rounded-full px-2 py-1 text-xs font-semibold ${shot.poseId ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{shot.poseId ? 'Aprobada' : operation ? `${OPERATION_LABELS[operation.status]} · intento ${operation.attemptNumber}/3` : pose ? 'Pendiente de aprobación' : 'Falta base'}</span>
    </div>
    <div className="space-y-3 p-4">
      <p className="font-semibold">{label}</p><p className="text-xs text-slate-600">Zona: {PHOTO_LABELS[shot.spec.bodyArea]} · Toma: {shot.spec.shot === 'front' ? 'Frente' : shot.spec.shot === 'commercial_back' ? 'Espalda' : '3/4'}</p>
      <p className="text-xs text-slate-600">{shot.spec.role === 'main' ? 'Portada' : 'Galería'} · {PHOTO_LABELS[shot.spec.background]} · {shot.spec.aspectRatio} · {shot.spec.faceVisible ? shot.spec.lookingAtCamera === false ? 'Rostro visible' : 'Rostro hacia cámara' : 'Sin rostro'}</p>
      {!shot.poseId && shot.issues?.length ? <Alert tone="warning">{shot.issues.join(" ")}</Alert> : null}
      {operation && <BaseOperationHistory operation={operation} approved={Boolean(shot.poseId)} /> }
      {sets.canGenerate(shot) && <Button size="sm" disabled={sets.busy || Boolean(sets.preview?.issues.length)} onClick={() => void sets.generate([shot])}>{operation ? 'Reanudar toma' : pose ? 'Reintentar toma' : 'Generar toma'} · ${shot.estimatedCostUsd.toFixed(3)}</Button>}
      <label className="block text-xs text-slate-600">Incorporar o verificar una base existente
        <select className="tuto-field mt-1 w-full" disabled={sets.busy} value={existing} onChange={e => setExisting(e.target.value)}>
          <option value="">Selecciona una fotografía</option>{model.poses.map(p => <option key={p.id} value={p.id}>{p.fileName}{p.active === false ? ' · Inactiva' : ''}</option>)}
        </select>
      </label>
      <Button size="sm" variant="ghost" disabled={sets.busy || !(existing || poseId)} onClick={() => void sets.verify(shot, existing || poseId!)}>Verificar para esta toma · ~$0.01</Button>
    </div>
  </article>;
}
export function ModelPhotoSets({ model, client, wizard = false, onBusyChange, initialProvider, initialImageConfig, library }: { library?: UseModelLibraryResult; model: Model; client?: Client; wizard?: boolean; onBusyChange?: (busy: boolean) => void; initialProvider?: ModelPhotoProvider; initialImageConfig?: ProviderImageConfig }) {
  const sets = useModelPhotoSets(model, client, { wizard, onBusyChange, initialProvider, initialImageConfig });
  const poseGrid = (poses: Model['poses'], rejectionReasons?: Record<string, string>) => library
    ? <ModelPosesEditGrid model={model} poses={poses} library={library} rejectionReasons={rejectionReasons} />
    : <ModelPosesViewGrid model={model} poses={poses} rejectionReasons={rejectionReasons} />;
  return <>
    {!wizard && <section className="my-6 space-y-6" aria-label="Poses del catálogo por marketplace">
      {sets.catalogGroups.marketplaces.map(group => <section key={group.channel}>
        <h3 className="text-lg font-semibold">{MARKETPLACES.find(m => m.id === group.channel)?.name}</h3>
        {group.poses.length ? poseGrid(group.poses) : <p className="mt-2 text-sm text-slate-500">Sin poses aprobadas para este canal.</p>}
      </section>)}
      <section><h3 className="text-lg font-semibold">Identidad y otras poses</h3>{poseGrid(sets.catalogGroups.other)}</section>
      <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <summary className="cursor-pointer font-semibold">Intentos rechazados ({sets.catalogGroups.rejected.length})</summary>
        <p className="mt-2 text-sm text-slate-600">Conservados para revisión. Puedes verificarlos de nuevo desde la toma correspondiente.</p>
        {poseGrid(sets.catalogGroups.rejected.map(r => r.pose), Object.fromEntries(sets.catalogGroups.rejected.map(r => [r.pose.id, r.reason])))}
      </details>
    </section>}
  <section className="my-6 space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Bases de fotografía · receta v1</p><h3 className="mt-1 text-xl font-semibold text-slate-950">Una identidad, sets por marketplace</h3><p className="mt-2 text-sm text-slate-600">Selecciona las poses concretas y sus destinos. Hasta tres intentos por combinación compatible, con verificación automática; las aprobadas se conservan. La zona corporal y el encuadre dependen de cada pose. Cada incorporación requiere verificación para su destino.</p></div>
    {!wizard && <fieldset disabled={sets.busy} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
      <label className="text-sm">Identidad elegida<select className="tuto-field mt-1 w-full" value={sets.identityPoseId} onChange={e => sets.setIdentityPoseId(e.target.value)}>{model.poses.filter(p => p.active !== false).map(p => <option key={p.id} value={p.id}>{p.fileName}</option>)}</select></label>
      <label className="text-sm">Procedencia<select className="tuto-field mt-1 w-full" value={sets.performer} onChange={e => sets.setPerformer(e.target.value as typeof sets.performer)}><option value="synthetic">Persona sintética</option><option value="real">Persona real</option></select></label>
      <div className="flex items-end"><Button size="sm" onClick={() => void sets.approveIdentity()} disabled={!sets.identityPoseId}>{model.approvedIdentity?.poseId === sets.identityPoseId ? 'Confirmar identidad' : 'Aprobar identidad'}</Button></div>
    </fieldset>}
    <fieldset disabled={sets.busy || sets.rulesLoading} className="space-y-3">
      <legend className="mb-2 font-semibold">Poses a generar · {sets.poseRecipeIds?.length ?? 'receta general'} seleccionadas</legend>
      <p className="text-xs text-slate-500">Preseleccionadas según las reglas de los marketplaces elegidos. Puedes ajustar la selección para esta generación.</p>
      {sets.rulesLoading ? <p role="status" className="text-sm">Cargando poses de las reglas…</p> : <PoseSelectionChips groups={MODEL_POSE_GROUPS} selectedIds={sets.poseRecipeIds ?? []}
        disabled={sets.busy} onToggle={id => sets.setPoseRecipeIds(current => current?.includes(id) ? current.filter(poseId => poseId !== id) : [...(current ?? []), id])} />}
      {sets.rulesError && <Alert tone="warning">No se pudieron cargar las reglas: {sets.rulesError}</Alert>}
    </fieldset>
    <fieldset disabled={sets.busy} className="flex flex-wrap gap-4">{sets.active.map(channel => <label className="flex items-center gap-2 text-sm" key={channel}><input type="checkbox" checked={sets.channels.includes(channel)} onChange={e => sets.setChannels(current => e.target.checked ? [...current, channel] : current.filter(c => c !== channel))} />{MARKETPLACES.find(m => m.id === channel)?.name}</label>)}</fieldset>
    <fieldset disabled={sets.busy} className="grid gap-3 sm:grid-cols-4">
      <label className="text-sm">Categoría<select className="tuto-field mt-1 w-full" value={sets.category} onChange={e => sets.setCategory(e.target.value as typeof sets.category)}>{PHOTO_RECIPE_CATEGORIES.map(c => <option key={c} value={c}>{PHOTO_LABELS[c]}</option>)}</select></label>
      {sets.poseRecipeIds === undefined && <label className="text-sm">Zona corporal<select className="tuto-field mt-1 w-full" value={sets.bodyArea} onChange={e => sets.setBodyArea(e.target.value as typeof sets.bodyArea)}>{['upper_body', 'lower_body', 'full_body', 'footwear', 'head_accessory', 'carry_accessory'].map(c => <option key={c} value={c}>{PHOTO_LABELS[c]}</option>)}</select></label>}
      <label className="text-sm">Formato general<select className="tuto-field mt-1 w-full" value={sets.aspectRatio || ''} onChange={e => sets.setAspectRatio(e.target.value ? e.target.value as typeof sets.aspectRatio : undefined)}><option value="">Reglas Marketplace / preset del cliente</option>{['3:4', '1:1', '4:3', '2:3', '9:16'].map(r => <option key={r}>{r}</option>)}</select></label>
      <label className="text-sm">Proveedor<select className="tuto-field mt-1 w-full" value={sets.provider || ''} onChange={e => sets.setProvider(e.target.value ? e.target.value as typeof sets.provider : undefined)}><option value="">Preset del cliente / GPT Image 2.5 Flare</option>{PROVIDER_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
    </fieldset>
    <p className="text-xs text-slate-500">El formato y la composición se aplican según Reglas Marketplace. El formato general se usa cuando la regla hereda el preset del cliente. Las imágenes se componen de origen, sin cortar la prenda. Packs y excepciones infantiles se planifican sin modelo al generar prendas.</p>
    {sets.preview?.incompatible?.length ? <Alert tone="warning"><p className="font-semibold">Combinaciones incompatibles · no se cobrarán</p>{sets.preview.incompatible.map(item => <p key={`${item.channel}-${item.poseRecipeId}`}>{MARKETPLACES.find(m => m.id === item.channel)?.name} · {MODEL_POSE_RECIPES_BY_ID.get(item.poseRecipeId)?.label}: {item.reason}</p>)}</Alert> : null}
    {sets.preview && <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 py-4"><p className="text-sm"><strong>{sets.poseRecipeIds ? `${sets.poseRecipeIds.length} poses × ${sets.channels.length} destinos · ${sets.preview.shots.length} fotografías compatibles · ` : ''}{sets.preview.shots.length - sets.preview.missing} / {sets.preview.shots.length} tomas aprobadas</strong> · {sets.preview.missing} faltantes · USD {sets.preview.estimatedCostUsd.toFixed(3)} iniciales · máximo previsto USD {(sets.preview.maxCostUsd ?? sets.preview.estimatedCostUsd * 3).toFixed(3)} (hasta 3 intentos)</p><Button size="sm" disabled={sets.busy || !sets.preview.shots.some(sets.canGenerate) || Boolean(sets.preview.issues.length)} onClick={() => void sets.generate(sets.preview!.shots.filter(s => !s.poseId))}>Completar seleccionados</Button></div>}
    {(sets.preview?.issues.length || sets.issues.length) ? <Alert tone="warning">{[...(sets.preview?.issues || []), ...sets.issues].map((issue, i) => <p key={i}>{issue}</p>)}</Alert> : null}
    {sets.busy && <p role="status" className="text-sm font-medium text-indigo-700">{sets.progress || 'Preparando operación…'}</p>}
    {sets.channels.map(channel => { const shots = sets.preview?.shots.filter(s => s.spec.channel === channel) || []; return <div key={channel} className="space-y-3"><h4 className="font-semibold">{MARKETPLACES.find(m => m.id === channel)?.name} <span className="ml-2 text-xs font-normal text-slate-500">{shots.length && shots.every(s => s.poseId) ? 'Completo' : shots.some(s => s.poseId) ? 'Incompleto' : 'Pendiente'}</span></h4><div className="grid gap-4 md:grid-cols-3">{shots.map(shot => <BaseShot key={JSON.stringify(shot.spec)} model={model} shot={shot} sets={sets} />)}</div></div>; })}
  </section>

  </>;
}
