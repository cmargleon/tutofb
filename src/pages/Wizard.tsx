import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, LoadingBlock, EmptyState, ImageThumb } from '../components/ui';
import { WizardStepper } from '../components/WizardStepper';
import { WizardState, UploadedGarmentDraft } from '../features/generate/types';
import { subscribeToClients } from '../features/clients/firebase';
import { subscribeToModels } from '../features/models/firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../features/generate/garments';
import { uploadGarmentDraft, deleteGarmentDrafts } from '../features/generate/storage';
import { createGenerationBatch } from '../features/generate/firebase';
import { Client, Model, Pose, Provider } from '../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import { UploadCloud, FolderUp, X, Check, AlertCircle } from 'lucide-react';

const STEPS = [
  { id: 1, name: 'Cliente y Modelo' },
  { id: 2, name: 'Prendas' },
  { id: 3, name: 'Configuración' }
];

export const Wizard: React.FC = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>({
    step: 1,
    selectedClientId: null,
    selectedModelId: null,
    selectedPoseIds: [],
    garments: [],
    provider: 'fal-seedream',
    prompt: '',
    aspectRatio: '3:4',
    backgroundConfig: { type: 'studio' }
  });

  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubClients = subscribeToClients(
      (data) => {
        setClients(data);
        setLoadingData(false);
      },
      (err) => {
        console.error(err);
        setError('Error al cargar clientes');
        setLoadingData(false);
      }
    );
    return () => unsubClients();
  }, []);

  useEffect(() => {
    if (state.selectedClientId) {
      const unsubModels = subscribeToModels(
        (data) => {
          setModels(data.filter(m => m.clientId === state.selectedClientId));
        },
        (err) => {
          console.error(err);
          setError('Error al cargar modelos');
        }
      );
      return () => unsubModels();
    } else {
      setModels([]);
    }
  }, [state.selectedClientId]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      revokeGarmentUrls(state.garments);
    };
  }, [state.garments]);

  const handleNext = () => setState(s => ({ ...s, step: s.step + 1 }));
  const handleBack = () => setState(s => ({ ...s, step: s.step - 1 }));

  const handleSubmit = async () => {
    if (!state.selectedClientId || !state.selectedModelId || state.selectedPoseIds.length === 0 || state.garments.length === 0) {
      setError('Faltan datos requeridos');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const draftBatchId = uuidv4();
    const uploadedGarments = [];

    try {
      // 1. Upload garments
      for (const garment of state.garments) {
        const storagePath = await uploadGarmentDraft(draftBatchId, garment);
        uploadedGarments.push({
          id: garment.id,
          name: garment.name,
          storagePath,
          isMultiAngle: garment.isMultiAngle
        });
      }

      // 2. Call Cloud Function
      const result = await createGenerationBatch({
        clientId: state.selectedClientId,
        modelId: state.selectedModelId,
        poseIds: state.selectedPoseIds,
        garments: uploadedGarments,
        provider: state.provider,
        promptBase: state.prompt,
        aspectRatio: state.aspectRatio,
        backgroundConfig: state.backgroundConfig
      });

      // 3. Navigate to evaluation
      navigate(`/evaluacion?batchId=${result.batchId}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al crear el lote de generación');
      // Cleanup uploaded drafts
      await deleteGarmentDrafts(draftBatchId, state.garments);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStep1 = () => {
    const selectedModel = models.find(m => m.id === state.selectedModelId);

    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
          <select
            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={state.selectedClientId || ''}
            onChange={(e) => setState(s => ({ ...s, selectedClientId: e.target.value, selectedModelId: null, selectedPoseIds: [] }))}
          >
            <option value="">Selecciona un cliente</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {state.selectedClientId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
            <select
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
              value={state.selectedModelId || ''}
              onChange={(e) => setState(s => ({ ...s, selectedModelId: e.target.value, selectedPoseIds: [] }))}
            >
              <option value="">Selecciona un modelo</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        {selectedModel && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Poses ({state.selectedPoseIds.length} seleccionadas)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {selectedModel.poses.map(pose => {
                const isSelected = state.selectedPoseIds.includes(pose.id);
                return (
                  <div 
                    key={pose.id}
                    onClick={() => {
                      setState(s => ({
                        ...s,
                        selectedPoseIds: isSelected 
                          ? s.selectedPoseIds.filter(id => id !== pose.id)
                          : [...s.selectedPoseIds, pose.id]
                      }));
                    }}
                    className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all aspect-[3/4] ${isSelected ? 'border-indigo-600 ring-2 ring-indigo-600 ring-opacity-50' : 'border-transparent hover:border-gray-300'}`}
                  >
                    <ImageThumb storagePath={pose.storagePath} alt={pose.fileName} />
                    {isSelected && (
                      <div className="absolute top-2 right-2 bg-indigo-600 text-white rounded-full p-1">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStep2 = () => {
    const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return;
      const files = Array.from(e.target.files) as File[];
      const newGarments = await handleGarmentFiles(files, state.garments);
      setState(s => ({ ...s, garments: newGarments }));
      e.target.value = ''; // Reset input
    };

    return (
      <div className="space-y-6">
        <div className="flex gap-4">
          <label className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 hover:border-indigo-500 cursor-pointer transition-colors">
            <UploadCloud className="w-8 h-8 text-gray-400 mb-2" />
            <span className="text-sm font-medium text-gray-700">Imágenes individuales</span>
            <input type="file" multiple accept="image/*" className="hidden" onChange={handleFiles} />
          </label>
          <label className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 hover:border-indigo-500 cursor-pointer transition-colors">
            <FolderUp className="w-8 h-8 text-gray-400 mb-2" />
            <span className="text-sm font-medium text-gray-700">Carpeta (Multi-ángulo)</span>
            <input type="file" {...{ webkitdirectory: "", directory: "" } as any} className="hidden" onChange={handleFiles} />
          </label>
        </div>

        {state.garments.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {state.garments.map(garment => (
              <div key={garment.id} className="relative group rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm">
                <div className="aspect-square bg-gray-100">
                  <img src={garment.previewUrl} alt={garment.name} className="w-full h-full object-contain" />
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-gray-900 truncate" title={garment.name}>{garment.name}</p>
                  <p className="text-[10px] text-gray-500">{garment.isMultiAngle ? 'Multi-ángulo' : 'Simple'}</p>
                </div>
                <button
                  onClick={() => setState(s => ({ ...s, garments: s.garments.filter(g => g.id !== garment.id) }))}
                  className="absolute top-2 right-2 p-1 bg-white/90 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-red-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin prendas" description="Sube imágenes o carpetas para comenzar" icon={<UploadCloud />} />
        )}
      </div>
    );
  };

  const renderStep3 = () => {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor de IA</label>
          <select
            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={state.provider}
            onChange={(e) => setState(s => ({ ...s, provider: e.target.value as Provider }))}
          >
            <option value="fal-seedream">FAL - Seedream</option>
            <option value="fal-banana-pro">FAL - Banana Pro</option>
            <option value="openai-gpt-image-1.5">OpenAI - GPT Image 1.5</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Relación de aspecto</label>
          <select
            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={state.aspectRatio}
            onChange={(e) => setState(s => ({ ...s, aspectRatio: e.target.value }))}
          >
            <option value="3:4">3:4 (Catálogo)</option>
            <option value="9:16">9:16 (Stories/Reels)</option>
            <option value="1:1">1:1 (Cuadrado)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fondo</label>
          <select
            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            value={state.backgroundConfig.type}
            onChange={(e) => setState(s => ({ ...s, backgroundConfig: { ...s.backgroundConfig, type: e.target.value as any } }))}
          >
            <option value="studio">Estudio (Fondo neutro)</option>
            <option value="outdoor">Exterior (Calle, naturaleza)</option>
            <option value="custom">Personalizado</option>
            <option value="none">Sin fondo (Transparente/Blanco)</option>
          </select>
        </div>

        {state.backgroundConfig.type === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción del fondo</label>
            <input
              type="text"
              className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Ej: Calle de París, atardecer en la playa..."
              value={state.backgroundConfig.description || ''}
              onChange={(e) => setState(s => ({ ...s, backgroundConfig: { ...s.backgroundConfig, description: e.target.value } }))}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prompt Base (Opcional)</label>
          <textarea
            className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            rows={4}
            placeholder="Ej: Fotografía de estudio, iluminación suave..."
            value={state.prompt}
            onChange={(e) => setState(s => ({ ...s, prompt: e.target.value }))}
          />
          <p className="mt-1 text-xs text-gray-500">Este prompt se combinará con la descripción de la prenda y el modelo.</p>
        </div>
      </div>
    );
  };

  if (loadingData) return <LoadingBlock />;

  const canProceed = () => {
    if (state.step === 1) return state.selectedClientId && state.selectedModelId && state.selectedPoseIds.length > 0;
    if (state.step === 2) return state.garments.length > 0;
    return true;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Generar Imágenes" description="Crea un nuevo lote de generación" />

      <WizardStepper steps={STEPS} currentStep={state.step} />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        {state.step === 1 && renderStep1()}
        {state.step === 2 && renderStep2()}
        {state.step === 3 && renderStep3()}

        <div className="mt-8 pt-6 border-t border-gray-100 flex justify-between">
          <button
            onClick={handleBack}
            disabled={state.step === 1 || isSubmitting}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Atrás
          </button>
          
          {state.step < 3 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generando...
                </>
              ) : (
                'Iniciar Generación'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
