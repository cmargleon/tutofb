import { SlidersHorizontal } from 'lucide-react';
import { MARKETPLACES } from '../../shared/src/marketplaces';
import { Alert, Button, Page, PageHeader } from '../components/ui';
import { ModelMarketplaceRuleForm } from '../features/models/marketplaceRules/ModelMarketplaceRuleForm';
import { useModelMarketplaceRulesEditor } from '../features/models/marketplaceRules/useModelMarketplaceRulesEditor';

export function ModelMarketplaceRules() {
  const editor = useModelMarketplaceRulesEditor();
  const marketplace = MARKETPLACES.find(m => m.id === editor.channel)!;
  return <Page width="medium">
    <PageHeader title="Reglas Marketplace" icon={SlidersHorizontal} description="Define cómo se generan y aprueban las poses base de los modelos para cada destino." />
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="Marketplace">
      {MARKETPLACES.map(channel => <button type="button" key={channel.id} role="tab" id={`tab-${channel.id}`} aria-controls="marketplace-rules-panel" aria-selected={editor.channel === channel.id} disabled={editor.saving} onClick={() => editor.setChannel(channel.id)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${editor.channel === channel.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{channel.name}</button>)}
    </div>
    {editor.loading ? <p role="status">Cargando reglas…</p> : editor.error ? <Alert tone="danger">No se pudieron cargar las reglas: {editor.error}</Alert> : <section id="marketplace-rules-panel" role="tabpanel" aria-labelledby={`tab-${editor.channel}`} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{marketplace.name}</h2><p className="mt-1 text-sm text-slate-500">Reglas globales para las bases de este marketplace. Los campos heredados conservan la configuración del cliente.</p></div><span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium">{editor.dirty ? 'Cambios sin guardar' : editor.revision ? `Versión ${editor.revision}` : 'Valores actuales de Tuto'}</span></div>
      <Alert tone="info">Guardar una nueva versión conserva las imágenes existentes. Las bases afectadas necesitarán verificación con las nuevas reglas antes de utilizarse. No se generan imágenes ni se realizan cobros al guardar.</Alert>
      <fieldset disabled={editor.saving} className="min-w-0"><ModelMarketplaceRuleForm value={editor.value} onChange={editor.edit} /></fieldset>
      {editor.saveError && <Alert tone="danger">{editor.saveError}</Alert>}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p role="status" className="text-sm text-slate-500">{editor.dirty ? `Cambios pendientes en ${marketplace.name}` : 'Todo guardado'}</p><div className="flex gap-2"><Button variant="secondary" disabled={!editor.dirty || editor.saving} onClick={editor.discard}>Descartar cambios</Button><Button loading={editor.saving} disabled={!editor.dirty} onClick={() => void editor.save()}>Guardar reglas</Button></div></div>
    </section>}
  </Page>;
}
