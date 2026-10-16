import React from 'react';
import { buildProductPrompt, DEFAULT_PRODUCT_PROMPT, PRODUCT_SCENES } from '../../../shared/src/productGeneration';
import type { ProductSceneInput } from '../../../shared/src/types';
import { Button } from '../ui';

export const ProductPromptField: React.FC<{
  value: string; scenes: ProductSceneInput[]; disabled: boolean; onChange: (prompt: string) => void;
}> = ({ value, scenes, disabled, onChange }) => <section className="space-y-3">
  <label className="block text-sm font-medium text-slate-700">Instrucciones generales de fotografía de producto
    <textarea value={value} rows={5} maxLength={8000} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      placeholder="Por ejemplo: estética minimalista, tonos cálidos e iluminación suave."
      className="mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900" />
  </label>
  <p className="text-xs text-slate-500">Se aplican a todas las escenas. Las reglas de fidelidad al objeto se añaden siempre para conservar forma, colores, logos y piezas.</p>
  <Button variant="secondary" disabled={disabled} onClick={() => onChange(DEFAULT_PRODUCT_PROMPT)}>Restaurar instrucciones originales</Button>
  <details className="rounded-2xl border border-slate-200 p-4">
    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Ver prompt completo por escena</summary>
    {scenes.map((scene) => <div key={scene.type} className="mt-4">
      <h3 className="text-sm font-semibold text-slate-900">{PRODUCT_SCENES.find((preset) => preset.type === scene.type)?.label}</h3>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{buildProductPrompt(value, scene.prompt)}</pre>
    </div>)}
  </details>
</section>;
