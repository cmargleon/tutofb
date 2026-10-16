import React from 'react';
import { PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import type { ProductSceneInput, ProductSceneType } from '../../../shared/src/types';
import { Button } from '../ui';

export const ProductScenesStep: React.FC<{
  scenes: ProductSceneInput[];
  disabled: boolean;
  onToggle: (type: ProductSceneType) => void;
  onPromptChange: (type: ProductSceneType, prompt: string) => void;
}> = ({ scenes, disabled, onToggle, onPromptChange }) => <div className="space-y-5">
  <div><h2 className="text-lg font-semibold text-slate-900">Escenas del producto</h2>
    <p className="mt-1 text-sm text-slate-500">Por defecto, cada objeto tendrá 6 fotos: 4 lifestyle y 2 con personas usándolo sobre fondos relativamente neutros. Puedes seleccionar escenas y ajustar el ambiente, la luz y la composición.</p></div>
  <div className="grid gap-4 md:grid-cols-2">{PRODUCT_SCENES.map((preset, index) => {
    const selected = scenes.find((scene) => scene.type === preset.type);
    return <section key={preset.type} className={`rounded-3xl border bg-white p-5 ${selected ? 'border-emerald-500 shadow-sm' : 'border-slate-200'}`}>
      <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-900">
        <input type="checkbox" checked={Boolean(selected)} disabled={disabled} onChange={() => onToggle(preset.type)} className="accent-emerald-600" />
        <span className="text-xs text-emerald-700">0{index + 1}</span>{preset.label}
      </label>
      {selected && <details className="mt-4" open={selected.prompt !== preset.prompt || undefined}>
        <summary className="cursor-pointer text-sm text-emerald-700">Editar instrucciones de la escena</summary>
        <label className="mt-3 block text-sm text-slate-700">Prompt de {preset.label}
          <textarea value={selected.prompt} disabled={disabled} maxLength={4000} rows={5} onChange={(event) => onPromptChange(preset.type, event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900" />
        </label>
        {!selected.prompt.trim() && <p role="alert" className="mt-2 text-xs text-rose-700">Escribe instrucciones para esta escena o desmárcala.</p>}
        <Button variant="secondary" disabled={disabled} onClick={() => onPromptChange(preset.type, preset.prompt)}>Restaurar escena original</Button>
      </details>}
    </section>;
  })}</div>
  {!scenes.length && <p role="alert" className="text-sm text-amber-800">Selecciona al menos una escena para continuar.</p>}
</div>;
