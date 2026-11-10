import type { PhotoArticleAttributes, PhotoPlan } from '../../../shared/src/types';
import { PHOTO_ATTRIBUTE_VALUES } from '../../../shared/src/photoAttributes';
import { manualPhotoAttribute } from '../../../shared/src/marketplacePhotoPlan';
const LABELS: Record<string, string> = { ordinary: 'Ropa ordinaria', underwear: 'Ropa interior', swimwear: 'Baño', bodysuit: 'Body infantil', fitted_child: 'Prenda infantil ajustada', accessory: 'Accesorio', object: 'Objeto', baby: 'Bebé', child: 'Infantil', adult: 'Adulto', upper_body: 'Superior', lower_body: 'Inferior', full_body: 'Completa', footwear: 'Calzado', head_accessory: 'Accesorio de cabeza', carry_accessory: 'Bolso / mochila', male: 'Masculino', female: 'Femenino', unisex: 'Unisex', unit: 'Unidad', set: 'Conjunto', multipack: 'Multipack', model: 'Con modelo', flat_lay: 'Producto en plano', product: 'Objeto', reference: 'Detalle real', front: 'Frente', back: 'Espalda', side: 'Lateral', detail: 'Detalle', white: 'Blanco puro', neutral: 'Neutro / contexto discreto', context: 'Contexto', original: 'Referencia original' };
export function MarketplacePhotoPlanPanel({ plan, onAttributesChange, onIdentityChange, disabled }: { plan: PhotoPlan; disabled: boolean; onIdentityChange: (itemId: string, productId: string, variantId: string) => void; onAttributesChange: (itemId: string, attributes: Partial<PhotoArticleAttributes>) => void }) {
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Fotografías para {plan.channels.join(', ')}</h2>
    <p>{plan.estimate.uniqueImages} imágenes únicas · {plan.tasks.filter(t => t.destinations.length > 1).length} compartidas · estimación inicial USD {plan.estimate.estimatedCostUsd.toFixed(3)} (sin reintentos).</p>
    {plan.articles.filter(a => a.kind === 'garment').map(a => <fieldset key={a.itemId} disabled={disabled} className="rounded-xl border p-3">
      <legend className="px-2 font-medium">{a.name}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Producto (común entre colores)<input className="mt-1 w-full rounded border p-2" value={a.productId} onChange={e => onIdentityChange(a.itemId, e.target.value, a.variantId)} /></label>
        <label className="text-sm">Variante / color / SKU hijo<input className="mt-1 w-full rounded border p-2" value={a.variantId} onChange={e => onIdentityChange(a.itemId, a.productId, e.target.value)} /></label>{Object.entries(PHOTO_ATTRIBUTE_VALUES).map(([key, values]) => {
        const attribute = a.attributes[key as keyof PhotoArticleAttributes];
        return <label key={key} className="text-sm">{({ category: 'Categoría', audience: 'Público', bodyArea: 'Zona corporal', gender: 'Género comercial', packaging: 'Presentación' })[key] || key}
          <select className="mt-1 w-full rounded border p-2" value={String(attribute?.value ?? '')} title={attribute?.evidence} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, [key]: manualPhotoAttribute(e.target.value) })}>
            <option value="">Por confirmar</option>{values.map(value => <option key={value} value={value}>{LABELS[value] || value}</option>)}
          </select><span className="text-xs text-slate-500">{attribute?.source || 'Sin evidencia'} · {attribute?.confidence == null ? '?' : Math.round(attribute.confidence * 100) + '%'}</span>
        </label>;
      })}
        <label className="text-sm">Transparencia<select className="mt-1 w-full rounded border p-2" value={a.attributes.transparency?.value == null ? '' : String(a.attributes.transparency.value)} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, transparency: manualPhotoAttribute(e.target.value === 'true') })}><option value="">Por confirmar</option><option value="false">No</option><option value="true">Sí</option></select></label>
        {(['components', 'color'] as const).map(key => <label className="text-sm" key={key}>{key === 'components' ? 'Componentes y cantidades vendidos' : 'Color / variante'}<input className="mt-1 w-full rounded border p-2" value={a.attributes[key]?.value || ''} onChange={e => onAttributesChange(a.itemId, { ...a.attributes, [key]: manualPhotoAttribute(e.target.value) })} /></label>)}
      </div>
    </fieldset>)}
    {plan.issues.map((issue, i) => <p key={i} className={issue.blocking ? 'text-sm text-rose-700' : 'text-sm text-amber-800'}>{plan.articles.find(a => a.itemId === issue.itemId)?.name}: {issue.message}</p>)}
    <div className="space-y-2">{plan.tasks.map(t => <details className="rounded-lg bg-slate-50 p-3 text-sm" key={t.id}>
      <summary>{plan.articles.find(a => a.itemId === t.itemId)?.name} · {t.sceneId || LABELS[t.view]} · {LABELS[t.composition]} · {LABELS[t.background]} → {t.destinations.map(d => `${d.channel} ${d.role === 'main' ? 'portada' : d.position}`).join(', ')}</summary>
      <p className="mt-2">{t.base ? `Base verificada: ${t.base.id}` : t.identityBase ? 'Se preservará la identidad del modelo; se adaptarán fondo y encuadre.' : t.composition === 'model' ? 'Sin base verificada compatible: se creará una persona sintética.' : 'Sin modelo humano.'}</p>
      <p className="mt-2 whitespace-pre-wrap">{t.instructions}</p>
    </details>)}</div>
    <p className="text-sm text-slate-600">La generación no acredita cumplimiento. Cada destino se valida por separado; la exportación conserva pendientes si falta su portada. La autorización de copias públicas se realiza desde la exportación de marketplaces.</p>
  </section>;
}
