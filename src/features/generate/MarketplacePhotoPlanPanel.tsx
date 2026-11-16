import type { PhotoArticleAttributes, PhotoPlan } from '../../../shared/src/types';
import { PHOTO_ATTRIBUTE_VALUES } from '../../../shared/src/photoAttributes';
import { manualPhotoAttribute } from '../../../shared/src/marketplacePhotoPlan';
import { MarketplacePhotoPlanPreview, PHOTO_LABELS as LABELS } from './MarketplacePhotoPlanPreview';
export function MarketplacePhotoPlanPanel({ plan, onAttributesChange, onIdentityChange, disabled }: { plan: PhotoPlan; disabled: boolean; onIdentityChange: (itemId: string, productId: string, variantId: string) => void; onAttributesChange: (itemId: string, attributes: Partial<PhotoArticleAttributes>) => void }) {
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Fotografías para {plan.channels.join(', ')}</h2>
    {plan.articles.filter(a => a.kind === 'garment').map(a => <fieldset key={a.itemId} disabled={disabled} className="rounded-xl border p-3">
      <legend className="px-2 font-medium">{a.name}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Producto (común entre colores)<input className="tuto-field mt-1 w-full" value={a.productId} onChange={e => onIdentityChange(a.itemId, e.target.value, a.variantId)} /></label>
        <label className="text-sm">Variante / color / SKU hijo<input className="tuto-field mt-1 w-full" value={a.variantId} onChange={e => onIdentityChange(a.itemId, a.productId, e.target.value)} /></label>{Object.entries(PHOTO_ATTRIBUTE_VALUES).map(([key, values]) => {
        const attribute = a.attributes[key as keyof PhotoArticleAttributes];
        return <label key={key} className="text-sm">{({ category: 'Categoría', audience: 'Público', bodyArea: 'Zona corporal', gender: 'Género comercial', packaging: 'Presentación' })[key] || key}
          <select className="tuto-field mt-1 w-full" value={String(attribute?.value ?? '')} title={attribute?.evidence} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, [key]: manualPhotoAttribute(e.target.value) })}>
            <option value="">Por confirmar</option>{values.map(value => <option key={value} value={value}>{LABELS[value] || value}</option>)}
          </select><span className="text-xs text-slate-500">{attribute?.source || 'Sin evidencia'} · {attribute?.confidence == null ? '?' : Math.round(attribute.confidence * 100) + '%'}</span>
        </label>;
      })}
        <label className="text-sm">Transparencia<select className="tuto-field mt-1 w-full" value={a.attributes.transparency?.value == null ? '' : String(a.attributes.transparency.value)} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, transparency: manualPhotoAttribute(e.target.value === 'true') })}><option value="">Por confirmar</option><option value="false">No</option><option value="true">Sí</option></select></label>
        {(['components', 'color'] as const).map(key => <label className="text-sm" key={key}>{key === 'components' ? 'Componentes y cantidades vendidos' : 'Color / variante'}<input className="tuto-field mt-1 w-full" value={a.attributes[key]?.value || ''} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, [key]: manualPhotoAttribute(e.target.value) })} /></label>)}
      </div>
    </fieldset>)}
    <MarketplacePhotoPlanPreview plan={plan} showInstructions />
    <p className="text-sm text-slate-600">La generación no acredita cumplimiento. Cada destino se valida por separado; la exportación conserva pendientes si falta su portada. La autorización de copias públicas se realiza desde la exportación de marketplaces.</p>
  </section>;
}
