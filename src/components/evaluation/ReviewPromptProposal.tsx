import React from 'react';

export const ReviewPromptProposal: React.FC<{
  text?: string | null;
  disabled: boolean;
  onEdit: (text: string) => void;
}> = ({ text, disabled, onEdit }) => text ? <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-slate-800">
  <p className="font-semibold">Corrección de Gemini</p>
  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{text}</pre>
  <button type="button" disabled={disabled} className="rounded-lg border border-amber-400 px-3 py-2 font-semibold disabled:opacity-50"
    onClick={() => onEdit(text)}>Cargar propuesta en el editor</button>
  <p>Se usa en el siguiente reintento automático si quedan intentos disponibles. También puedes editarla para regenerar manualmente.</p>
</div> : null;
