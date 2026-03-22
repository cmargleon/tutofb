import React from 'react';

interface PromptBaseFieldProps {
  value: string;
  onChange: (prompt: string) => void;
}

export const PromptBaseField: React.FC<PromptBaseFieldProps> = ({ value, onChange }) => (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">Prompt base</label>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={5}
      className="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none"
      placeholder="Describe la instrucción base del try-on"
    />
    <p className="mt-2 text-xs text-slate-500">
      Se combina con `backgroundConfig` normalizado y con una nota extra cuando la prenda es multiángulo.
    </p>
  </div>
);
