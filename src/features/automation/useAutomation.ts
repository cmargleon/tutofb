import { useSystemConfig } from '../system/useSystemConfig';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutomationJob, AutomationJobType, Client, Model, Provider } from '../../../shared/src/types';
import { useAuth, useRole } from '../auth/AuthProvider';
import { useToast } from '../feedback/FeedbackProvider';
import { subscribeToClients } from '../clients/firebase';
import { subscribeToModels } from '../models/firebase';
import { handleGarmentFiles, revokeGarmentUrls } from '../generate/garments';
import { uploadGarmentDrafts } from '../generate/storage';
import { createAutomation, retryAutomation, subscribeToAutomationJobs } from './firebase';

export const useAutomation = (resumeJobId?: string) => {
  const { user, appUser } = useAuth();
  const role = useRole();
  const { config } = useSystemConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [clientId, setClientId] = useState('');
  const [jobType, setJobType] = useState<AutomationJobType>('garment');
  const [modelId, setModelId] = useState('');
  const [preset, setPreset] = useState('');
  const [provider, setProvider] = useState<Provider | ''>('');
  const [files, setFiles] = useState<File[]>([]);
  const [sameItem, setSameItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preserve the submission key and uploads across ambiguous network failures.
  const [submission, setSubmission] = useState<{ externalId: string; inputImages?: import('../../../shared/src/types').AutomationInput[] }>({ externalId: crypto.randomUUID() });
  useEffect(() => subscribeToClients(setClients, (error) => setError(error.message)), []);
  useEffect(() => subscribeToModels(setModels, (error) => setError(error.message)), []);
  useEffect(() => user && subscribeToAutomationJobs(user.uid, appUser?.role === 'admin', setJobs, (error) => setError(error.message)), [user?.uid, appUser?.role]);
  const initializedResume = useRef<string | null>(null);
  useEffect(() => {
    const job = jobs.find((entry) => entry.id === resumeJobId);
    if (!job || initializedResume.current === resumeJobId) return;
    initializedResume.current = resumeJobId!;
    setClientId(job.clientId); setJobType(job.jobType); setModelId(job.modelId || '');
    setPreset(job.requestedPreset || ''); setProvider(job.provider || '');
  }, [resumeJobId, jobs]);
  const changeFiles = (next: File[]) => {
    setFiles(next); setSubmission({ externalId: crypto.randomUUID() });
  };
  const submit = async (resumeJobId?: string) => {
    setBusy(true); setError(null);
    let drafts: Awaited<ReturnType<typeof handleGarmentFiles>> = [];
    try {
      if (resumeJobId && !files.length) {
        const receipt = await retryAutomation({ jobId: resumeJobId, ...(modelId ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}) });
        toast({ tone: 'success', title: 'Reintento encolado', description: receipt.jobId });
        navigate(`/automation?job=${receipt.jobId}`); return;
      }
      let inputImages = submission.inputImages;
      if (!inputImages) {
        if (!files.length || files.length > 40 || files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) throw new Error('Selecciona de 1 a 40 fotografías JPEG, PNG o WebP.');
        drafts = await handleGarmentFiles(files, []);
        if (sameItem) drafts = [{ ...drafts[0], originalPhotos: drafts.flatMap((draft) => draft.originalPhotos), files, isMultiAngle: files.length > 1 }];
        if (drafts.some((draft) => draft.originalPhotos.length > 4)) throw new Error('Cada artículo admite hasta 4 vistas.');
        const upload = await uploadGarmentDrafts(submission.externalId, drafts);
        if (upload.failed.length) throw new Error(upload.failed[0].error);
        inputImages = upload.uploaded.flatMap((entry) => entry.photoUploads.map((photo) => ({
          itemId: entry.garmentId, fileName: drafts.find((draft) => draft.id === entry.garmentId)!.originalPhotos.find((original) => original.id === photo.photoId)!.fileName,
          storagePath: photo.storagePath,
        })));
        setSubmission((current) => ({ ...current, inputImages }));
      }
      const receipt = resumeJobId ? await retryAutomation({ jobId: resumeJobId, ...(modelId ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}), inputImages })
        : await createAutomation({ source: 'manual', externalId: submission.externalId, clientId, jobType,
          ...(modelId && jobType === 'garment' ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}), inputImages });
      toast({ tone: 'success', title: 'Trabajo recibido', description: receipt.jobId });
      changeFiles([]); navigate(`/automation?job=${receipt.jobId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo enviar el trabajo.';
      setError(message); toast({ tone: 'error', title: 'No se pudo enviar', description: message });
    } finally { revokeGarmentUrls(drafts); setBusy(false); }
  };
  const retry = async (job: AutomationJob) => {
    setBusy(true);
    try {
      await retryAutomation({ jobId: job.id, ...(modelId ? { modelId } : {}) });
      toast({ tone: 'success', title: 'Reintento encolado' });
    } catch (error) { toast({ tone: 'error', title: 'No se pudo reintentar', description: error instanceof Error ? error.message : '' }); }
    finally { setBusy(false); }
  };
  return { clients, models, jobs, clientId, setClientId, jobType, setJobType, modelId, setModelId,
    preset, setPreset, provider, setProvider, files, changeFiles, sameItem, setSameItem, busy, error, submit, retry,
    disabledProviders: config.disabledProviders, canCreate: role.canCreateBatches };
};
