import { Link } from 'react-router-dom';
import type { ModelCreateFlowAiState, ModelCreateFlowSharedState } from '../../../features/models/hooks/useModelCreateFlow';
import { ModelPhotoSets } from '../ModelPhotoSets';
import { Button, ImageThumb } from '../../ui';

export function AiPosesStep({ ai }: { shared: ModelCreateFlowSharedState; ai: ModelCreateFlowAiState }) {
  return <div className="space-y-5">
    <div className="flex items-center gap-4 rounded-xl border bg-white p-4">
      <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg"><ImageThumb storagePath={ai.selectedCandidate!.storagePath} alt="Identidad elegida" previewOnClick /></div>
      <div><h3 className="font-semibold">Identidad elegida · {ai.savedModel?.name}</h3><p className="mt-1 text-sm text-slate-600">Todas las bases conservarán esta persona, edad y proporciones. Selecciona poses y destinos, revisa el costo y genera aquí.</p></div>
    </div>
    {ai.savedModel && ai.savedClient ? <ModelPhotoSets model={ai.savedModel} client={ai.savedClient} wizard onBusyChange={ai.setSetsBusy} initialProvider={ai.providerExplicit ? ai.provider : undefined} initialImageConfig={ai.providerExplicit ? ai.providerImageConfig : undefined} /> : <p role="status">Cargando identidad y destinos…</p>}
    {ai.savedModel?.poses.some(pose => pose.marketplaceBaseSpec) && !ai.setsBusy && <div className="flex flex-wrap items-center gap-4"><Button variant="ghost" onClick={() => void ai.handleStartAnotherModel()}>Crear otro modelo</Button><Link className="inline-flex text-sm font-medium text-indigo-600 underline" to={`/models/catalogo/${ai.savedModel.id}`}>Consultar este modelo en el catálogo</Link></div>}
  </div>;
}
