import { subscribeHumanQuery } from '../auth/scopedQuery';
import FileSaver from 'file-saver';
import { db, auth, storage } from '../../firebase';
import { collection, doc, onSnapshot, query, orderBy, getDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  Model,
  ImportModelBundleRequest,
  ImportModelBundleResponse,
  ModelIdentityTraits,
  PoseAiClassification,
  Pose,
  Client,
  PermanentDeleteCatalogEntityRequest,
  PermanentDeleteCatalogEntityResponse,
  GenerateModelPhotoRequest,
  GenerateModelPhotoResponse,
  GeneratedModelPhoto,
  SetModelActiveRequest,
  SetModelActiveResponse,
  SetModelPoseActiveRequest,
  SetModelPoseActiveResponse,
} from '../../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import firebaseConfig from '../../../firebase-applet-config.json';

const timeModelCall = async <T,>(stage: string, modelId: string | undefined, run: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  let outcome = 'error';
  try { const result = await run(); outcome = 'success'; return result; }
  finally { console.info('model_identity_timing', JSON.stringify({ stage, modelId, outcome, durationMs: Math.round(performance.now() - start) })); }
};

export const previewModelPhotoSets = async (data: import('../../../shared/src/types').ModelPhotoSetsRequest) =>
  (await httpsCallable<import('../../../shared/src/types').ModelPhotoSetsRequest, import('../../../shared/src/types').ModelPhotoSetsPreview>(functions, 'previewModelPhotoSets')(data)).data;
export const approveModelIdentity = async (modelId: string, poseId: string, performer: 'real' | 'synthetic') =>
  timeModelCall('approveModelIdentity', modelId, async () => (await httpsCallable<{ modelId: string; poseId: string; performer: 'real' | 'synthetic' }, import('../../../shared/src/types').ApprovedModelIdentity>(functions, 'approveModelIdentity')({ modelId, poseId, performer })).data);
export const approveGeneratedModelIdentity = async (modelId: string, storagePath: string) => {
  const model = await timeModelCall('readSavedModel', modelId, async () => (await getDoc(doc(db, 'models', modelId))).data() as Model);
  const pose = model?.poses.find(p => p.storagePath === storagePath);
  if (!pose) throw new Error('La identidad elegida no está guardada en el modelo.');
  return approveModelIdentity(modelId, pose.id, 'synthetic');
};
export const verifyModelMarketplaceBase = async (data: import('../../../shared/src/types').VerifyModelBaseRequest) =>
  (await httpsCallable<import('../../../shared/src/types').VerifyModelBaseRequest, import('../../../shared/src/types').VerifyModelBaseResponse>(functions, 'verifyModelMarketplaceBase', { timeout: 300000 })(data)).data;
export const generateModelMarketplaceBase = async (data: import('../../../shared/src/types').GenerateModelBaseRequest) =>
  (await httpsCallable<import('../../../shared/src/types').GenerateModelBaseRequest, import('../../../shared/src/types').VerifyModelBaseResponse>(functions, 'generateModelMarketplaceBase', { timeout: 540000 })(data)).data;

interface UpdateModelInput {
  name: string;
  clientId: string;
  identityTraits?: ModelIdentityTraits | null;
  filesToAdd?: File[];
  poseIdsToRemove?: string[];
}

interface CreateGeneratedModelOptions {
  modelId?: string;
  generatedPhotoCount?: number;
  generatedPhotoCostUsd?: number;
  identityTraits?: ModelIdentityTraits | null;
}

interface UploadedModelReference {
  storagePath: string;
  contentType: string;
}

interface CreateModelPoseInput {
  storagePath: string;
  contentType: string;
  aiClassification?: PoseAiClassification | null;
}

const sanitizeFileName = (fileName: string) => fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
const { saveAs } = FileSaver;

const getModelStorageRootPath = (modelId: string, clientId: string, existingRootPath?: string) =>
  existingRootPath || `models/${clientId}/${modelId}`;

const buildModelBundleFilename = (model: Model) =>
  [
    sanitizeFileName(model.clientNameSnapshot || 'cliente'),
    sanitizeFileName(model.name || 'modelo'),
    sanitizeFileName(model.id || 'model'),
  ].join('_');

const getModelBundleDownloadUrl = (): string => {
  const projectId = firebaseConfig.projectId;
  if (!projectId) {
    throw new Error('No se encontró el projectId de Firebase para exportar el modelo.');
  }

  if (import.meta.env?.VITE_USE_FIREBASE_EMULATORS === 'true') {
    return `http://127.0.0.1:5001/${projectId}/us-central1/downloadModelBundle`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net/downloadModelBundle`;
};

interface SubscribeModelsOptions {
  clientId?: string;
  includeArchived?: boolean;
  includeInactive?: boolean;
}

export const subscribeToModels = (
  callback: (models: Model[]) => void,
  onError: (error: Error) => void,
  options: SubscribeModelsOptions = {},
) => {
  const base = options.clientId ? query(collection(db, 'models'), where('clientId', '==', options.clientId)) : collection(db, 'models');
  const q = options.includeArchived
    ? query(base, orderBy('createdAt', 'desc'))
    : query(base, where('status', '==', 'active'), orderBy('createdAt', 'desc'));
  return subscribeHumanQuery(q, 'clientId', (snapshot) => {
    const models = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Model));
    callback(options.includeInactive ? models : models.filter((model) => model.active !== false));
  }, onError);
};

export const subscribeToModel = (
  modelId: string,
  callback: (model: Model | null) => void,
  onError: (error: Error) => void,
) => onSnapshot(doc(db, 'models', modelId), (snapshot) => {
  callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Model : null);
}, onError);

export const createModel = async (
  clientId: string,
  name: string,
  files: File[],
) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const clientRef = doc(db, 'clients', clientId);
  const clientSnap = await getDoc(clientRef);
  if (!clientSnap.exists()) throw new Error('Cliente no encontrado');
  const client = clientSnap.data() as Client;
  if (isArchivedCatalogEntity(client)) throw new Error('No puedes crear modelos para un cliente archivado.');

  const newModelRef = doc(collection(db, 'models'));
  const modelId = newModelRef.id;
  const storageRootPath = getModelStorageRootPath(modelId, clientId);

  const poses: Pose[] = [];
  const uploadedRefs: any[] = [];

  try {
    // Upload images
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const poseId = uuidv4();
      const fileName = sanitizeFileName(file.name);
      const storagePath = `${storageRootPath}/poses/${poseId}-${fileName}`;
      const storageRef = ref(storage, storagePath);
      
      // Add a timeout to uploadBytes to prevent hanging
      const uploadPromise = uploadBytes(storageRef, file);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('El tiempo de subida ha expirado. Verifica tu conexión o la configuración de Firebase Storage.')), 30000)
      );
      
      await Promise.race([uploadPromise, timeoutPromise]);
      uploadedRefs.push(storageRef);

      poses.push({
        id: poseId,
        storagePath,
        fileName,
        createdAt: new Date().toISOString() // Using ISO string for simplicity in array
      });
    }

    await httpsCallable<import('../../../shared/src/types').ManglarModelSaveRequest, { id: string }>(functions, 'saveModel')({
      id: modelId, clientId, name, posesToAdd: poses.map((pose) => ({ storagePath: pose.storagePath, fileName: pose.fileName, aiClassification: pose.aiClassification })),
    });
    return modelId;
  } catch (error) {
    console.error('Error in createModel:', error);
    // Cleanup best effort
    for (const storageRef of uploadedRefs) {
      try {
        await deleteObject(storageRef);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    throw error;
  }
};

export const updateModel = async (id: string, input: UpdateModelInput) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');
  const trimmedName = input.name.trim();
  if (!trimmedName || !input.clientId) {
    throw new Error('Completa el nombre y el cliente del modelo.');
  }

  const modelRef = doc(db, 'models', id);
  const [modelSnap, clientSnap] = await Promise.all([
    getDoc(modelRef),
    getDoc(doc(db, 'clients', input.clientId)),
  ]);

  if (!modelSnap.exists()) {
    throw new Error('Modelo no encontrado');
  }

  if (!clientSnap.exists()) {
    throw new Error('Cliente no encontrado');
  }

  const model = modelSnap.data() as Model;
  const client = clientSnap.data() as Client;
  if (isArchivedCatalogEntity(model)) {
    throw new Error('No puedes editar un modelo archivado. Reactívalo primero.');
  }
  if (isArchivedCatalogEntity(client)) {
    throw new Error('No puedes mover un modelo a un cliente archivado.');
  }
  const storageRootPath = getModelStorageRootPath(id, model.clientId, model.storageRootPath);
  const filesToAdd = input.filesToAdd || [];
  const poseIdsToRemove = new Set(input.poseIdsToRemove || []);
  const poses = Array.isArray(model.poses) ? model.poses : [];
  const keptPoses = poses.filter((pose) => !poseIdsToRemove.has(pose.id));

  if (keptPoses.length === 0 && filesToAdd.length === 0) {
    throw new Error('Debes conservar al menos una pose o agregar una nueva.');
  }

  const uploadedRefs: Array<{ storageRef: ReturnType<typeof ref>; previewStoragePath?: string | null }> = [];
  const addedPoses: Pose[] = [];

  try {
    for (const file of filesToAdd) {
      const poseId = uuidv4();
      const fileName = sanitizeFileName(file.name);
      const storagePath = `${storageRootPath}/poses/${poseId}-${fileName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      uploadedRefs.push({ storageRef });
      addedPoses.push({
        id: poseId,
        storagePath,
        fileName,
        createdAt: new Date().toISOString(),
      });
    }

    await httpsCallable<import('../../../shared/src/types').ManglarModelSaveRequest, { id: string }>(functions, 'saveModel')({
      id, clientId: input.clientId, name: trimmedName,
      ...(input.identityTraits !== undefined ? { identityTraits: input.identityTraits } : {}),
      posesToAdd: addedPoses.map((pose) => ({ storagePath: pose.storagePath, fileName: pose.fileName })), poseIdsToRemove: [...poseIdsToRemove],
    });


  } catch (error) {
    await Promise.allSettled(uploadedRefs.map(({ storageRef }) => deleteObject(storageRef)));
    throw error;
  }
};

export const archiveModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  await httpsCallable<{ id: string; archived: boolean }, unknown>(functions, 'setModelArchived')({ id, archived: true });
};

export const setModelActive = async (input: SetModelActiveRequest): Promise<SetModelActiveResponse> => {
  const callable = httpsCallable<SetModelActiveRequest, SetModelActiveResponse>(functions, 'setModelActive');
  return (await callable(input)).data;
};

export const setModelPoseActive = async (input: SetModelPoseActiveRequest): Promise<SetModelPoseActiveResponse> => {
  const callable = httpsCallable<SetModelPoseActiveRequest, SetModelPoseActiveResponse>(functions, 'setModelPoseActive');
  return (await callable(input)).data;
};

export const restoreModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  await httpsCallable<{ id: string; archived: boolean }, unknown>(functions, 'setModelArchived')({ id, archived: false });
};

export const permanentlyDeleteModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const callable = httpsCallable<PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse>(
    functions,
    'permanentlyDeleteModel',
  );
  await callable({ id });
};

export const downloadModelBundle = async (model: Model): Promise<void> => {
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado');
  }

  if (!model.id) {
    throw new Error('Modelo no encontrado.');
  }

  const idToken = await auth.currentUser.getIdToken();
  let response: globalThis.Response;

  try {
    response = await fetch(getModelBundleDownloadUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelId: model.id }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'No se pudo conectar con la función de exportación. Si estás en localhost, reinicia o despliega Functions para aplicar el cambio.',
      );
    }

    throw error;
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `No se pudo exportar el modelo (${response.status}).`;

    try {
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as { message?: string };
        if (payload.message) {
          message = payload.message;
        }
      } else {
        const text = (await response.text()).trim();
        if (text) {
          message = text;
        }
      }
    } catch {
      // Conservamos el mensaje por defecto si la respuesta no se puede parsear.
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as { downloadUrl: string; filename: string };
  saveAs(payload.downloadUrl, payload.filename);
};

export const importModelBundle = async (
  clientId: string,
  file: File,
): Promise<ImportModelBundleResponse> => {
  if (!auth.currentUser) {
    throw new Error('Usuario no autenticado');
  }

  const storagePath = `model_imports/${auth.currentUser.uid}/${crypto.randomUUID()}/${sanitizeFileName(file.name)}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, { contentType: file.type || 'application/zip' });

  const callable = httpsCallable<ImportModelBundleRequest, ImportModelBundleResponse>(
    functions,
    'importModelBundle',
    { timeout: 300000 },
  );

  try {
    const result = await callable({
      clientId,
      storagePath,
      originalFileName: file.name,
    });

    return result.data;
  } catch (error) {
    await deleteObject(storageRef).catch(() => undefined);
    throw error;
  }
};

export const generateModelPoses = async (
  data: GenerateModelPhotoRequest,
): Promise<GenerateModelPhotoResponse> => {
  const callable = httpsCallable<GenerateModelPhotoRequest, GenerateModelPhotoResponse>(
    functions,
    'generateModelPose',
    { timeout: 300000 }, // 5 min — generation can take 90s+ with multiple images
  );
  const result = await callable(data);
  return result.data;
};

export const replaceModelPoseWithGeneratedPhoto = async (
  model: Model,
  poseId: string,
  generatedPhoto: GeneratedModelPhoto,
  nextAiClassification?: PoseAiClassification | null,
  estimatedCostUsd = 0,
): Promise<void> => {
  if (!model.id) throw new Error('Modelo no encontrado.');

  const targetPose = (model.poses || []).find((pose) => pose.id === poseId);
  if (!targetPose) {
    throw new Error('La pose a regenerar ya no existe en el modelo.');
  }

  await httpsCallable<import('../../../shared/src/types').ManglarPoseReplaceRequest, unknown>(functions, 'replaceModelPose')({
    modelId: model.id, poseId, storagePath: generatedPhoto.storagePath, aiClassification: nextAiClassification, estimatedCostUsd,
  });
};

export const uploadModelReferenceFile = async (
  clientId: string,
  modelId: string,
  file: File,
): Promise<UploadedModelReference> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const fileName = sanitizeFileName(file.name || 'referencia.png');
  const storagePath = `garments/drafts/${auth.currentUser.uid}/${modelId}/reference/${uuidv4()}-${fileName}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'image/png',
  });

  return {
    storagePath,
    contentType: file.type || 'image/png',
  };
};

export const deleteStorageAsset = async (storagePath: string): Promise<void> => {
  await deleteObject(ref(storage, storagePath));
};

export const createModelFromPaths = async (
  clientId: string,
  name: string,
  poses: CreateModelPoseInput[],
  options: CreateGeneratedModelOptions = {},
): Promise<string> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  return timeModelCall('saveModel', options.modelId, async () => (await httpsCallable<import('../../../shared/src/types').ManglarModelSaveRequest, { id: string }>(functions, 'saveModel')({
    ...(options.modelId ? { id: options.modelId } : {}), clientId, name, identityTraits: options.identityTraits,
    posesToAdd: poses.map((pose, index) => ({ storagePath: pose.storagePath, fileName: pose.storagePath.split('/').pop() || `pose_${index}`, aiClassification: pose.aiClassification })),
    generatedPhotoCount: options.generatedPhotoCount, generatedPhotoCostUsd: options.generatedPhotoCostUsd,
  })).data.id);
};

export const getImageUrl = async (storagePath: string): Promise<string> => {
  try {
    if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) {
      return storagePath;
    }
    const imageRef = ref(storage, storagePath);
    return await getDownloadURL(imageRef);
  } catch (error) {
    console.error('Error getting download URL:', error);
    return '';
  }
};

export const verifyMarketplacePhotoBases = async (modelId: string, poseIds: string[]) =>
  (await httpsCallable<{ modelId: string; poseIds: string[] }, { modelId: string; observations: Record<string, import('../../../shared/src/types').PhotoBaseObservation> }>(functions, 'verifyMarketplacePhotoBases', { timeout: 300000 })({ modelId, poseIds })).data;

export const scheduleModelMarketplaceSets = async (data: import('../../../shared/src/types').ScheduleModelPhotoSetsRequest) =>
  (await httpsCallable<import('../../../shared/src/types').ScheduleModelPhotoSetsRequest, { operationIds: string[] }>(functions, 'scheduleModelMarketplaceSets')(data)).data;
export const subscribeModelBaseOperations = (modelId: string, next: (operations: import('../../../shared/src/types').ModelBaseOperation[]) => void, error: (error: Error) => void) =>
  onSnapshot(collection(db, 'models', modelId, 'baseOperations'), snapshot => next(snapshot.docs.filter(doc => doc.get('spec')).map(doc => ({ ...doc.data(), id: doc.id } as import('../../../shared/src/types').ModelBaseOperation))), error);
