import { PoseSelectionChips } from '../../../components/models/PoseSelectionChips';
import type { ModelMarketplaceAppearance, ModelMarketplaceRule } from '../../../../shared/src/types';
import { MODEL_RULE_POSES, MODEL_RULE_SHOTS } from '../../../../shared/src/modelMarketplaceRules';
import { MODEL_SET_SHOT_LABELS } from '../../../../shared/src/modelPhotoSets';

const framingLabels = { auto: 'Según la zona de la pose', full_body: 'Cuerpo completo', upper_body: 'Parte superior', lower_body: 'Parte inferior · sin rostro' };
function Appearance({ title, value, onChange }: { title: string; value: ModelMarketplaceAppearance; onChange: (value: ModelMarketplaceAppearance) => void }) {
  const prefix = title;
  return <fieldset className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
    <legend className="px-2 text-base font-semibold">{title}</legend>
    <label className="block min-w-0 text-sm">Fondo · {prefix}<select className="tuto-field mt-2 w-full min-w-0 max-w-full" value={value.background} onChange={e => onChange({ ...value, background: e.target.value as typeof value.background })}>
      <option value="client">Regla actual / configuración del cliente</option><option value="white">Blanco puro · #FFFFFF</option><option value="neutral">Neutro claro de estudio</option>
    </select></label>
    <label className="block min-w-0 text-sm">Encuadre · {prefix}<select className="tuto-field mt-2 w-full min-w-0 max-w-full" value={value.framing} onChange={e => {
      const framing = e.target.value as typeof value.framing;
      onChange({ ...value, framing, face: framing === 'lower_body' || value.face === 'hidden' ? 'auto' : value.face });
    }}>{Object.entries(framingLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="block min-w-0 text-sm">Rostro · {prefix}<select className="tuto-field mt-2 w-full min-w-0 max-w-full" value={value.face} onChange={e => {
      const face = e.target.value as typeof value.face;
      onChange({ ...value, face, framing: face === 'hidden' ? 'lower_body' : face === 'visible' && value.framing === 'lower_body' ? 'upper_body' : value.framing });
    }}><option value="auto">Según el encuadre</option><option value="visible">Visible</option><option value="hidden">Fuera del encuadre · parte inferior</option></select></label>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={value.lookingAtCamera} onChange={e => onChange({ ...value, lookingAtCamera: e.target.checked })} /><span>Exigir mirada hacia cámara cuando se vea el rostro · {prefix}</span></label>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={value.standingFront} onChange={e => onChange({ ...value, standingFront: e.target.checked })} /><span>Exigir frontal de pie, ojos abiertos, boca cerrada y brazos a los lados · {prefix}</span></label>
    {value.standingFront && title === 'Poses adicionales' && <p className="text-xs text-amber-800">Esta exigencia puede impedir aprobar poses de espalda o tres cuartos.</p>}
  </fieldset>;
}
export function ModelMarketplaceRuleForm({ value, onChange }: { value: ModelMarketplaceRule; onChange: (value: ModelMarketplaceRule) => void }) {
  return <div className="min-w-0 space-y-6">
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Formato de las bases</h2>
      <div className="mt-4 grid items-center gap-5 sm:grid-cols-[1fr_auto]">
        <label className="block min-w-0 text-sm">Relación de aspecto<select className="tuto-field mt-2 w-full min-w-0 max-w-full" value={value.aspectRatio} onChange={e => onChange({ ...value, aspectRatio: e.target.value as typeof value.aspectRatio })}>
          <option value="client">Formato general / preset del cliente · 3:4 por defecto</option><option value="3:4">3:4 · Vertical</option><option value="4:3">4:3 · Horizontal</option><option value="1:1">1:1 · Cuadrada</option>
        </select><span className="mt-2 block text-xs text-slate-500">Se genera en esta proporción desde el origen, sin recortar la prenda.</span></label>
        <div aria-hidden="true" className="flex h-24 w-32 items-center justify-center rounded-lg bg-slate-50"><div style={{ aspectRatio: value.aspectRatio === 'client' ? '3 / 4' : value.aspectRatio.replace(':', ' / '), maxWidth: 96, maxHeight: 80, height: value.aspectRatio === '4:3' ? 65 : 80 }} className="flex items-center justify-center rounded border-2 border-indigo-400 bg-indigo-50 text-xs font-semibold text-indigo-700">{value.aspectRatio === 'client' ? 'Auto' : value.aspectRatio}</div></div>
      </div>
    </section>
    <div className="grid gap-5 lg:grid-cols-2"><Appearance title="Portada" value={value.main} onChange={main => onChange({ ...value, main })} /><Appearance title="Poses adicionales" value={value.alternative} onChange={alternative => onChange({ ...value, alternative })} /></div>
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div><h2 className="font-semibold">Poses habilitadas</h2><p className="mt-1 text-sm text-slate-500">La frontal es la base de portada. El catálogo permite elegir variaciones dentro de las vistas habilitadas.</p></div>
      <div className="flex flex-wrap gap-4">{MODEL_RULE_SHOTS.map(shot => <label key={shot} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={shot === 'front'} checked={value.shots.includes(shot)} onChange={e => onChange({ ...value, shots: e.target.checked ? MODEL_RULE_SHOTS.filter(s => s === shot || value.shots.includes(s)) : value.shots.filter(s => s !== shot) })} />{MODEL_SET_SHOT_LABELS[shot]}{shot === 'front' ? ' · obligatoria' : ''}</label>)}</div>
      <details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium">Variaciones del catálogo · {value.allowedPoseRecipeIds.length} habilitadas</summary>
        <div className="mt-4"><PoseSelectionChips
          groups={[...new Set(MODEL_RULE_POSES.map(pose => pose.group))].map(group => ({ group, options: MODEL_RULE_POSES.filter(pose => pose.group === group) }))}
          selectedIds={value.allowedPoseRecipeIds}
          onToggle={id => onChange({ ...value, allowedPoseRecipeIds: value.allowedPoseRecipeIds.includes(id)
            ? value.allowedPoseRecipeIds.filter(poseId => poseId !== id)
            : MODEL_RULE_POSES.filter(pose => pose.id === id || value.allowedPoseRecipeIds.includes(pose.id)).map(pose => pose.id) })}
        /></div>
        <p className="mt-3 text-xs text-slate-500">Sin selección inicial. Las variaciones que guardes aquí se preseleccionarán al generar modelos para este marketplace.</p>
      </details>
    </section>
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Criterios de aprobación</h2>
      {([['garmentVisible', 'Exigir que toda la zona de la prenda esté visible, sin ocultaciones'], ['noAccessories', 'Rechazar accesorios ajenos a la base'], ['pureWhite', 'Comprobar técnicamente el blanco puro cuando se solicite fondo blanco']] as const).map(([key, label]) => <label className="flex items-start gap-2 text-sm" key={key}><input className="mt-1" type="checkbox" checked={value.validation[key]} onChange={e => onChange({ ...value, validation: { ...value.validation, [key]: e.target.checked } })} />{label}</label>)}
      <p className="border-t border-slate-100 pt-4 text-xs text-slate-500">Siempre se comprueban identidad aprobada, edad, proporción, pose, encuadre y rostro. Se mantienen las exclusiones por categoría y edad. Las bases usan vestuario neutro y opaco, adecuado para sustituir prendas.</p>
    </section>
  </div>;
}
