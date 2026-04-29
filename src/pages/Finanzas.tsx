import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, RefreshCw, Save, WalletCards } from 'lucide-react';
import { Button, EmptyState, LoadingBlock, PageHeader } from '../components/ui';
import {
  Client,
  FinanceBillingMode,
  FinanceCurrency,
  FinanceEventCategory,
  FinanceEventType,
  UpsertFinanceClientPricingRequest,
} from '../../shared/src/types';
import { subscribeToClients } from '../features/clients/firebase';
import {
  createFinanceManualEvent,
  rebuildFinanceSnapshots,
  updateFinanceSettings,
  upsertFinanceClientPricing,
} from '../features/finance/firebase';
import { getCurrentFinancePeriod, useFinanceDashboard } from '../features/finance/useFinanceDashboard';
import { formatFinanceMoney, formatFinancePct } from '../components/finance/financeFormat';
import { useToast } from '../features/feedback/FeedbackProvider';

const billingModeLabels: Record<FinanceBillingMode, string> = {
  approved_outputs: 'Por output aprobado',
  generated_outputs: 'Por output generado',
  batch: 'Por lote',
  retainer_plus_usage: 'Retainer + uso',
};

const numberInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const Finanzas: React.FC = () => {
  const toast = useToast();
  const [period, setPeriod] = useState(getCurrentFinancePeriod());
  const [currencyView, setCurrencyView] = useState<FinanceCurrency>('MXN');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [savingManualEvent, setSavingManualEvent] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const { data, loading, error, refresh } = useFinanceDashboard(period, selectedClientId || null);

  const [settingsForm, setSettingsForm] = useState({
    defaultFxRateUsdMxn: '18.5',
    humanCostPerInterventionMxn: '12',
  });
  const [pricingForm, setPricingForm] = useState({
    clientId: '',
    billingMode: 'approved_outputs' as FinanceBillingMode,
    currency: 'MXN' as FinanceCurrency,
    pricePerApprovedOutput: '0',
    pricePerGeneratedOutput: '0',
    pricePerBatch: '0',
    monthlyRetainer: '0',
    minimumMonthly: '0',
    notes: '',
  });
  const [manualEventForm, setManualEventForm] = useState({
    type: 'revenue' as FinanceEventType,
    category: 'invoiced_revenue' as FinanceEventCategory,
    description: '',
    amount: '',
    currency: 'MXN' as FinanceCurrency,
    clientId: '',
  });

  useEffect(() => subscribeToClients(setClients, () => undefined, { includeArchived: true }), []);

  useEffect(() => {
    if (!data?.settings) return;
    setSettingsForm({
      defaultFxRateUsdMxn: String(data.settings.defaultFxRateUsdMxn),
      humanCostPerInterventionMxn: String(data.settings.humanCostPerInterventionMxn),
    });
  }, [data?.settings]);

  useEffect(() => {
    const pricing = data?.pricing.find((entry) => entry.clientId === pricingForm.clientId);
    if (!pricing) return;
    setPricingForm((current) => ({
      ...current,
      billingMode: pricing.billingMode,
      currency: pricing.currency,
      pricePerApprovedOutput: String(pricing.pricePerApprovedOutput || 0),
      pricePerGeneratedOutput: String(pricing.pricePerGeneratedOutput || 0),
      pricePerBatch: String(pricing.pricePerBatch || 0),
      monthlyRetainer: String(pricing.monthlyRetainer || 0),
      minimumMonthly: String(pricing.minimumMonthly || 0),
      notes: pricing.notes || '',
    }));
  }, [data?.pricing, pricingForm.clientId]);

  const summary = data?.summary;
  const money = (mxn: number, usd: number) => formatFinanceMoney(currencyView === 'MXN' ? mxn : usd, currencyView);
  const visibleClients = useMemo(() => clients.sort((a, b) => a.name.localeCompare(b.name, 'es')), [clients]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await updateFinanceSettings({
        reportingCurrency: 'MXN',
        secondaryCurrency: 'USD',
        defaultFxRateUsdMxn: numberInput(settingsForm.defaultFxRateUsdMxn),
        humanCostPerInterventionMxn: numberInput(settingsForm.humanCostPerInterventionMxn),
      });
      await refresh();
      toast({ tone: 'success', title: 'Finanzas actualizado', description: 'La configuración financiera quedó guardada.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: err?.message || 'Revisa los valores.' });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSavePricing = async () => {
    if (!pricingForm.clientId) return;
    setSavingPricing(true);
    try {
      const payload: UpsertFinanceClientPricingRequest = {
        clientId: pricingForm.clientId,
        billingMode: pricingForm.billingMode,
        currency: pricingForm.currency,
        pricePerApprovedOutput: numberInput(pricingForm.pricePerApprovedOutput),
        pricePerGeneratedOutput: numberInput(pricingForm.pricePerGeneratedOutput),
        pricePerBatch: numberInput(pricingForm.pricePerBatch),
        monthlyRetainer: numberInput(pricingForm.monthlyRetainer),
        minimumMonthly: numberInput(pricingForm.minimumMonthly),
        active: true,
        notes: pricingForm.notes,
      };
      await upsertFinanceClientPricing(payload);
      await refresh();
      toast({ tone: 'success', title: 'Pricing guardado', description: 'Las tarifas del cliente quedaron listas para cierres y backfill.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo guardar pricing', description: err?.message || 'Revisa los valores.' });
    } finally {
      setSavingPricing(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const result = await rebuildFinanceSnapshots({ period });
      await refresh();
      toast({
        tone: 'success',
        title: 'Backfill financiero terminado',
        description: `${result.eventsCreated} eventos creados, ${result.skippedEvents} ya existían.`,
      });
    } catch (err: any) {
      toast({ tone: 'error', title: 'Backfill falló', description: err?.message || 'Revisa Functions logs.' });
    } finally {
      setBackfilling(false);
    }
  };

  const handleCreateManualEvent = async () => {
    setSavingManualEvent(true);
    try {
      await createFinanceManualEvent({
        type: manualEventForm.type,
        category: manualEventForm.category,
        description: manualEventForm.description,
        amount: numberInput(manualEventForm.amount),
        currency: manualEventForm.currency,
        period,
        clientId: manualEventForm.clientId || null,
      });
      setManualEventForm((current) => ({ ...current, description: '', amount: '' }));
      await refresh();
      toast({ tone: 'success', title: 'Evento financiero registrado', description: 'El ledger y snapshots quedaron actualizados.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo registrar', description: err?.message || 'Revisa los datos del evento.' });
    } finally {
      setSavingManualEvent(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title="Finanzas"
          description="Rentabilidad por cliente, lote, job, modelo y proveedor. Reporte principal en MXN con equivalencia USD."
          icon={WalletCards}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <select
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="">Todos los clientes</option>
            {visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setCurrencyView((current) => current === 'MXN' ? 'USD' : 'MXN')}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
          >
            Ver en {currencyView === 'MXN' ? 'USD' : 'MXN'}
          </button>
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={refresh}>Actualizar</Button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading ? <LoadingBlock message="Cargando finanzas..." /> : !data ? (
        <EmptyState title="Sin datos financieros" description="Ejecuta un backfill o espera a que nuevos jobs generen eventos financieros." icon={<Calculator className="h-6 w-6" />} />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FinanceCard label="Ingresos" value={money(summary?.revenueMxn || 0, summary?.revenueUsd || 0)} />
            <FinanceCard label="Costo variable" value={money(summary?.variableCostMxn || 0, summary?.variableCostUsd || 0)} />
            <FinanceCard label="Costo humano" value={money(summary?.humanCostMxn || 0, summary?.humanCostUsd || 0)} />
            <FinanceCard
              label="Utilidad bruta"
              value={money(summary?.grossProfitMxn || 0, summary?.grossProfitUsd || 0)}
              detail={`Margen ${formatFinancePct(summary?.grossProfitMxn || 0, summary?.revenueMxn || 0)}`}
              tone={(summary?.grossProfitMxn || 0) < 0 ? 'bad' : 'good'}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Panel title="Rentabilidad por cliente">
              <FinanceTable
                headers={["Cliente", "Ingresos", "Costos", "Utilidad", "Margen"]}
                rows={data.clients.map((row) => [
                  row.clientNameSnapshot,
                  money(row.revenueMxn, row.revenueUsd),
                  money(row.variableCostMxn + row.humanCostMxn + row.allocatedFixedCostMxn, row.variableCostUsd + row.humanCostUsd + row.allocatedFixedCostUsd),
                  money(row.grossProfitMxn, row.grossProfitUsd),
                  formatFinancePct(row.grossProfitMxn, row.revenueMxn),
                ])}
              />
            </Panel>

            <Panel title="Configuración financiera">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="FX USD/MXN" value={settingsForm.defaultFxRateUsdMxn} onChange={(v) => setSettingsForm((f) => ({ ...f, defaultFxRateUsdMxn: v }))} />
                <Field label="Costo humano por intervención (MXN)" value={settingsForm.humanCostPerInterventionMxn} onChange={(v) => setSettingsForm((f) => ({ ...f, humanCostPerInterventionMxn: v }))} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button icon={Save} loading={savingSettings} onClick={handleSaveSettings}>Guardar configuración</Button>
                <Button variant="secondary" icon={RefreshCw} loading={backfilling} onClick={handleBackfill}>Backfill {period}</Button>
              </div>
            </Panel>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Pricing por cliente">
              <div className="space-y-3">
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={pricingForm.clientId} onChange={(e) => setPricingForm((f) => ({ ...f, clientId: e.target.value }))}>
                  <option value="">Selecciona cliente</option>
                  {visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={pricingForm.billingMode} onChange={(e) => setPricingForm((f) => ({ ...f, billingMode: e.target.value as FinanceBillingMode }))}>
                    {Object.entries(billingModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={pricingForm.currency} onChange={(e) => setPricingForm((f) => ({ ...f, currency: e.target.value as FinanceCurrency }))}>
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                  <Field label="Precio por aprobado" value={pricingForm.pricePerApprovedOutput} onChange={(v) => setPricingForm((f) => ({ ...f, pricePerApprovedOutput: v }))} />
                  <Field label="Precio por generado" value={pricingForm.pricePerGeneratedOutput} onChange={(v) => setPricingForm((f) => ({ ...f, pricePerGeneratedOutput: v }))} />
                  <Field label="Precio por lote" value={pricingForm.pricePerBatch} onChange={(v) => setPricingForm((f) => ({ ...f, pricePerBatch: v }))} />
                  <Field label="Retainer mensual" value={pricingForm.monthlyRetainer} onChange={(v) => setPricingForm((f) => ({ ...f, monthlyRetainer: v }))} />
                </div>
                <textarea className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" rows={3} placeholder="Notas" value={pricingForm.notes} onChange={(e) => setPricingForm((f) => ({ ...f, notes: e.target.value }))} />
                <Button icon={Save} loading={savingPricing} disabled={!pricingForm.clientId} onClick={handleSavePricing}>Guardar pricing</Button>
              </div>
            </Panel>

            <Panel title="Lotes con menor utilidad">
              <FinanceTable
                headers={["Batch", "Cliente", "Ingresos", "Costos", "Utilidad"]}
                rows={data.batches.map((row) => [
                  row.batchId.slice(0, 8),
                  row.clientNameSnapshot,
                  money(row.revenueMxn, row.revenueUsd),
                  money(row.variableCostMxn + row.humanCostMxn + row.allocatedFixedCostMxn, row.variableCostUsd + row.humanCostUsd + row.allocatedFixedCostUsd),
                  money(row.grossProfitMxn, row.grossProfitUsd),
                ])}
              />
            </Panel>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Ingreso facturado, costo fijo o ajuste manual">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={manualEventForm.type} onChange={(e) => setManualEventForm((f) => ({ ...f, type: e.target.value as FinanceEventType }))}>
                    <option value="revenue">Ingreso</option>
                    <option value="cost">Costo</option>
                    <option value="adjustment">Ajuste</option>
                  </select>
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={manualEventForm.category} onChange={(e) => setManualEventForm((f) => ({ ...f, category: e.target.value as FinanceEventCategory }))}>
                    <option value="invoiced_revenue">Ingreso facturado</option>
                    <option value="estimated_revenue">Ingreso estimado</option>
                    <option value="fixed_cost_allocation">Costo fijo prorrateado</option>
                    <option value="human_operation">Costo humano</option>
                    <option value="manual_adjustment">Ajuste manual</option>
                  </select>
                  <Field label="Monto" value={manualEventForm.amount} onChange={(v) => setManualEventForm((f) => ({ ...f, amount: v }))} />
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={manualEventForm.currency} onChange={(e) => setManualEventForm((f) => ({ ...f, currency: e.target.value as FinanceCurrency }))}>
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={manualEventForm.clientId} onChange={(e) => setManualEventForm((f) => ({ ...f, clientId: e.target.value }))}>
                  <option value="">Sin cliente específico</option>
                  {visibleClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Descripción contable" value={manualEventForm.description} onChange={(e) => setManualEventForm((f) => ({ ...f, description: e.target.value }))} />
                <Button icon={Save} loading={savingManualEvent} disabled={!manualEventForm.description || !manualEventForm.amount} onClick={handleCreateManualEvent}>Registrar evento</Button>
              </div>
            </Panel>

            <Panel title="Modelos">
              <FinanceTable headers={["Modelo", "Costo", "Utilidad"]} rows={data.models.map((row) => [row.modelNameSnapshot, money(row.variableCostMxn + row.humanCostMxn, row.variableCostUsd + row.humanCostUsd), money(row.grossProfitMxn, row.grossProfitUsd)])} />
            </Panel>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Panel title="Proveedores">
              <FinanceTable headers={["Proveedor", "Costo", "Utilidad"]} rows={data.providers.map((row) => [String(row.provider), money(row.variableCostMxn, row.variableCostUsd), money(row.grossProfitMxn, row.grossProfitUsd)])} />
            </Panel>
            <Panel title="Eventos recientes">
              <FinanceTable headers={["Tipo", "Categoría", "Monto", "Origen"]} rows={data.recentEvents.map((event) => [event.type, event.category, money(event.money.amountMxn, event.money.amountUsd), event.sourceCollection])} />
            </Panel>
          </section>
        </>
      )}
    </div>
  );
};

const FinanceCard: React.FC<{ label: string; value: string; detail?: string; tone?: 'good' | 'bad' }> = ({ label, value, detail, tone }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-sm text-slate-500">{label}</p>
    <p className={`mt-2 text-2xl font-semibold ${tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-950'}`}>{value}</p>
    {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
  </div>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
    {children}
  </div>
);

const Field: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({ label, value, onChange }) => (
  <label className="block text-sm">
    <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
    <input type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
  </label>
);

const FinanceTable: React.FC<{ headers: string[]; rows: Array<Array<string | number>> }> = ({ headers, rows }) => (
  <div className="overflow-x-auto">
    {rows.length === 0 ? (
      <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">Sin datos para este periodo.</p>
    ) : (
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>{headers.map((header) => <th key={header} className="border-b border-slate-100 py-2 pr-4 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="py-2 pr-4 text-slate-700">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);
