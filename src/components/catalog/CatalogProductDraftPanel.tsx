import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Batch, Job, ProductDraft, SpreadsheetTemplateCategory, SpreadsheetTemplateCategoryColumn } from '../../../shared/src/types';
import { resolveApprovedJobOutput } from '../../../shared/src/domain';
import { toMillisOrZero } from '../../../shared/src/utils/dateUtils';
import { db } from '../../firebase';
import { useToast } from '../../features/feedback/FeedbackProvider';
import { updateBatchProductDraft } from '../../features/evaluation/firebase';
import { useBatchProductDrafts } from '../../features/evaluation/useBatchProductDrafts';
import { useBatchSpreadsheetCategory } from '../../features/evaluation/useBatchSpreadsheetCategory';
import { resolveStorageAssetUrl } from '../../features/storage/assets';
import { ProductDraftEditor } from '../product-drafts/ProductDraftEditor';

interface CatalogProductDraftPanelProps {
  job: Job;
}

const normalizeComparable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const resolveDetailImageIndex = (column: SpreadsheetTemplateCategoryColumn): number | null => {
  const candidates = [column.key, column.label].map(normalizeComparable);

  for (const candidate of candidates) {
    const exactMatch = candidate.match(/detail_img_(\d+)$/) || candidate.match(/detalle_img_(\d+)$/);
    if (exactMatch) {
      return Number(exactMatch[1]);
    }

    const compactMatch = candidate.match(/detail_(\d+)$/)
      || candidate.match(/detalle_(\d+)$/)
      || candidate.match(/detail(\d+)$/)
      || candidate.match(/detalle(\d+)$/);
    if (compactMatch) {
      return Number(compactMatch[1]);
    }
  }

  return null;
};

const resolveJobOutputUrl = async (storagePath: string): Promise<string> => {
  try {
    return (await resolveStorageAssetUrl(storagePath)).url;
  } catch {
    return '';
  }
};

const hydrateDraftDetailImageRows = (
  draft: ProductDraft,
  category: SpreadsheetTemplateCategory | undefined,
  detailImageUrls: string[],
): ProductDraft => {
  if (!category) {
    return draft;
  }

  return {
    ...draft,
    rows: draft.rows.map((row) => ({
      ...row,
      values: category.columns.reduce<Record<string, string>>((accumulator, column) => {
        const detailIndex = resolveDetailImageIndex(column);
        const fallbackValue = detailIndex ? detailImageUrls[detailIndex - 1] || '' : null;
        accumulator[column.key] = fallbackValue || row.values[column.key] || '';
        return accumulator;
      }, { ...row.values }),
    })),
  };
};

export const CatalogProductDraftPanel: React.FC<CatalogProductDraftPanelProps> = ({ job }) => {
  const toast = useToast();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchLoading, setBatchLoading] = useState(Boolean(job.batchId));
  const [batchError, setBatchError] = useState<string | null>(null);
  const [editableProductDrafts, setEditableProductDrafts] = useState<ProductDraft[]>([]);
  const [dirtyDraftIds, setDirtyDraftIds] = useState<string[]>([]);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [detailImageUrlsByDraftId, setDetailImageUrlsByDraftId] = useState<Record<string, string[]>>({});
  const [detailImageUrlsLoading, setDetailImageUrlsLoading] = useState(false);
  const { productDrafts, loading: productDraftsLoading, error: productDraftsError } = useBatchProductDrafts(job.batchId);
  const {
    categories: spreadsheetCategories,
    loading: spreadsheetCategoriesLoading,
    error: spreadsheetCategoriesError,
  } = useBatchSpreadsheetCategory(batch);

  useEffect(() => {
    if (!job.batchId) {
      setBatch(null);
      setBatchLoading(false);
      setBatchError('No pudimos resolver el lote de este job.');
      return undefined;
    }

    setBatchLoading(true);
    setBatchError(null);
    const batchRef = doc(db, 'batches', job.batchId);
    return onSnapshot(
      batchRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          setBatch(null);
          setBatchLoading(false);
          setBatchError('No pudimos cargar el lote asociado a este job.');
          return;
        }

        setBatch({ id: docSnap.id, ...docSnap.data() } as Batch);
        setBatchLoading(false);
      },
      (error) => {
        console.error('Error loading batch for catalog lightbox:', error);
        setBatch(null);
        setBatchLoading(false);
        setBatchError('No pudimos cargar el lote asociado a este job.');
      },
    );
  }, [job.batchId]);

  useEffect(() => {
    setEditableProductDrafts((current) => {
      const currentById = new Map<string, ProductDraft>();
      current.forEach((draft) => {
        if (draft.id) {
          currentById.set(draft.id, draft);
        }
      });

      return productDrafts.map((draft) => {
        const currentDraft = draft.id ? currentById.get(draft.id) : null;
        if (!currentDraft || !draft.id || !dirtyDraftIds.includes(draft.id)) {
          return draft;
        }

        return {
          ...draft,
          rows: currentDraft.rows,
        };
      });
    });
  }, [dirtyDraftIds, productDrafts]);

  useEffect(() => {
    if (!job.batchId || productDrafts.length === 0) {
      setDetailImageUrlsByDraftId({});
      setDetailImageUrlsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDetailImageUrlsLoading(true);

    void getDocs(
      query(
        collection(db, 'jobs'),
        where('batchId', '==', job.batchId),
        where('status', '==', 'completed'),
        orderBy('createdAt', 'desc'),
      ),
    )
      .then(async (snapshot) => {
        if (cancelled) return;

        // Reverse to get chronological (ASC) order for detalle1..N numbering
        const completedJobs = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Job)
          .reverse();

        // Group completed jobs by garmentId
        const jobsByGarmentId = new Map<string, Job[]>();
        for (const j of completedJobs) {
          const existing = jobsByGarmentId.get(j.garmentId) || [];
          jobsByGarmentId.set(j.garmentId, [...existing, j]);
        }

        const entries = await Promise.all(
          productDrafts.map(async (draft) => {
            if (!draft.id) return null;
            const garmentJobs = jobsByGarmentId.get(draft.garmentId) || [];
            const paths = garmentJobs
              .map((j) => resolveApprovedJobOutput(j)?.resultImagePath)
              .filter((p): p is string => Boolean(p));
            const urls = (await Promise.all(paths.map(resolveJobOutputUrl))).filter(Boolean);
            return [draft.id, urls] as const;
          }),
        );

        if (!cancelled) {
          setDetailImageUrlsByDraftId(
            Object.fromEntries(entries.filter((e): e is readonly [string, string[]] => Boolean(e))),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailImageUrlsLoading(false);
      });

    return () => { cancelled = true; };
  }, [job.batchId, productDrafts]);

  const garmentDrafts = useMemo(
    () => editableProductDrafts
      .filter((draft) => draft.garmentId === job.garmentId)
      .map((draft) =>
        hydrateDraftDetailImageRows(
          draft,
          spreadsheetCategories.find((category) => category.id === draft.categoryId),
          draft.id ? (detailImageUrlsByDraftId[draft.id] || []) : [],
        )),
    [detailImageUrlsByDraftId, editableProductDrafts, job.garmentId, spreadsheetCategories],
  );

  const handleDraftRowsChange = (draft: ProductDraft, rows: ProductDraft['rows']) => {
    if (!draft.id) {
      return;
    }

    setEditableProductDrafts((current) =>
      current.map((entry) => (entry.id === draft.id ? { ...entry, rows } : entry)),
    );
    setDirtyDraftIds((current) => (current.includes(draft.id!) ? current : [...current, draft.id!]));
  };

  const handleSaveDraft = async (draft: ProductDraft) => {
    if (!draft.id) {
      return;
    }

    setSavingDraftId(draft.id);
    try {
      await updateBatchProductDraft(job.batchId, draft.id, draft.rows);
      setDirtyDraftIds((current) => current.filter((entry) => entry !== draft.id));
      toast({
        tone: 'success',
        title: 'Product draft guardado',
        description: `${draft.garmentName} quedó actualizado en el lote.`,
      });
    } catch (error: any) {
      toast({
        tone: 'error',
        title: 'No pudimos guardar el product draft',
        description: error?.message || 'Inténtalo de nuevo en unos segundos.',
      });
    } finally {
      setSavingDraftId(null);
    }
  };

  const panelError = batchError || productDraftsError || spreadsheetCategoriesError;
  const panelLoading = batchLoading || productDraftsLoading || spreadsheetCategoriesLoading || detailImageUrlsLoading;
  const isSpreadsheetBatch = Boolean(batch?.spreadsheetTemplateId);

  return (
    <aside className="flex min-h-0 flex-col border-t border-white/10 lg:border-l lg:border-t-0">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-white">Excel</h3>

        {panelLoading && !panelError ? (
          <div className="flex min-h-[16rem] items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-slate-300">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando campos del spreadsheet...
            </div>
          </div>
        ) : panelError ? (
          <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{panelError}</span>
            </div>
          </div>
        ) : !isSpreadsheetBatch ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            Este lote no usa salida tipo spreadsheet, así que esta prenda no tiene campos de Excel para editar.
          </div>
        ) : (
          <ProductDraftEditor
            categories={spreadsheetCategories}
            drafts={garmentDrafts}
            loading={panelLoading}
            error={null}
            emptyCopy="Esta prenda todavía no tiene product draft listo para editar."
            saveLabel="Guardar draft"
            savingDraftId={savingDraftId}
            layout="form"
            showDraftTabs={false}
            showSummaryCard={false}
            showGeneratedImagesSummary={false}
            showAddRowButton={false}
            showRowActions={false}
            resolveVisibleColumns={(draft, category) => {
              const detailImageCount = 'id' in draft && draft.id ? (detailImageUrlsByDraftId[draft.id] || []).length : 0;
              return category.columns.filter((column) => {
                const detailIndex = resolveDetailImageIndex(column);
                return detailIndex === null || detailIndex <= detailImageCount;
              });
            }}
            onChangeRows={(draft, rows) => handleDraftRowsChange(draft as ProductDraft, rows)}
            onSaveDraft={(draft) => handleSaveDraft(draft as ProductDraft)}
          />
        )}
      </div>
    </aside>
  );
};
