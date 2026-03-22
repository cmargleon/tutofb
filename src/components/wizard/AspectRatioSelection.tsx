import React from 'react';
import { ASPECT_RATIO_VALUES } from '../../../shared/src/domain';
import { WizardState } from '../../features/generate/types';

const RATIO_LABELS: Record<(typeof ASPECT_RATIO_VALUES)[number], string> = {
  '9:16': 'Stories / Reels',
  '3:4': 'Catálogo vertical',
  '2:3': 'Portrait',
  '1:1': 'Cuadrado',
  '4:3': 'Landscape clásico',
  '3:2': 'Editorial horizontal',
  '16:9': 'Hero wide',
};

interface AspectRatioSelectionProps {
  value: WizardState['aspectRatio'];
  onChange: (ratio: WizardState['aspectRatio']) => void;
}

export const AspectRatioSelection: React.FC<AspectRatioSelectionProps> = ({ value, onChange }) => (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">Relación de aspecto</label>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {ASPECT_RATIO_VALUES.map((ratio) => (
        <button
          type="button"
          key={ratio}
          onClick={() => onChange(ratio)}
          className={`rounded-2xl border px-4 py-3 text-left transition ${
            value === ratio
              ? 'border-emerald-700 bg-emerald-600 text-white'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <div className="font-semibold">{ratio}</div>
          <div className={`mt-1 text-xs ${value === ratio ? 'text-emerald-100' : 'text-slate-500'}`}>
            {RATIO_LABELS[ratio]}
          </div>
        </button>
      ))}
    </div>
  </div>
);
