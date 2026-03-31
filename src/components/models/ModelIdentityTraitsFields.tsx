import React from 'react';
import { ModelIdentityTraits } from '../../../shared/src/types';
import {
  AGE_OPTIONS,
  BUILD_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_LENGTH_OPTIONS,
  SEX_OPTIONS,
  SKIN_OPTIONS,
} from '../../features/models/constants';
import { SelectField } from './SelectField';

interface ModelIdentityTraitsFieldsProps {
  value: ModelIdentityTraits;
  disabled?: boolean;
  onChange: (value: ModelIdentityTraits) => void;
}

const FIELD_CLASS = 'mb-1 block text-xs font-medium text-gray-600';

export const ModelIdentityTraitsFields: React.FC<ModelIdentityTraitsFieldsProps> = ({
  value,
  disabled = false,
  onChange,
}) => {
  const patch = (key: keyof ModelIdentityTraits, nextValue: string) => {
    onChange({
      ...value,
      [key]: nextValue || null,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div>
        <label className={FIELD_CLASS}>Sexo</label>
        <SelectField value={value.sex || ''} onChange={(event) => patch('sex', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {SEX_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className={FIELD_CLASS}>Edad</label>
        <SelectField value={value.age || ''} onChange={(event) => patch('age', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {AGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className={FIELD_CLASS}>Tono de piel</label>
        <SelectField value={value.skin || ''} onChange={(event) => patch('skin', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {SKIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className={FIELD_CLASS}>Color de pelo</label>
        <SelectField value={value.hairColor || ''} onChange={(event) => patch('hairColor', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {HAIR_COLOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className={FIELD_CLASS}>Largo de pelo</label>
        <SelectField value={value.hairLength || ''} onChange={(event) => patch('hairLength', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {HAIR_LENGTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      <div>
        <label className={FIELD_CLASS}>Complexión</label>
        <SelectField value={value.build || ''} onChange={(event) => patch('build', event.target.value)} disabled={disabled}>
          <option value="">Sin dato</option>
          {BUILD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  );
};
