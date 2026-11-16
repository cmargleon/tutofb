import type { PhotoPlan, PhotoRecipePreferences } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';

export const PHOTO_LABELS: Record<string, string> = {
  ordinary: 'Ropa ordinaria', underwear: 'Ropa interior', swimwear: 'Baño', bodysuit: 'Body infantil', fitted_child: 'Prenda infantil ajustada',
  accessory: 'Accesorio', object: 'Objeto', baby: 'Bebé', child: 'Infantil', adult: 'Adulto', upper_body: 'Superior', lower_body: 'Inferior',
  full_body: 'Completa', footwear: 'Calzado', head_accessory: 'Accesorio de cabeza', carry_accessory: 'Bolso / mochila',
  male: 'Masculino', female: 'Femenino', unisex: 'Unisex', unit: 'Unidad', set: 'Conjunto', multipack: 'Multipack',
  model: 'Con modelo', flat_lay: 'Prenda en plano', product: 'Objeto', reference: 'Detalle real',
  front: 'Frente', back: 'Espalda', side: 'Lateral', detail: 'Detalle',
  white: 'Blanco puro', neutral: 'Neutro / contexto discreto', context: 'Contexto', original: 'Referencia original',
  omit: 'Omitir la vista', review: 'Solicitar revisión del artículo',
  default: 'Predeterminado', client: 'Receta del cliente', category: 'Excepción de categoría', constraint: 'Restricción del canal, categoría o referencia',
};
export const PHOTO_PREFERENCE_LABELS: Record<keyof PhotoRecipePreferences, string> = {
  views: 'Vistas adicionales y orden',
  missingReference: 'Si falta una referencia',
  mainBackground: 'Fondo de portada',
  additionalBackground: 'Fondo de espalda y lateral',
  mainComposition: 'Composición de portada',
  additionalComposition: 'Composición de espalda y lateral',
};
const channelName = (id: string) => MARKETPLACES.find(m => m.id === id)?.name || id;

export function MarketplacePhotoPlanPreview({ plan, showInstructions = false }: { plan: PhotoPlan; showInstructions?: boolean }) {
  const shared = plan.tasks.filter(task => task.destinations.length > 1).length;
  return <div className="space-y-3 text-sm">
    <p><strong>{plan.estimate.uniqueImages} imágenes únicas</strong> · {shared} compartidas entre destinos · USD {plan.estimate.estimatedCostUsd.toFixed(3)} estimados, sin reintentos.</p>
    {plan.articles.map(article => {
      const decisions = plan.recipeSnapshot?.articles.find(entry => entry.itemId === article.itemId);
      return <details key={article.itemId} className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer font-medium">{article.name} · Referencias y procedencia de las preferencias</summary>
        <p className="mt-2">Referencias disponibles · {article.references.map(r => PHOTO_LABELS[r.view]).filter((view, index, views) => views.indexOf(view) === index).join(', ') || 'Ninguna'}</p>
        {decisions?.channels.map(({ channel, preferences, sources }) => <div key={channel} className="mt-3">
          <p className="font-medium">{channelName(channel)}</p>
          <ul className="mt-1 space-y-1 text-xs text-slate-700">
            <li>{PHOTO_PREFERENCE_LABELS.views} · {preferences.views?.map(view => PHOTO_LABELS[view]).join(' → ') || 'Ninguna'} · {PHOTO_LABELS[sources.views || 'default']}</li>
            <li>{PHOTO_PREFERENCE_LABELS.missingReference} · {PHOTO_LABELS[preferences.missingReference || 'omit']} · {PHOTO_LABELS[sources.missingReference || 'default']}</li>
          </ul>
        </div>)}
      </details>;
    })}
    {plan.issues.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <h4 className="font-medium">Incidencias</h4>
      <ul className="mt-1 space-y-1">{plan.issues.map((issue, index) => <li key={index} className={issue.blocking ? 'text-rose-800' : 'text-amber-900'}>
        {issue.blocking ? 'Revisión requerida · ' : ''}{plan.articles.find(a => a.itemId === issue.itemId)?.name} · {issue.message}
      </li>)}</ul>
    </div>}
    {plan.tasks.map(task => <details className="rounded-lg bg-slate-50 p-3" key={task.id}>
      <summary className="cursor-pointer">
        {plan.articles.find(a => a.itemId === task.itemId)?.name} · {task.sceneId || PHOTO_LABELS[task.view]} · {PHOTO_LABELS[task.composition]} · {PHOTO_LABELS[task.background]} → {task.destinations.map(destination => `${channelName(destination.channel)} ${destination.role === 'main' ? 'portada' : destination.position}`).join(', ')}
      </summary>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">{task.destinations.map(destination => <li key={destination.channel}>
        <strong>{channelName(destination.channel)} · {destination.required ? 'Portada obligatoria' : `Posición ${destination.position}`}</strong>
        {' · Fondo: '}{PHOTO_LABELS[destination.recipeSources?.background || 'default']}
        {' · Composición: '}{PHOTO_LABELS[destination.recipeSources?.composition || 'default']}
      </li>)}</ul>
      {showInstructions && <>
        <p className="mt-2">{task.base ? `Base verificada: ${task.base.id}` : task.identityBase ? 'Se preservará la identidad del modelo y se adaptarán fondo y encuadre.' : task.composition === 'model' ? 'Sin base verificada compatible: se creará una persona sintética.' : 'Sin modelo humano.'}</p>
        <p className="mt-2 whitespace-pre-wrap">{task.instructions}</p>
      </>}
    </details>)}
  </div>;
}
