import { useState } from 'react';
import { ArrowDown, ArrowUp, LockKeyhole } from 'lucide-react';
import type { Client, PhotoArticle, PhotoRecipe, PhotoRecipeCategory, PhotoRecipePreferences } from '../../../shared/src/types';
import type { MarketplaceId } from '../../../shared/src/marketplaces';
import { PHOTO_RECIPE_CATEGORIES, PHOTO_RECIPE_OPTIONS, PHOTO_RECIPE_VIEWS, effectivePhotoRecipe, photoRecipeAllowsOption } from '../../../shared/src/marketplacePhotoRecipe';
import { buildMarketplacePhotoPlan, manualPhotoAttribute, PHOTO_RULES } from '../../../shared/src/marketplacePhotoPlan';
import { resolveCommercialPhotoConfig } from '../../../shared/src/commercialPhoto';
import { DEFAULT_IMAGE_PROVIDER } from '../../../shared/src/domain';
import { Alert, Badge, Button, Field, IconButton, INPUT_CLASS } from '../../components/ui';
import { MarketplacePhotoPlanPreview, PHOTO_LABELS, PHOTO_PREFERENCE_LABELS } from '../generate/MarketplacePhotoPlanPreview';
import { useConfirm } from '../feedback/FeedbackProvider';
import { useMarketplacePhotoRecipe } from './useMarketplacePhotoRecipe';

const EXAMPLE_VIEWS = ['front', ...PHOTO_RECIPE_VIEWS] as const;
const DEFAULT_RECIPE: PhotoRecipe = { general: {}, categories: {} };
const toggleValue = <T,>(values: readonly T[], value: T): T[] => values.includes(value) ? values.filter(entry => entry !== value) : [...values, value];

export function MarketplacePhotoRecipeEditor({ client, channel }: { client: Client; channel: MarketplaceId }) {
  const state = useMarketplacePhotoRecipe(client, channel);
  const confirm = useConfirm();
  const [scope, setScope] = useState<PhotoRecipeCategory | 'general'>('general');
  const [category, setCategory] = useState<PhotoRecipeCategory>('ordinary');
  const [audience, setAudience] = useState<'adult' | 'child' | 'baby'>('adult');
  const [packaging, setPackaging] = useState<'unit' | 'multipack'>('unit');
  const [references, setReferences] = useState<PhotoArticle['references'][number]['view'][]>([...EXAMPLE_VIEWS]);
  const recipe = state.value.recipe ?? DEFAULT_RECIPE;
  const scoped = scope === 'general' ? recipe.general : recipe.categories[scope] ?? {};
  const inherited = effectivePhotoRecipe(scope === 'general' ? undefined : { ...recipe, categories: {} }, null).preferences;
  const shownViews = scoped.views ?? inherited.views;
  const disabled = state.saving || client.status === 'archived';

  function change<K extends keyof PhotoRecipePreferences>(key: K, value: PhotoRecipePreferences[K] | undefined) {
    const next = { ...scoped };
    if (value === undefined) delete next[key];
    else next[key] = value;
    const updated = { general: recipe.general, categories: { ...recipe.categories } };
    if (scope === 'general') updated.general = next;
    else if (Object.keys(next).length) updated.categories[scope] = next;
    else delete updated.categories[scope];
    state.setRecipe(Object.keys(updated.general).length || Object.keys(updated.categories).length ? updated : null);
  }

  function moveView(index: number, direction: -1 | 1) {
    if (!scoped.views) return;
    const ordered = [...scoped.views];
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    change('views', ordered);
  }

  const preview = buildMarketplacePhotoPlan({
    clientId: client.id!, provider: DEFAULT_IMAGE_PROVIDER, ...resolveCommercialPhotoConfig(DEFAULT_IMAGE_PROVIDER),
    marketplaces: { ...client.marketplaces, [channel]: { enabled: true, photoRecipe: state.value.recipe ?? undefined, photoRecipeRevision: state.value.revision } },
    articles: [{ itemId: 'example', productId: 'example', variantId: 'blue', name: 'Prenda de ejemplo', kind: 'garment',
      attributes: { category: manualPhotoAttribute(category), audience: manualPhotoAttribute(audience), packaging: manualPhotoAttribute(packaging),
        bodyArea: manualPhotoAttribute('upper_body'), color: manualPhotoAttribute('azul'), transparency: manualPhotoAttribute(false),
        components: manualPhotoAttribute(packaging === 'unit' ? '1 prenda' : '2 prendas') },
      references: references.map(view => ({ id: view, view, storagePath: `example/${view}.jpg` })),
    }],
  });

  return <section className="mt-5 space-y-4 border-t border-slate-200 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">Receta fotográfica</h4>
      <Badge tone={state.base.recipe ? 'accent' : 'neutral'}>{state.base.recipe ? `Versión ${state.base.revision}` : 'Valores predeterminados'}</Badge>
    </div>
    <details className="rounded-lg bg-slate-50 p-3 text-sm">
      <summary className="cursor-pointer font-medium"><LockKeyhole className="mr-1 inline h-4 w-4" aria-hidden="true" /> Requisitos obligatorios del canal</summary>
      <p className="mt-2">La portada frontal y la fidelidad a la variante se mantienen para todas las prendas. Los requisitos específicos se aplican según la categoría y el público.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {PHOTO_RULES.filter(rule => rule.level === 'obligation' && (rule.channel === channel || rule.channel === 'common')).map(rule => <li key={rule.id}>{rule.text}</li>)}
      </ul>
    </details>
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Preferencias comerciales</legend>
      <Field label="Alcance de la receta">
        <select className={INPUT_CLASS} value={scope} onChange={e => {
          const next = e.target.value as typeof scope;
          setScope(next);
          if (next !== 'general') setCategory(next);
        }}>
          <option value="general">Receta general</option>
          {PHOTO_RECIPE_CATEGORIES.map(value => <option key={value} value={value}>{PHOTO_LABELS[value]}{recipe.categories[value] ? ' · con excepción' : ''}</option>)}
        </select>
      </Field>
      <p className="text-xs text-slate-600">Los campos de una categoría heredan la receta general. Las excepciones sustituyen solo los campos que edites.</p>
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Vistas adicionales y orden</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => change('views', scoped.views ? undefined : [...inherited.views])}>
            {scoped.views ? (scope === 'general' ? 'Usar orden predeterminado' : 'Heredar vistas y orden') : 'Personalizar vistas'}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {PHOTO_RECIPE_VIEWS.map(view => <label key={view} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={shownViews.includes(view)} disabled={scoped.views === undefined}
              onChange={() => change('views', toggleValue(shownViews, view))} />{PHOTO_LABELS[view]}
          </label>)}
        </div>
        <ol className="mt-2 space-y-1 text-sm">
          {shownViews.map((view, index) => <li key={view} className="flex items-center gap-1">
            <span className="mr-auto">{index + 1}. {PHOTO_LABELS[view]}</span>
            {scoped.views && <>
              <IconButton size="sm" label={`Subir ${PHOTO_LABELS[view]}`} icon={ArrowUp} disabled={index === 0} onClick={() => moveView(index, -1)} />
              <IconButton size="sm" label={`Bajar ${PHOTO_LABELS[view]}`} icon={ArrowDown} disabled={index === shownViews.length - 1} onClick={() => moveView(index, 1)} />
            </>}
          </li>)}
        </ol>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(PHOTO_RECIPE_OPTIONS) as Array<keyof typeof PHOTO_RECIPE_OPTIONS>).filter(field => photoRecipeAllowsOption(channel, field, scope === 'general' ? undefined : scope)).map(field =>
          <Field key={field} label={PHOTO_PREFERENCE_LABELS[field]}>
            <select className={INPUT_CLASS} value={scoped[field] ?? ''} onChange={e => {
              const value = [...PHOTO_RECIPE_OPTIONS[field]].find(entry => entry === e.target.value);
              change(field, value);
            }}>
              <option value="">{scope === 'general' || !recipe.general[field] ? 'Predeterminado' : `Heredar · ${PHOTO_LABELS[recipe.general[field]!]}`}</option>
              {PHOTO_RECIPE_OPTIONS[field].map(value => <option key={value} value={value}>{PHOTO_LABELS[value]}</option>)}
            </select>
          </Field>)}
      </div>
      <p className="text-xs text-slate-600">Las preferencias de fondo y composición se aplican donde la prenda y el canal admiten alternativas. El detalle conserva la referencia original.</p>
    </fieldset>
    {state.error && <Alert tone="danger">{state.error}</Alert>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" loading={state.saving} disabled={disabled || !state.dirty || !!state.conflict}
        onClick={() => void state.save(state.value.recipe)}>Guardar receta</Button>
      {state.base.recipe && <Button type="button" size="sm" variant="secondary" disabled={disabled || !!state.conflict} onClick={async () => {
        if (await confirm({ title: 'Restaurar receta predeterminada', description: 'Se quitarán la receta general y sus excepciones para los planes futuros de este canal.', confirmLabel: 'Restaurar valores predeterminados' })) await state.save(null);
      }}>Restaurar valores predeterminados</Button>}
      {(state.dirty || state.conflict) && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={state.discard}>{state.conflict ? 'Cargar receta guardada' : 'Descartar borrador'}</Button>}
      {state.dirty && <span className="text-xs text-[var(--color-warning)]">Cambios sin guardar</span>}
    </div>
    <details className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Vista previa del plan</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-600">Prenda de ejemplo con los ajustes del borrador, el proveedor predeterminado y los demás canales habilitados.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoría del ejemplo"><select className={INPUT_CLASS} value={category} onChange={e => setCategory(e.target.value as typeof category)}>
            {PHOTO_RECIPE_CATEGORIES.map(value => <option key={value} value={value}>{PHOTO_LABELS[value]}</option>)}
          </select></Field>
          <Field label="Público del ejemplo"><select className={INPUT_CLASS} value={audience} onChange={e => setAudience(e.target.value as typeof audience)}>
            {(['adult', 'child', 'baby'] as const).map(value => <option key={value} value={value}>{PHOTO_LABELS[value]}</option>)}
          </select></Field>
          <Field label="Presentación del ejemplo"><select className={INPUT_CLASS} value={packaging} onChange={e => setPackaging(e.target.value as typeof packaging)}>
            <option value="unit">Unidad</option><option value="multipack">Multipack</option>
          </select></Field>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <legend className="mb-1 font-medium">Referencias disponibles en el ejemplo</legend>
          {EXAMPLE_VIEWS.map(view => <label key={view} className="flex items-center gap-1.5">
            <input type="checkbox" checked={references.includes(view)} onChange={() => setReferences(toggleValue(references, view))} />{PHOTO_LABELS[view]}
          </label>)}
        </fieldset>
        <MarketplacePhotoPlanPreview plan={preview} />
      </div>
    </details>
  </section>;
}
