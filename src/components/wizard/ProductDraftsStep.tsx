import React from 'react';
import { BatchOutputMode, ProductDraftInput, SpreadsheetTemplateCategory } from '../../../shared/src/types';
import { ProductDraftEditor } from '../product-drafts/ProductDraftEditor';

interface ProductDraftsStepProps {
  outputMode: BatchOutputMode;
  category: SpreadsheetTemplateCategory | null;
  productDrafts: ProductDraftInput[];
  preparationStatus: 'idle' | 'preparing' | 'ready' | 'failed';
  preparationError: string | null;
  onChangeRows: (draft: ProductDraftInput, rows: ProductDraftInput['rows']) => void;
}

export const ProductDraftsStep: React.FC<ProductDraftsStepProps> = ({
  outputMode,
  category,
  productDrafts,
  preparationStatus,
  preparationError,
  onChangeRows,
}) => {
  if (outputMode === 'photos_only') {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Lote sin spreadsheet</h3>
        <p className="mt-2 text-sm text-slate-600">
          Este flujo va a guardar únicamente las imágenes generadas. No vamos a preparar product drafts ni una exportación
          de spreadsheet para este lote.
        </p>
      </div>
    );
  }

  return (
    <ProductDraftEditor
      category={category}
      drafts={productDrafts}
      loading={preparationStatus === 'preparing'}
      error={preparationError}
      emptyCopy="Sube prendas, elige poses y deja que Gemini prepare un borrador inicial para cada producto."
      onChangeRows={(draft, rows) => onChangeRows(draft as ProductDraftInput, rows)}
    />
  );
};
