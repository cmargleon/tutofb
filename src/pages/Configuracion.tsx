import React, { useEffect, useState } from 'react';
import { Bell, Settings, Sliders, Cpu, ToggleLeft, FileText } from 'lucide-react';
import { PageHeader, LoadingBlock } from '../components/ui';
import { useSystemHealth } from '../features/system/useSystemHealth';
import { updateSystemAlertSettings as saveSystemAlertSettings, updateSystemConfig } from '../features/system/firebase';
import { useSystemConfig } from '../features/system/useSystemConfig';
import { useRole } from '../features/auth/AuthProvider';
import { useToast } from '../features/feedback/FeedbackProvider';
import { Provider } from '../../shared/src/types';
import { DEFAULT_TRY_ON_PROMPT, DEFAULT_TRY_ON_PROMPT_CASES } from '../../shared/src/domain';

const KNOWN_PROVIDERS: Provider[] = ['fal-seedream', 'fal-banana-pro', 'openai-gpt-image-1.5', 'fal-nano-banana-2', 'fal-seedream-5'];
const PROVIDER_DISPLAY: Record<Provider, string> = {
  'fal-seedream': 'Fal Seedream v4',
  'fal-banana-pro': 'Fal Nano Banana Pro',
  'openai-gpt-image-1.5': 'OpenAI GPT Image 1.5',
  'fal-nano-banana-2': 'Fal Nano Banana 2',
  'fal-seedream-5': 'Fal Seedream 5 Lite',
};
const KNOWN_GEMINI_MODELS = [
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (recomendado)' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

export const Configuracion: React.FC = () => {
  const role = useRole();
  const toast = useToast();

  // --- Section 1: Alert settings ---
  const [alertForm, setAlertForm] = useState({
    dailyCostUsdThreshold: '',
    recentErrorRateThreshold: '10',
    pendingJobsThreshold: '25',
    staleProcessingJobsThreshold: '1',
  });

  const {
    data: systemHealth,
    loading: systemHealthLoading,
    error: systemHealthError,
    refresh: refreshSystemHealth,
  } = useSystemHealth(role.canAccessAnalytics);

  useEffect(() => {
    if (!systemHealth?.settings) return;
    setAlertForm({
      dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
      recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
      pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
      staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
    });
  }, [systemHealth?.settings]);

  const handleSaveAlerts = async () => {
    try {
      await saveSystemAlertSettings({
        dailyCostUsdThreshold: alertForm.dailyCostUsdThreshold.trim()
          ? parseFloat(alertForm.dailyCostUsdThreshold)
          : null,
        recentErrorRateThreshold: parseFloat(alertForm.recentErrorRateThreshold),
        pendingJobsThreshold: parseInt(alertForm.pendingJobsThreshold, 10),
        staleProcessingJobsThreshold: parseInt(alertForm.staleProcessingJobsThreshold, 10),
      });
      await refreshSystemHealth();
      toast({
        tone: 'success',
        title: 'Configuración guardada',
        description: 'Los umbrales quedan aplicados para todo el equipo.',
      });
    } catch (err: any) {
      toast({
        tone: 'error',
        title: 'No se pudo guardar',
        description: err?.message || 'Revisa los valores e inténtalo nuevamente.',
      });
    }
  };

  const handleResetAlerts = () => {
    if (!systemHealth?.settings) return;
    setAlertForm({
      dailyCostUsdThreshold: systemHealth.settings.dailyCostUsdThreshold?.toString() || '',
      recentErrorRateThreshold: String(systemHealth.settings.recentErrorRateThreshold),
      pendingJobsThreshold: String(systemHealth.settings.pendingJobsThreshold),
      staleProcessingJobsThreshold: String(systemHealth.settings.staleProcessingJobsThreshold),
    });
  };

  // --- Sections 2-5: System config ---
  const { config: systemConfig, loading: systemConfigLoading } = useSystemConfig();

  const [queueForm, setQueueForm] = useState({
    jobMaxRetries: '3',
    jobRetryDelayMin: '5',
    batchMaxJobs: '100',
  });

  const [geminiModel, setGeminiModel] = useState('gemini-3.1-flash-lite-preview');
  const [customGeminiModel, setCustomGeminiModel] = useState('');
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptFullOutfit, setSystemPromptFullOutfit] = useState('');
  const [systemPromptTopOnly, setSystemPromptTopOnly] = useState('');
  const [systemPromptBottomOnly, setSystemPromptBottomOnly] = useState('');

  // Sync form state when systemConfig loads
  useEffect(() => {
    if (systemConfigLoading) return;
    setQueueForm({
      jobMaxRetries: String(systemConfig.jobMaxRetries),
      jobRetryDelayMin: String(Math.round(systemConfig.jobRetryDelayMs / 60000)),
      batchMaxJobs: String(systemConfig.batchMaxJobs),
    });
    const isKnownModel = KNOWN_GEMINI_MODELS.some((m) => m.value === systemConfig.geminiImageReviewModel);
    if (isKnownModel) {
      setGeminiModel(systemConfig.geminiImageReviewModel);
      setCustomGeminiModel('');
    } else {
      setGeminiModel('custom');
      setCustomGeminiModel(systemConfig.geminiImageReviewModel);
    }
    setDisabledProviders(systemConfig.disabledProviders);
    setSystemPrompt(systemConfig.systemPromptOverride ?? DEFAULT_TRY_ON_PROMPT);
    setSystemPromptFullOutfit(systemConfig.systemPromptFullOutfit ?? DEFAULT_TRY_ON_PROMPT_CASES.full_outfit);
    setSystemPromptTopOnly(systemConfig.systemPromptTopOnly ?? DEFAULT_TRY_ON_PROMPT_CASES.top_only);
    setSystemPromptBottomOnly(systemConfig.systemPromptBottomOnly ?? DEFAULT_TRY_ON_PROMPT_CASES.bottom_only);
  }, [systemConfigLoading, systemConfig]);

  const saveSystemConfigSection = async (patch: Parameters<typeof updateSystemConfig>[0]) => {
    try {
      await updateSystemConfig(patch);
      toast({ tone: 'success', title: 'Configuración guardada', description: 'Cambios aplicados.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: err?.message || 'Inténtalo nuevamente.' });
    }
  };

  const handleSaveQueue = () => {
    void saveSystemConfigSection({
      jobMaxRetries: parseInt(queueForm.jobMaxRetries, 10),
      jobRetryDelayMs: parseInt(queueForm.jobRetryDelayMin, 10) * 60000,
      batchMaxJobs: parseInt(queueForm.batchMaxJobs, 10),
    });
  };

  const handleSaveGeminiModel = () => {
    const modelValue = geminiModel === 'custom' ? customGeminiModel.trim() : geminiModel;
    if (!modelValue) return;
    void saveSystemConfigSection({ geminiImageReviewModel: modelValue });
  };

  const handleToggleProvider = (provider: string) => {
    const next = disabledProviders.includes(provider)
      ? disabledProviders.filter((p) => p !== provider)
      : [...disabledProviders, provider];
    setDisabledProviders(next);
    void saveSystemConfigSection({ disabledProviders: next });
  };

  const handleSaveSystemPrompt = () => {
    const trimmedPrompt = systemPrompt.trim();
    const trimmedFullOutfitPrompt = systemPromptFullOutfit.trim();
    const trimmedTopOnlyPrompt = systemPromptTopOnly.trim();
    const trimmedBottomOnlyPrompt = systemPromptBottomOnly.trim();
    void saveSystemConfigSection({
      systemPromptOverride:
        !trimmedPrompt || trimmedPrompt === DEFAULT_TRY_ON_PROMPT.trim() ? null : trimmedPrompt,
      systemPromptFullOutfit:
        !trimmedFullOutfitPrompt || trimmedFullOutfitPrompt === DEFAULT_TRY_ON_PROMPT_CASES.full_outfit.trim()
          ? null
          : trimmedFullOutfitPrompt,
      systemPromptTopOnly:
        !trimmedTopOnlyPrompt || trimmedTopOnlyPrompt === DEFAULT_TRY_ON_PROMPT_CASES.top_only.trim()
          ? null
          : trimmedTopOnlyPrompt,
      systemPromptBottomOnly:
        !trimmedBottomOnlyPrompt || trimmedBottomOnlyPrompt === DEFAULT_TRY_ON_PROMPT_CASES.bottom_only.trim()
          ? null
          : trimmedBottomOnlyPrompt,
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        title="Configuración"
        description="Ajustes del sistema compartidos con todo el equipo."
        icon={Settings}
      />

      {/* Section 1: Alert thresholds */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Bell className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-semibold text-slate-900">Alertas del sistema</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Umbrales compartidos para todo el equipo.{' '}
          {role.canManageUsers
            ? 'Solo los administradores pueden modificarlos.'
            : 'Estás viendo los valores actuales (solo lectura).'}
        </p>

        {systemHealthLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : systemHealthError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {systemHealthError}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <AlertField
                label="Límite de gasto diario (USD)"
                description="Genera una alerta si el gasto del día supera este monto."
                prefix="$"
                value={alertForm.dailyCostUsdThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, dailyCostUsdThreshold: v }))}
                disabled={!role.canManageUsers}
                placeholder="Sin límite"
              />
              <AlertField
                label="Tasa de errores recientes (%)"
                description="Alerta si el porcentaje de trabajos fallidos supera este umbral."
                value={alertForm.recentErrorRateThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, recentErrorRateThreshold: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Trabajos pendientes máximos"
                description="Alerta si hay más trabajos en cola que este número."
                value={alertForm.pendingJobsThreshold}
                onChange={(v) => setAlertForm((f) => ({ ...f, pendingJobsThreshold: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Trabajos atascados máximos"
                description="Alerta si hay trabajos en proceso que llevan demasiado tiempo sin avanzar."
                value={alertForm.staleProcessingJobsThreshold}
                onChange={(v) =>
                  setAlertForm((f) => ({ ...f, staleProcessingJobsThreshold: v }))
                }
                disabled={!role.canManageUsers}
              />
            </div>

            {role.canManageUsers ? (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  onClick={() => void handleSaveAlerts()}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Guardar
                </button>
                <button
                  onClick={handleResetAlerts}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  Descartar cambios
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Section 2: Queue parameters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Sliders className="w-5 h-5 text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-900">Parámetros de cola</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Controlan el comportamiento de reintentos y límites de lote.
        </p>
        {systemConfigLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <AlertField
                label="Reintentos por job"
                description="Cuántas veces puede reintentar un job antes de marcarse como fallido."
                value={queueForm.jobMaxRetries}
                onChange={(v) => setQueueForm((f) => ({ ...f, jobMaxRetries: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Espera entre reintentos (min)"
                description="Minutos que espera un job fallido antes de volver a la cola."
                value={queueForm.jobRetryDelayMin}
                onChange={(v) => setQueueForm((f) => ({ ...f, jobRetryDelayMin: v }))}
                disabled={!role.canManageUsers}
              />
              <AlertField
                label="Máximo de jobs por lote"
                description="Límite de imágenes por lote de generación."
                value={queueForm.batchMaxJobs}
                onChange={(v) => setQueueForm((f) => ({ ...f, batchMaxJobs: v }))}
                disabled={!role.canManageUsers}
              />
            </div>
            {role.canManageUsers ? (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  onClick={handleSaveQueue}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Guardar
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Section 3: Gemini model */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Cpu className="w-5 h-5 text-violet-500" />
          <h2 className="text-base font-semibold text-slate-900">Modelo Gemini de revisión</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Modelo que se usa para revisar automáticamente la calidad de las imágenes generadas.
        </p>
        {systemConfigLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Modelo</label>
              <select
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                disabled={!role.canManageUsers}
                className="w-full rounded-xl border border-slate-200 py-2 pl-3 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
              >
                {KNOWN_GEMINI_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                <option value="custom">Personalizado...</option>
              </select>
            </div>
            {geminiModel === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del modelo personalizado</label>
                <input
                  type="text"
                  value={customGeminiModel}
                  onChange={(e) => setCustomGeminiModel(e.target.value)}
                  disabled={!role.canManageUsers}
                  placeholder="ej. gemini-2.0-flash"
                  className="w-full rounded-xl border border-slate-200 py-2 px-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            )}
            {role.canManageUsers ? (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  onClick={handleSaveGeminiModel}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Guardar
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Section 4: Provider toggles */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <ToggleLeft className="w-5 h-5 text-rose-500" />
          <h2 className="text-base font-semibold text-slate-900">Proveedores habilitados</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Los proveedores deshabilitados siguen visibles en generación, modelos y regeneraciones, pero no se pueden seleccionar.
        </p>
        {systemConfigLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : (
          <div className="flex flex-wrap gap-3">
            {KNOWN_PROVIDERS.map((provider) => {
              const isDisabled = disabledProviders.includes(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => role.canManageUsers && handleToggleProvider(provider)}
                  disabled={!role.canManageUsers}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                    isDisabled
                      ? 'border-rose-200 bg-rose-50 text-rose-400 opacity-60'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
                  } disabled:cursor-default`}
                >
                  {PROVIDER_DISPLAY[provider]}
                  {isDisabled && (
                    <span className="rounded-full bg-rose-200 px-2 py-0.5 text-xs text-rose-700">
                      Deshabilitado
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: System prompt */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <FileText className="w-5 h-5 text-slate-500" />
          <h2 className="text-base font-semibold text-slate-900">Prompts globales del wizard</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          El prompt base se usa en el wizard cuando el cliente seleccionado no tiene un prompt propio.
          Los bloques A/B/C se agregan automáticamente al prompt final según el tipo de prenda detectado.
          Si un campo queda igual al valor interno por defecto, se guarda sin override.
        </p>
        {systemConfigLoading ? (
          <LoadingBlock message="Cargando configuración..." />
        ) : (
          <div className="space-y-4">
            <PromptTextarea
              label="Prompt base común"
              rows={12}
              value={systemPrompt}
              onChange={setSystemPrompt}
              disabled={!role.canManageUsers}
              placeholder="Cargando prompt base..."
            />
            <PromptTextarea
              label="Caso A: outfit completo"
              rows={5}
              value={systemPromptFullOutfit}
              onChange={setSystemPromptFullOutfit}
              disabled={!role.canManageUsers}
              placeholder="Reglas para prendas full outfit..."
            />
            <PromptTextarea
              label="Caso B: top only"
              rows={6}
              value={systemPromptTopOnly}
              onChange={setSystemPromptTopOnly}
              disabled={!role.canManageUsers}
              placeholder="Reglas para prendas upper_body..."
            />
            <PromptTextarea
              label="Caso C: bottom only"
              rows={6}
              value={systemPromptBottomOnly}
              onChange={setSystemPromptBottomOnly}
              disabled={!role.canManageUsers}
              placeholder="Reglas para prendas lower_body..."
            />
            {role.canManageUsers ? (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                <button
                  onClick={handleSaveSystemPrompt}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
                >
                  Guardar
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

function PromptTextarea({
  label,
  rows,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400 resize-y"
      />
    </label>
  );
}

function AlertField({
  label,
  description,
  value,
  onChange,
  disabled,
  prefix,
  placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  prefix?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700 mb-0.5">{label}</span>
        <span className="block text-xs text-slate-400 mb-1.5">{description}</span>
        <div className="relative">
          {prefix ? (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
              {prefix}
            </span>
          ) : null}
          <input
            type="number"
            min="0"
            step="0.01"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`w-full rounded-xl border border-slate-200 py-2 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${
              prefix ? 'pl-7' : 'pl-3'
            } ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-800'}`}
          />
        </div>
      </label>
    </div>
  );
}
