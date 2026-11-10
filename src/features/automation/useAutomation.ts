import { saveAs } from 'file-saver';
import type { AutomationPlanSummary } from '../../../shared/src/types';
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
import { prepareAutomationPlan, executeAutomationPlan, resumeAutomationJob, downloadAutomationResults, getAutomationPlan, subscribeToAutomationJob, retryAutomation, subscribeToAutomationJobs } from './firebase';

export const useAutomation = (resumeJobId?: string, selectedJobId?: string) => {
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
  const [selectedJob, setSelectedJob] = useState<AutomationJob | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<AutomationPlanSummary | null>(null);
  const [preparedPlan, setPreparedPlan] = useState<AutomationPlanSummary | null>(null);
  const [budgetUsd, setBudgetUsd] = useState('');
  const [resumeBudgetUsd, setResumeBudgetUsd] = useState('');
  const [allowEstimatedCosts, setAllowEstimatedCosts] = useState(false);
  const [authorizeClassification, setAuthorizeClassification] = useState(false);
  const [inputSource, setInputSource] = useState<'uploads' | 'drive'>('uploads');
  const [driveRows, setDriveRows] = useState<Array<{ itemId: string; fileId: string; folderId: string; revisionId: string }>>([{ itemId: '', fileId: '', folderId: '', revisionId: '' }]);
  const [files, setFiles] = useState<File[]>([]);
  const [sameItem, setSameItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Preserve the submission key and uploads across ambiguous network failures.
  const [submission, setSubmission] = useState<{ externalId: string; inputImages?: import('../../../shared/src/types').AutomationInput[] }>({ externalId: crypto.randomUUID() });
  useEffect(() => subscribeToClients(setClients, (error) => setError(error.message)), []);
  useEffect(() => subscribeToModels(setModels, (error) => setError(error.message)), []);
  useEffect(() => {
    if (!user) return;
    return subscribeToAutomationJobs(user.uid, appUser?.role === 'admin', setJobs, (error) => setError(error.message));
  }, [user?.uid, appUser?.role]);
  useEffect(() => setPreparedPlan(null), [clientId, jobType, modelId, preset, provider, files, budgetUsd, allowEstimatedCosts, authorizeClassification, inputSource, driveRows, sameItem]);
  useEffect(() => {
    setSelectedJob(null);
    if (!selectedJobId) return;
    return subscribeToAutomationJob(selectedJobId, setSelectedJob, (error) => setError(error.message));
  }, [selectedJobId]);
  useEffect(() => {
    setSelectedPlan(null); let active = true;
    if (selectedJob?.planId) void getAutomationPlan(selectedJob.planId).then((plan) => { if (active) setSelectedPlan(plan); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [selectedJob?.planId]);
  const planKeyRef = useRef({ signature: '', externalId: '' });
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
      if (resumeJobId && !files.length && inputSource === 'uploads') {
        const receipt = await retryAutomation({ jobId: resumeJobId, ...(modelId ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}) });
        toast({ tone: 'success', title: 'Reintento encolado', description: receipt.jobId });
        navigate(`/automation?job=${receipt.jobId}`); return;
      }
      let inputImages = inputSource === 'drive' ? driveRows.map((row) => ({ itemId: row.itemId.trim(), fileName: `${row.fileId}.jpg`, driveFile: { folderId: row.folderId, fileId: row.fileId.trim(), ...(row.revisionId ? { revisionId: row.revisionId.trim() } : {}) } })) : submission.inputImages;
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
      if (resumeJobId) {
        const receipt = await retryAutomation({ jobId: resumeJobId, ...(modelId ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}), inputImages });
        toast({ tone: 'success', title: 'Entrada reencolada', description: receipt.jobId }); navigate(`/automation?job=${receipt.jobId}`);
      } else {
        const request = { source: 'manual' as const, externalId: submission.externalId, clientId, jobType,
          ...(modelId && jobType === 'garment' ? { modelId } : {}), ...(preset ? { preset } : {}), ...(provider ? { provider } : {}), inputImages,
          ...(budgetUsd ? { budgetUsd: Number(budgetUsd) } : {}), allowEstimatedCosts, authorizeClassification };
        const signature = JSON.stringify(request);
        if (planKeyRef.current.signature !== signature) planKeyRef.current = { signature, externalId: crypto.randomUUID() };
        const plan = await prepareAutomationPlan({ ...request, externalId: planKeyRef.current.externalId });
        setPreparedPlan(plan);
      }
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
  const execute = async () => {
    if (!preparedPlan) return;
    setBusy(true);
    try { const receipt = await executeAutomationPlan(preparedPlan.planId); changeFiles([]); navigate(`/automation?job=${receipt.jobId}`); toast({ tone: 'success', title: 'Trabajo en ejecución' }); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const resume = async (job: AutomationJob) => {
    setBusy(true);
    try { await resumeAutomationJob({ jobId: job.id, ...(resumeBudgetUsd ? { budgetUsd: Number(resumeBudgetUsd) } : {}) }); toast({ tone: 'success', title: 'Reanudación solicitada' }); }
    catch (error) { toast({ tone: 'error', title: 'No se pudo reanudar', description: (error as Error).message }); }
    finally { setBusy(false); }
  };
  const download = async (job: AutomationJob) => {
    setBusy(true);
    try { saveAs(await downloadAutomationResults(job.id), `automation-${job.id}.zip`); }
    catch (error) { toast({ tone: 'error', title: 'No se pudo descargar', description: (error as Error).message }); }
    finally { setBusy(false); }
  };
  return { clients, models, jobs, clientId, setClientId, jobType, setJobType, modelId, setModelId,
    selectedJob, selectedPlan, preparedPlan, budgetUsd, setBudgetUsd, allowEstimatedCosts, setAllowEstimatedCosts, authorizeClassification, setAuthorizeClassification, inputSource, setInputSource, driveRows, setDriveRows, execute, resume, download, resumeBudgetUsd, setResumeBudgetUsd,
    preset, setPreset, provider, setProvider, files, changeFiles, sameItem, setSameItem, busy, error, submit, retry,
    disabledProviders: config.disabledProviders, canCreate: role.canCreateBatches };
};
