import React, { useId, useState } from 'react';
import { composeApprovedTryOnPrompt, MAX_APPROVED_TRY_ON_PROMPT_LENGTH } from '../../../shared/src/approvedTryOnPrompt';
import { resolveTryOnPromptCaseKey } from '../../../shared/src/domain';
import type { TryOnPromptCaseKey } from '../../../shared/src/types';
import type { WizardState } from '../../features/generate/types';
import { PromptBaseField } from './PromptBaseField';

const CASE_LABELS: Record<TryOnPromptCaseKey, string> = {
  full_outfit: 'Caso A · Conjunto completo', top_only: 'Caso B · Prenda superior',
  bottom_only: 'Caso C · Prenda inferior', carry_accessory: 'Caso de accesorio transportable',
};

export const TryOnPromptFields: React.FC<{
  state: WizardState;
  sourceLabel: string;
  onPromptChange: (value: string) => void;
  onBlocksChange: (blocks: WizardState['tryOnPromptBlocks']) => void;
}> = ({ state, sourceLabel, onPromptChange, onBlocksChange }) => {
  const [previewId, setPreviewId] = useState('');
  const fieldPrefix = useId();
  const blocks = state.tryOnPromptBlocks;
  const caseKeys = [...new Set(state.garments.map((garment) => resolveTryOnPromptCaseKey(garment.garmentBodyArea)))]
    .filter((key): key is TryOnPromptCaseKey => key !== null);
  const garment = state.garments.find((entry) => entry.id === previewId) || state.garments[0];
  const preview = garment ? composeApprovedTryOnPrompt(state.prompt, blocks, garment.garmentBodyArea) : '';
  const field = (label: string, value: string, change: (text: string) => void) => {
    const id = `${fieldPrefix}-${label.replace(/[^a-zA-Z0-9]/g, '-')}`;
    return <div className="space-y-2 text-sm font-medium text-slate-700" key={label}>
      <label htmlFor={id} className="block">{label}</label>
      <textarea id={id} value={value} onChange={(event) => change(event.target.value)} rows={6}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal text-slate-900" />
    </div>;
  };
  return <div className="space-y-5">
    <p className="text-sm text-slate-600">Estos campos componen todas las instrucciones de generación. Puedes borrar cualquier bloque; los reintentos conservarán el mismo texto aprobado. Solo se incluye el caso de cada prenda según su clasificación.</p>
    <PromptBaseField value={state.prompt} onChange={onPromptChange} sourceLabel={sourceLabel} />
    {blocks.modelGender && field(`Prendas · Prompt adicional para modelo ${blocks.modelGender === 'male' ? 'hombre' : 'mujer'}`, blocks.gender ?? '', (gender) => onBlocksChange({ ...blocks, gender }))}
    {field('Conservación de identidad y rasgos de la modelo', blocks.identity, (identity) => onBlocksChange({ ...blocks, identity }))}
    {field('Tratamiento de etiquetas interiores', blocks.internalLabels, (internalLabels) => onBlocksChange({ ...blocks, internalLabels }))}
    {caseKeys.map((key) => field(CASE_LABELS[key], blocks.cases[key], (text) => onBlocksChange({ ...blocks, cases: { ...blocks.cases, [key]: text } })))}
    {caseKeys.includes('carry_accessory') && field('Reglas de accesorios', blocks.accessories, (accessories) => onBlocksChange({ ...blocks, accessories }))}
    <p className="text-xs text-slate-500">Se envía una foto de referencia por pose. Las fotos de varios ángulos se usan por separado; no se añade una instrucción de referencia compuesta.</p>
    <label className="block space-y-2 text-sm font-medium text-slate-700">
      <span>Vista previa por prenda · Texto exacto para fal.ai</span>
      <select value={garment?.id || ''} onChange={(event) => setPreviewId(event.target.value)} className="w-full rounded-xl border border-slate-200 p-3">
        {state.garments.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{resolveTryOnPromptCaseKey(entry.garmentBodyArea) ? '' : ' · Sin caso A/B/C'}</option>)}
      </select>
    </label>
    <pre aria-label="Prompt completo para fal.ai" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">{preview}</pre>
    <p className={`text-xs ${preview.length > MAX_APPROVED_TRY_ON_PROMPT_LENGTH || !preview.trim() ? 'text-rose-700' : 'text-slate-500'}`}>{preview.length} / {MAX_APPROVED_TRY_ON_PROMPT_LENGTH} caracteres. El prompt completo de cada prenda debe contener texto.</p>
  </div>;
};
