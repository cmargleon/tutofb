import React from 'react';
import type { Client, Provider } from '../../../shared/src/types';
import { DEFAULT_IMAGE_PROVIDER, PROVIDER_VALUES, PROVIDER_LABELS } from '../../../shared/src/domain';
import { createDefaultProviderImageConfig } from '../../../shared/src/providerImageConfig';
import { createDefaultProductScenes, PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import { useClientAutomationConfig } from '../../features/automation/useClientAutomationConfig';
import { Button } from '../ui';
import { ProviderImageConfigSelection } from '../wizard/ProviderImageConfigSelection';

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-sm';
export const ClientAutomationSection = ({ client }: { client: Client }) => {
  const state = useClientAutomationConfig(client);
  const { value, setValue, preset, updatePreset } = state;
  const selectedModel = state.models.find((m) => m.id === (preset.modelId || value.defaultModelId));
  return <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <summary className="cursor-pointer text-sm font-semibold text-slate-800">Automatización · {value.enabled ? 'Activada' : 'Desactivada'}</summary>
    <div className="mt-5 space-y-4">
      <fieldset disabled={state.saving} className="space-y-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.enabled === true} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />Permitir pedidos automáticos para este cliente</label>
        <label className="block space-y-2 text-sm">Carpetas autorizadas de Google Drive (enlace o ID, una por línea)<textarea rows={3} className={inputClass} value={state.folders} onChange={(e) => state.setFolders(e.target.value)} /><span className="block text-xs text-slate-500">Al guardar se verifica el acceso de la identidad de integración. Cada foto del pedido debe indicar su artículo.</span></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">Modelo humano predeterminado<select className={inputClass} value={value.defaultModelId || ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.defaultModelId = e.target.value; else delete next.defaultModelId; setValue(next); }}><option value="">Seleccionar cuando se solicite</option>{state.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
          <label className="space-y-2 text-sm">Presupuesto por pedido (USD)<input className={inputClass} type="number" min="0.01" step="0.01" placeholder="Heredar Sistema" value={value.defaultBudgetUsd ?? ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.defaultBudgetUsd = Number(e.target.value); else delete next.defaultBudgetUsd; setValue(next); }} /></label>
          <label className="space-y-2 text-sm">Máximo de intentos de calidad<input className={inputClass} type="number" min="1" max="10" placeholder="Heredar Sistema" value={value.maxReviewAttempts ?? ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.maxReviewAttempts = Number(e.target.value); else delete next.maxReviewAttempts; setValue(next); }} /></label>
        </div>
        <label className="block space-y-2 text-sm">Preset predeterminado<select className={inputClass} value={value.defaultPreset || ''} onChange={(e) => setValue({ ...value, defaultPreset: e.target.value })}><option value="">Según tipo de fotografía</option><option value="standard">Standard (prendas)</option><option value="generic_product">Producto genérico</option>{Object.keys(value.presets || {}).filter((n) => !['standard','generic_product'].includes(n)).map((n) => <option key={n}>{n}</option>)}</select></label>
        <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium">Presets, poses y prompts de automatización</summary>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">Editar o crear preset<input className={inputClass} list={`presets-${client.id}`} placeholder="Ej.: catalogo-vertical" value={state.presetName} onChange={(e) => state.setPresetName(e.target.value)} /><datalist id={`presets-${client.id}`}>{Object.keys(value.presets || {}).map((n) => <option key={n}>{n}</option>)}</datalist></label>
            {state.presetName && <>
              <label className="block space-y-2 text-sm">Proveedor<select className={inputClass} value={preset.provider || DEFAULT_IMAGE_PROVIDER} onChange={(e) => { const provider = e.target.value as Provider; updatePreset({ provider, imageConfig: createDefaultProviderImageConfig(provider) }); }}>{PROVIDER_VALUES.map((provider) => <option value={provider} key={provider}>{PROVIDER_LABELS[provider]}</option>)}</select></label>
              <ProviderImageConfigSelection provider={preset.provider || DEFAULT_IMAGE_PROVIDER} value={preset.imageConfig || createDefaultProviderImageConfig(preset.provider || DEFAULT_IMAGE_PROVIDER)} onChange={(imageConfig) => updatePreset({ provider: imageConfig.provider, imageConfig })} />
              <label className="block space-y-2 text-sm">Prompt propio<textarea className={inputClass} rows={5} value={preset.prompt || ''} onChange={(e) => updatePreset({ prompt: e.target.value })} placeholder="Heredar prompt habitual" /></label>
              {selectedModel && <fieldset><legend className="mb-2 text-sm">Poses del modelo (sin selección: todas las compatibles)</legend><div className="flex flex-wrap gap-3">{selectedModel.poses.map((pose) => <label className="flex gap-2 text-sm" key={pose.id}><input type="checkbox" checked={preset.poseIds?.includes(pose.id) || false} onChange={(e) => { const ids = e.target.checked ? [...(preset.poseIds || []), pose.id] : (preset.poseIds || []).filter((id) => id !== pose.id); const next = { ...preset }; if (ids.length) next.poseIds = ids; else delete next.poseIds; setValue({ ...value, presets: { ...value.presets, [state.presetName]: next } }); }} />{pose.fileName}</label>)}</div></fieldset>}
              <details><summary className="cursor-pointer text-sm">Escenas para objetos</summary><div className="mt-3 space-y-3">{(preset.scenes || createDefaultProductScenes()).map((scene) => <label key={scene.type} className="block text-sm">{PRODUCT_SCENES.find((s) => s.type === scene.type)?.label}<textarea className={inputClass} rows={2} value={scene.prompt} onChange={(e) => updatePreset({ scenes: (preset.scenes || createDefaultProductScenes()).map((s) => s.type === scene.type ? { ...s, prompt: e.target.value } : s) })} /></label>)}</div></details>
              <Button variant="secondary" size="sm" type="button" onClick={() => setValue({ ...value, defaultPreset: state.presetName, presets: { ...value.presets, [state.presetName]: preset } })}>Usar este preset por defecto</Button>
            </>}
          </div>
        </details>
      </fieldset>
      <p className="text-xs text-slate-500">Los límites de Sistema prevalecen. Cada escena se genera y revisa de forma independiente.</p>
      <Button loading={state.saving} type="button" onClick={() => void state.save()}>Guardar automatización del cliente</Button>
    </div>
  </details>;
};
