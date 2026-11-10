import React, { useState } from 'react';
import { MarketplaceTemplates, LegacyMarketplaceTemplates, useMarketplaceTemplates } from './MarketplaceTemplates';
import type { SpreadsheetTemplate } from '../../../shared/src/types';
import { Settings2, Store } from 'lucide-react';
import type { Client } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';
import { useClientMarketplace } from './useClientMarketplace';
import { Alert, Badge, Button, Field, Switch } from '../../components/ui';
import { INPUT_BASE } from '../../components/clients/clientUtils';

const MarketplaceCard: React.FC<{ client: Client; channel: typeof MARKETPLACES[number]; templates: SpreadsheetTemplate[] }> = ({ client, channel, templates }) => {
  const state = useClientMarketplace(client, channel.id);
  const [open, setOpen] = useState(false);
  const disabled = state.saving || client.status === 'archived';
  const activeTemplates = templates.filter(t => t.status !== 'archived').length;
  return <article className="tuto-marketplace" data-enabled={state.enabled}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="tuto-avatar tuto-avatar--lg" aria-hidden="true"><Store /></span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{channel.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={state.enabled ? 'success' : 'neutral'} dot>{state.enabled ? 'Habilitado administrativamente' : 'Deshabilitado administrativamente'}</Badge>
            {state.enabled ? <Badge tone={activeTemplates ? 'accent' : 'warning'}>{activeTemplates} {activeTemplates === 1 ? 'plantilla' : 'plantillas'}</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon={Settings2} aria-expanded={open} aria-controls={`config-${channel.id}`} onClick={() => setOpen(!open)}>Configurar</Button>
        <Switch label={`Habilitar ${channel.name} administrativamente`} checked={state.enabled} disabled={disabled} onCheckedChange={enabled => void state.save({ enabled })} />
      </div>
    </div>
    <p className="mt-3 text-xs text-[var(--color-text-muted)]">Exportación mediante plantillas oficiales Excel del cliente.</p>
    <div hidden={!open} id={`config-${channel.id}`} className="mt-4 rounded-lg border border-slate-200 bg-[var(--color-bg-elevated)] p-4">
      <fieldset disabled={disabled} className="tuto-form-grid tuto-form-grid--2">
        <Field label="País o región"><input className={INPUT_BASE} maxLength={80} value={state.value.region} onChange={e => state.setValue({ ...state.value, region: e.target.value })} /></Field>
        <Field label="Identificador de vendedor"><input className={INPUT_BASE} maxLength={200} value={state.value.sellerId} onChange={e => state.setValue({ ...state.value, sellerId: e.target.value })} /></Field>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" disabled={disabled || !state.dirty} onClick={() => void state.save({ settings: state.value })}>Guardar ajustes de {channel.name}</Button>{state.dirty && <><span className="text-xs text-[var(--color-warning)]">Cambios sin guardar · borrador conservado en esta sesión</span><Button size="sm" variant="ghost" onClick={state.discard}>Descartar borrador de {channel.name}</Button></>}</div>
    </div>
    {state.enabled && <MarketplaceTemplates client={client} channel={channel.id} templates={templates} />}
    {state.conflict && <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-[var(--color-warning-soft)] p-3 text-sm"><p>Valores actuales: región {state.conflict.region || '(vacía)'} · vendedor {state.conflict.sellerId || '(vacío)'} · {state.conflict.enabled ? 'habilitado' : 'deshabilitado'}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={state.keepDraft}>Conservar mi borrador y revisar antes de guardar</Button><Button size="sm" variant="ghost" onClick={state.discard}>Usar valores actuales</Button></div></div>}
    <div aria-live="polite" className="mt-2 text-xs">{state.saving ? <span className="text-[var(--color-text-muted)]">Guardando…</span> : state.error ? <p role="alert" className="text-[var(--color-danger)]">{state.error}</p> : state.saved ? <p className="text-[var(--color-success)]">Guardado</p> : null}</div>
  </article>;
};
export const ClientMarketplaces = ({ client }: { client: Client }) => {
  const { templates, error } = useMarketplaceTemplates(client.id!);
  return <div className="space-y-4"><Alert tone="info">Habilita destinos y configura sus plantillas oficiales. Los Excel se generan desde el Catálogo únicamente al descargar; no se publica nada automáticamente.</Alert>{error && <Alert tone="danger">{error}</Alert>}<div className="grid gap-4 xl:grid-cols-2">{MARKETPLACES.map(channel => <MarketplaceCard key={channel.id} client={client} channel={channel} templates={templates.filter(t => t.exportConfig?.marketplaceId === channel.id)} />)}</div><LegacyMarketplaceTemplates client={client} templates={templates.filter(t => !t.exportConfig && t.status !== 'archived')} /></div>;
};
