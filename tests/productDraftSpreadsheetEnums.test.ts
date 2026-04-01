import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpreadsheetTemplateCategory } from '../shared/src/types';
import spreadsheetDraftColumns from '../shared/src/utils/spreadsheetDraftColumns';

const {
  getProductDraftColumnAllowedValues,
  getProductDraftColumnDefaultValue,
  getProductDraftSpecificationAttributeName,
  isProductDraftDropdownColumn,
  resolveProductDraftColumnValue,
} = spreadsheetDraftColumns as typeof import('../shared/src/utils/spreadsheetDraftColumns');

const category: SpreadsheetTemplateCategory = {
  id: 'cat-1',
  templateId: 'template-1',
  clientId: 'client-1',
  sheetName: 'Blusas Niñas (8-12)(7401-2002)',
  label: 'Blusas Niñas (8-12)(7401-2002)',
  rowStart: 7,
  columns: [
    {
      index: 0,
      letter: 'A',
      label: 'Especificación 1 (Especificación principal)',
      key: 'main_attribute',
      required: true,
      requirementLabel: 'Requerido',
      guidance: 'Seleccione un valor como especificación principal.',
      validation: 'Selección desplegable',
    },
    {
      index: 1,
      letter: 'B',
      label: 'Especificación 1 Contenido',
      key: 'main_attribute_value',
      required: true,
      requirementLabel: 'Requerido',
      guidance: 'Seleccione el valor apropiado del menú desplegable en la celda.',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    },
    {
      index: 2,
      letter: 'C',
      label: 'Especificación 2',
      key: 'secondary_attribute_1',
      required: false,
      requirementLabel: 'Opcional',
      guidance: 'Si hay dos especificaciones, complételas.',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    },
    {
      index: 3,
      letter: 'D',
      label: 'Especificación 2 Contenido',
      key: 'secondary_attribute_1_value',
      required: false,
      requirementLabel: 'Opcional',
      guidance: 'Seleccione el valor apropiado del menú desplegable en la celda.',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    },
    {
      index: 4,
      letter: 'E',
      label: 'Elasticidad de la tela',
      key: 'fabric_stretch',
      required: false,
      requirementLabel: 'Opcional',
      guidance: 'Elige una opción del desplegable.',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    },
    {
      index: 5,
      letter: 'F',
      label: 'Tipo de embalaje',
      key: 'package_type',
      required: false,
      requirementLabel: 'Opcional',
      guidance: 'Seleccione un valor adecuado del desplegable.',
      validation: 'Selección desplegable',
      dropdownOptions: ['(0) Quitar el tipo de embalaje', '(1) Embalaje flexible + objetos blandos'],
    },
  ],
  attributes: [
    {
      attributeType: 'Especificación',
      name: 'Color(27)',
      required: false,
      important: true,
      values: ['Negro', 'Azul Marino', 'Rosa'],
    },
    {
      attributeType: 'Especificación',
      name: 'Talla(87)',
      required: false,
      important: true,
      values: ['8Y', '9Y', '10Y'],
    },
    {
      attributeType: 'común',
      name: 'Elasticidad de la tela',
      required: false,
      important: true,
      values: ['No-Elástico', 'Elástico Ligero', 'Elástico Alto'],
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

test('resuelve Color y Talla como especificaciones fijas del draft', () => {
  assert.equal(getProductDraftColumnDefaultValue(category, { key: 'main_attribute' }), 'Color(27)');
  assert.equal(getProductDraftColumnDefaultValue(category, { key: 'secondary_attribute_1' }), 'Talla(87)');
  assert.deepEqual(
    getProductDraftColumnAllowedValues(category, {
      key: 'main_attribute',
      label: 'Especificación 1',
      guidance: 'Selección desplegable',
      validation: 'Selección desplegable',
    }),
    ['Color(27)'],
  );
  assert.deepEqual(
    getProductDraftColumnAllowedValues(category, {
      key: 'main_attribute_value',
      label: 'Especificación 1 Contenido',
      guidance: 'Selección desplegable',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    }),
    ['Negro', 'Azul Marino', 'Rosa'],
  );
  assert.deepEqual(
    getProductDraftColumnAllowedValues(
      category,
      {
        key: 'secondary_attribute_1_value',
        label: 'Especificación 2 Contenido',
        guidance: 'Selección desplegable',
        validation: 'Selección desplegable',
        dropdownOptions: [],
      },
      { secondary_attribute_1: 'Talla(87)' },
    ),
    [],
  );
});

test('coacciona sugerencias al enum válido de la plantilla', () => {
  assert.equal(
    getProductDraftSpecificationAttributeName(category, { key: 'main_attribute_value' }),
    'Color(27)',
  );
  assert.equal(
    getProductDraftSpecificationAttributeName(category, { key: 'secondary_attribute_1_value' }),
    'Talla(87)',
  );

  assert.equal(
    resolveProductDraftColumnValue({
      category,
      column: {
        key: 'main_attribute_value',
        label: 'Especificación 1 Contenido',
        guidance: 'Selección desplegable',
        validation: 'Selección desplegable',
      },
      rowValues: {
        main_attribute: 'Color(27)',
      },
      candidates: ['azul marino'],
    }),
    'Azul Marino',
  );

  assert.equal(
    resolveProductDraftColumnValue({
      category,
      column: {
        key: 'fabric_stretch',
        label: 'Elasticidad de la tela',
        guidance: 'Selección desplegable',
        validation: 'Selección desplegable',
        dropdownOptions: [],
      },
      rowValues: {},
      candidates: ['elástico ligero'],
    }),
    'elástico ligero',
  );
});

test('detecta dropdowns solo cuando hay opciones reales o la excepcion de color', () => {
  assert.equal(
    isProductDraftDropdownColumn(category, {
      key: 'main_attribute_value',
      label: 'Especificación 1 Contenido',
      guidance: 'Selección desplegable',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    }),
    true,
  );
  assert.equal(
    isProductDraftDropdownColumn(category, {
      key: 'package_type',
      label: 'Tipo de embalaje',
      guidance: 'Seleccione un valor adecuado del desplegable.',
      validation: 'Selección desplegable',
      dropdownOptions: ['(0) Quitar el tipo de embalaje', '(1) Embalaje flexible + objetos blandos'],
    }),
    true,
  );
  assert.equal(
    isProductDraftDropdownColumn(category, {
      key: 'fabric_stretch',
      label: 'Elasticidad de la tela',
      guidance: 'Elige una opción del desplegable.',
      validation: 'Selección desplegable',
      dropdownOptions: [],
    }),
    false,
  );
});
