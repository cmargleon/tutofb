import React from 'react';

interface PromptBaseFieldProps {
  value: string;
  onChange: (prompt: string) => void;
  sourceLabel: string;
}

export const PromptBaseField: React.FC<PromptBaseFieldProps> = ({ value, onChange, sourceLabel }) => {
  const id = React.useId();
  return <div>
    <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-700">Prompt general</label>
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={5}
      className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
      placeholder="Describe la instrucción base del try-on"
    />
    <p className="mt-2 text-xs text-slate-500">
      Se precarga desde {sourceLabel}. Los bloques conocidos de etiquetas y accesorios se muestran
      en campos separados. Revisa también las instrucciones personalizadas del prompt general.
    </p>
  </div>;
};
