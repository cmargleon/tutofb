import React from 'react';
import type { ClientAutomationSection as AutomationSection } from '../../../shared/src/clientAutomationSections';
import type { Client, Provider } from '../../../shared/src/types';
import { DEFAULT_IMAGE_PROVIDER, PROVIDER_VALUES, PROVIDER_LABELS } from '../../../shared/src/domain';
import { createCommercialProviderImageConfig } from '../../../shared/src/commercialPhoto';
import { createDefaultProductScenes, PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import { useClientAutomationConfig } from '../../features/automation/useClientAutomationConfig';
import { Button, INPUT_CLASS, LoadingBlock } from '../ui';
import { ProviderImageConfigSelection } from '../wizard/ProviderImageConfigSelection';

const inputClass = INPUT_CLASS;
type AutomationState = ReturnType<typeof useClientAutomationConfig>;

export const ClientDriveFolders = ({ state }: { state: AutomationState }) => <label className="tuto-form-field"><span className="tuto-label">Carpetas autorizadas de Google Drive</span><textarea rows={4} className={inputClass} value={state.folders} onChange={(e) => state.setFolders(e.target.value)} /><span className="tuto-hint">Hasta 20 enlaces o IDs, uno por línea. Es la misma lista de automatización y del Organizador inteligente. Se verifica el acceso al guardar; retira los orígenes del Organizador antes de quitar una carpeta.</span></label>;

export const ClientAutomationSection = ({ client }: { client: Client }) => {
  const state = useClientAutomationConfig(client);
  return <details className="mt-5 rounded-xl border border-slate-200 p-4"><summary>Google Drive y automatización · {client.automation?.driveFolderIds?.length ?? 0} carpetas</summary><ClientDriveFolders state={state} /><ClientAutomationSave state={state} section="sources" disabled={client.status === 'archived'} /><ClientAutomationFields client={client} state={state} /><ClientAutomationSave state={state} section="automation" disabled={client.status === 'archived'} /></details>;
};

export const ClientAutomationSave = ({ state, disabled, section }: { state: AutomationState; disabled: boolean; section: AutomationSection }) => <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4"><Button disabled={disabled || state.saving} loading={state.savingSection === section} onClick={() => void state.save(section)}>{section === 'sources' ? 'Guardar fuentes de datos' : 'Guardar automatizaciones'}</Button>{state.isDirty(section) && <><span className="text-sm text-[var(--color-warning)]" role="status">Cambios sin guardar en {section === 'sources' ? 'Fuentes de datos' : 'Automatizaciones'} · borrador conservado en esta sesión</span><Button disabled={state.saving} variant="ghost" onClick={() => state.discardSection(section)}>Descartar cambios de esta pestaña</Button></>}</div>;

const sourceLabels = { cliente: 'Cliente', sistema: 'Sistema', predeterminado: 'Predeterminado' } as const;
const Source = ({ source }: { source: keyof typeof sourceLabels }) => <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{sourceLabels[source]}</span>;

const AutomationFlowSummary = ({ state }: { state: AutomationState }) => {
  const effective = state.effectiveConfig;
  const modelName = (id: string | null) => id ? state.models.find(model => model.id === id)?.name || 'Modelo no disponible' : 'Sin modelo disponible';
  if (state.systemLoading) return <LoadingBlock message="Cargando resumen del flujo…" />;
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-[var(--color-bg-elevated)] p-4" aria-label="Resumen del flujo">
    <h3 className="text-sm font-semibold">Resumen del flujo</h3>
    <p className="text-xs text-slate-500">Vista previa con los ajustes que estás editando. Drive → Organizador → preset → modelo → intentos → presupuesto.</p>
    <ol className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <li><span className="block text-xs text-slate-500">Drive</span>{state.value.driveFolderIds?.filter(id => id.trim()).length || 0} carpetas autorizadas<Source source={state.value.driveFolderIds === undefined ? 'predeterminado' : 'cliente'} /></li>
      <li><span className="block text-xs text-slate-500">Después del Organizador</span>{effective.organizerGenerationEnabled.value ? 'Generación activada' : 'Generación desactivada'}<Source source={effective.organizerGenerationEnabled.source} /></li>
      <li><span className="block text-xs text-slate-500">Preset por defecto</span>{effective.defaultPreset.value}<Source source={effective.defaultPreset.source} /><span className="mt-1 block text-xs text-slate-500">Desde el Organizador: {effective.organizerGenerationPreset.value}<Source source={effective.organizerGenerationPreset.source} /></span></li>
      <li className="space-y-1"><span className="block text-xs text-slate-500">Modelo según género</span><span className="block">Masculino: {modelName(effective.maleModelId.value)}<Source source={effective.maleModelId.source} /></span><span className="block">Femenino: {modelName(effective.femaleModelId.value)}<Source source={effective.femaleModelId.source} /></span><span className="block text-xs text-slate-500">Confianza de género: {effective.garmentGenderMinConfidence.value}<Source source={effective.garmentGenderMinConfidence.source} /></span><span className="block text-xs text-slate-500">Clasificación: {effective.classificationMinConfidence.value}<Source source={effective.classificationMinConfidence.source} /></span></li>
      <li className="space-y-1"><span className="block text-xs text-slate-500">Intentos</span><span className="block">Calidad: {effective.maxReviewAttempts.value}<Source source={effective.maxReviewAttempts.source} /></span><span className="block">Reintentos operativos: {effective.maxOperationalRetries.value}<Source source={effective.maxOperationalRetries.source} /></span></li>
      <li><span className="block text-xs text-slate-500">Presupuesto por pedido</span>USD {effective.budgetUsd.value}<Source source={effective.budgetUsd.source} /></li>
    </ol>
    {effective.issues.map(issue => <p key={issue} role="status" className="text-sm text-amber-800">{issue}</p>)}
  </section>;
};

export const ClientAutomationFields = ({ client, state }: { client: Client; state: AutomationState }) => {
  const { value, setValue, preset, updatePreset } = state;
  const selectedModel = state.models.find((m) => m.id === (preset.modelId || value.defaultModelId));
  return <div>
    <div className="mt-5 space-y-4">
      <AutomationFlowSummary state={state} />
      <fieldset disabled={state.saving || client.status === 'archived'} className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]"><input type="checkbox" checked={value.enabled === true} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />Permitir pedidos automáticos para este cliente</label>

        <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-[var(--color-bg-elevated)] p-4">
          <legend className="px-1 text-sm font-semibold">Reglas de decisión</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['garmentGenderMinConfidence', 'Confianza mínima de género', 'Con varios modelos disponibles, exige esta confianza para elegir el modelo según el género de la prenda.'],
              ['classificationMinConfidence', 'Confianza mínima de clasificación', 'Exige esta confianza para aceptar el tipo de artículo y sus vistas antes de generar.'],
            ] as const).map(([key, label, help]) => <div key={key} className="space-y-2">
              <label className="block space-y-2 text-sm">{label}<input className={inputClass} type="number" min="0.5" max="0.95" step="0.01" value={value.rules?.[key] ?? ''} placeholder={`Heredar Sistema (${state.inheritedRules[key]})`} onChange={event => state.setRule(key, event.target.value)} /></label>
              <Button type="button" size="sm" variant="ghost" disabled={value.rules?.[key] === undefined} onClick={() => state.setRule(key, '')}>Volver a heredar<span className="sr-only"> {label.toLowerCase()}</span></Button>
              <p className="text-xs text-slate-500">{help}</p>
            </div>)}
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-[var(--color-bg-elevated)] p-4">
          <legend className="px-1 text-sm font-semibold">Desde el Organizador</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.organizerGeneration?.enabled !== false} onChange={event => {
            const organizerGeneration = { ...value.organizerGeneration };
            if (event.target.checked) delete organizerGeneration.enabled; else organizerGeneration.enabled = false;
            const next = { ...value }; if (Object.keys(organizerGeneration).length) next.organizerGeneration = organizerGeneration; else delete next.organizerGeneration; setValue(next);
          }} />Generar fotos automáticamente al organizar</label>
          <label className="block space-y-2 text-sm">Preset desde el Organizador<select className={inputClass} value={value.organizerGeneration?.preset || ''} onChange={event => {
            const organizerGeneration = { ...value.organizerGeneration };
            if (event.target.value) organizerGeneration.preset = event.target.value; else delete organizerGeneration.preset;
            const next = { ...value }; if (Object.keys(organizerGeneration).length) next.organizerGeneration = organizerGeneration; else delete next.organizerGeneration; setValue(next);
          }}><option value="">Preset por defecto del cliente</option><option value="standard">Standard (prendas)</option><option value="generic_product">Producto genérico</option>{Object.keys(value.presets || {}).filter(name => !['standard', 'generic_product'].includes(name)).map(name => <option key={name} value={name}>{name}</option>)}{value.organizerGeneration?.preset && !['standard', 'generic_product'].includes(value.organizerGeneration.preset) && !value.presets?.[value.organizerGeneration.preset] && <option value={value.organizerGeneration.preset}>Preset no disponible · elige otro</option>}</select></label>
          {state.systemConfig.organizerAutoGenerationEnabled === false && <p role="status" className="text-sm text-amber-800">El interruptor general de Sistema está apagado. Este cliente no enviará fotos a generar después de organizar hasta que se active.</p>}
          <p className="text-xs text-slate-500">También deben estar habilitados los pedidos automáticos de este cliente y el interruptor general de Sistema.</p>
        </fieldset>
        <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-[var(--color-bg-elevated)] p-4">
          <legend className="px-1 text-sm font-semibold">Modelos predeterminados por género</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['defaultMaleModelId', 'Modelo masculino predeterminado', state.maleModels],
              ['defaultFemaleModelId', 'Modelo femenino predeterminado', state.femaleModels],
            ] as const).map(([key, label, models]) => <label key={key} className="space-y-2 text-sm">{label}
              <select className={inputClass} value={state.genderDefaults[key] || ''} onChange={(event) => {
                const next = { ...value }; if (event.target.value) next[key] = event.target.value; else delete next[key]; setValue(next);
              }}>
                <option value="">Automático si hay un único modelo de este género</option>
                {value[key] && !models.some(model => model.id === value[key]) && <option value={value[key]}>Modelo no disponible · elige otro</option>}
                {models.map(model => <option key={model.id} value={model.id}>{model.name}{!model.identityTraits?.sex ? ' · género sin registrar' : ''}</option>)}
              </select>
            </label>)}
          </div>
          <p className="text-xs text-slate-500">Gemini analiza cada prenda antes de elegir el modelo. Si solo hay un predeterminado disponible, se usa para todas las prendas. Para unisex se elige cualquiera de los dos y se conserva en los reintentos.</p>
          <p className="text-xs text-slate-500">Un único modelo activo de cada género se selecciona automáticamente. Una selección explícita de modelo en el pedido o preset tiene prioridad.</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">Modelo general de respaldo<select className={inputClass} value={value.defaultModelId || ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.defaultModelId = e.target.value; else delete next.defaultModelId; setValue(next); }}><option value="">Sin respaldo</option>{state.models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select><span className="block text-xs text-slate-500">Se usa si no hay modelos predeterminados por género.</span></label>
          <label className="space-y-2 text-sm">Presupuesto por pedido (USD)<input className={inputClass} type="number" min="0.01" step="0.01" placeholder="Heredar Sistema" value={value.defaultBudgetUsd ?? ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.defaultBudgetUsd = Number(e.target.value); else delete next.defaultBudgetUsd; setValue(next); }} /></label>
          <label className="space-y-2 text-sm">Máximo de intentos de calidad<input className={inputClass} type="number" min="1" max="10" placeholder="Heredar Sistema" value={value.maxReviewAttempts ?? ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.maxReviewAttempts = Number(e.target.value); else delete next.maxReviewAttempts; setValue(next); }} /></label>
        </div>
        <label className="block space-y-2 text-sm">Máximo de reintentos operativos<input className={inputClass} type="number" min="0" max="10" placeholder="Heredar Sistema" value={value.maxOperationalRetries ?? ''} onChange={(e) => { const next = { ...value }; if (e.target.value) next.maxOperationalRetries = Number(e.target.value); else delete next.maxOperationalRetries; setValue(next); }} /></label>
        <label className="block space-y-2 text-sm">Preset predeterminado<select className={inputClass} value={value.defaultPreset || ''} onChange={(e) => setValue({ ...value, defaultPreset: e.target.value })}><option value="">Según tipo de fotografía</option><option value="standard">Standard (prendas)</option><option value="generic_product">Producto genérico</option>{Object.keys(value.presets || {}).filter((n) => !['standard','generic_product'].includes(n)).map((n) => <option key={n}>{n}</option>)}</select></label>
        <fieldset className="rounded-xl border border-slate-200 bg-[var(--color-bg-elevated)] p-4"><legend className="px-1 text-sm font-semibold text-[var(--color-text-primary)]">Presets, poses y prompts de automatización</legend>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">Editar o crear preset<input className={inputClass} list={`presets-${client.id}`} placeholder="Ej.: catalogo-vertical" value={state.presetName} onChange={(e) => state.setPresetName(e.target.value)} /><datalist id={`presets-${client.id}`}>{Object.keys(value.presets || {}).map((n) => <option key={n}>{n}</option>)}</datalist></label>
            {state.presetName && <>
              <label className="block space-y-2 text-sm">Modelo explícito del preset<select className={inputClass} value={preset.modelId || ''} onChange={e => { const next = { ...preset }; if (e.target.value) next.modelId = e.target.value; else delete next.modelId; delete next.poseIds; setValue({ ...value, presets: { ...value.presets, [state.presetName]: next } }); }}><option value="">Usar predeterminados</option>{preset.modelId && !state.models.some(m => m.id === preset.modelId) && <option value={preset.modelId}>Modelo no disponible · elige otro</option>}{state.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label className="block space-y-2 text-sm">Proveedor<select className={inputClass} value={preset.provider || DEFAULT_IMAGE_PROVIDER} onChange={(e) => { const provider = e.target.value as Provider; updatePreset({ provider, imageConfig: createCommercialProviderImageConfig(provider) }); }}>{PROVIDER_VALUES.map((provider) => <option value={provider} key={provider}>{PROVIDER_LABELS[provider]}</option>)}</select></label>
              <ProviderImageConfigSelection commercial provider={preset.provider || DEFAULT_IMAGE_PROVIDER} value={preset.imageConfig || createCommercialProviderImageConfig(preset.provider || DEFAULT_IMAGE_PROVIDER)} onChange={(imageConfig) => updatePreset({ provider: imageConfig.provider, imageConfig })} />
              <label className="block space-y-2 text-sm">Prompt propio<textarea className={inputClass} rows={5} value={preset.prompt || ''} onChange={(e) => updatePreset({ prompt: e.target.value })} placeholder="Heredar prompt habitual" /></label>
              {selectedModel && <fieldset><legend className="mb-2 text-sm">Poses del modelo (sin selección: todas las compatibles)</legend><div className="flex flex-wrap gap-3">{selectedModel.poses.map((pose) => <label className="flex gap-2 text-sm" key={pose.id}><input type="checkbox" checked={preset.poseIds?.includes(pose.id) || false} onChange={(e) => { const ids = e.target.checked ? [...(preset.poseIds || []), pose.id] : (preset.poseIds || []).filter((id) => id !== pose.id); const next = { ...preset }; if (ids.length) next.poseIds = ids; else delete next.poseIds; setValue({ ...value, presets: { ...value.presets, [state.presetName]: next } }); }} />{pose.fileName}</label>)}</div></fieldset>}
              <details><summary className="cursor-pointer text-sm">Escenas para objetos</summary><div className="mt-3 space-y-3">{(preset.scenes || createDefaultProductScenes()).map((scene) => <label key={scene.type} className="block text-sm">{PRODUCT_SCENES.find((s) => s.type === scene.type)?.label}<textarea className={inputClass} rows={2} value={scene.prompt} onChange={(e) => updatePreset({ scenes: (preset.scenes || createDefaultProductScenes()).map((s) => s.type === scene.type ? { ...s, prompt: e.target.value } : s) })} /></label>)}</div></details>
              <Button variant="secondary" size="sm" type="button" onClick={() => setValue({ ...value, defaultPreset: state.presetName, presets: { ...value.presets, [state.presetName]: preset } })}>Usar este preset por defecto</Button>
            </>}
          </div>
        </fieldset>
      </fieldset>
      <p className="text-xs text-slate-500">Los límites de Sistema prevalecen. Cada escena se genera y revisa de forma independiente.</p>
    </div>
  </div>;
};
