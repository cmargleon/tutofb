import { db, auth, storage } from '../../firebase';
import { collection, doc, setDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  Model,
  ModelIdentityTraits,
  ModelPoseTaggingRequest,
  ModelPoseTaggingResponse,
  PoseAiClassification,
  Pose,
  Client,
  PermanentDeleteCatalogEntityRequest,
  PermanentDeleteCatalogEntityResponse,
  GenerateModelPhotoRequest,
  GenerateModelPhotoResponse,
} from '../../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';

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

const getModelStorageRootPath = (modelId: string, clientId: string, existingRootPath?: string) =>
  existingRootPath || `models/${clientId}/${modelId}`;

interface SubscribeModelsOptions {
  includeArchived?: boolean;
}

export const subscribeToModels = (
  callback: (models: Model[]) => void,
  onError: (error: Error) => void,
  options: SubscribeModelsOptions = {},
) => {
  const q = options.includeArchived
    ? query(collection(db, 'models'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'models'), where('status', '==', 'active'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const models = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Model));
    callback(models);
  }, onError);
};

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
  const clientName = client.name;

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

    const modelData: Omit<Model, 'id'> = {
      clientId,
      clientNameSnapshot: clientName,
      name: name.trim(),
      status: 'active',
      archivedAt: null,
      archivedByUid: null,
      storageRootPath,
      poses,
      poseCount: poses.length,
      coverPoseId: poses[0]?.id || null,
      coverPosePath: poses[0]?.storagePath || null,
      generatedPhotoCount: 0,
      generatedPhotoCostUsd: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: auth.currentUser.uid
    };

    await setDoc(newModelRef, modelData);
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
  const clientNameSnapshot = client.name;
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

    const nextPoses = [...keptPoses, ...addedPoses];
    const coverPose = nextPoses[0] || null;

    await updateDoc(modelRef, {
      clientId: input.clientId,
      clientNameSnapshot,
      name: trimmedName,
      identityTraits: input.identityTraits || null,
      status: model.status ?? 'active',
      storageRootPath,
      poses: nextPoses,
      poseCount: nextPoses.length,
      coverPoseId: coverPose?.id || null,
      coverPosePath: coverPose?.storagePath || null,
      updatedAt: serverTimestamp(),
    });

    const posesToDelete = poses.filter((pose) => poseIdsToRemove.has(pose.id));
    await Promise.allSettled(
      posesToDelete.flatMap((pose) =>
        [pose.storagePath, pose.previewStoragePath]
          .filter((value): value is string => Boolean(value))
          .map((storagePath) => deleteObject(ref(storage, storagePath))),
      ),
    );
  } catch (error) {
    await Promise.allSettled(uploadedRefs.map(({ storageRef }) => deleteObject(storageRef)));
    throw error;
  }
};

export const archiveModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const modelRef = doc(db, 'models', id);
  await updateDoc(modelRef, {
    status: 'archived',
    archivedAt: serverTimestamp(),
    archivedByUid: auth.currentUser.uid,
    updatedAt: serverTimestamp(),
  });
};

export const restoreModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const modelRef = doc(db, 'models', id);
  await updateDoc(modelRef, {
    status: 'active',
    archivedAt: null,
    archivedByUid: null,
    updatedAt: serverTimestamp(),
  });
};

export const permanentlyDeleteModel = async (id: string) => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const callable = httpsCallable<PermanentDeleteCatalogEntityRequest, PermanentDeleteCatalogEntityResponse>(
    functions,
    'permanentlyDeleteModel',
  );
  await callable({ id });
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

export const tagModelPosesWithGemini = async (
  data: ModelPoseTaggingRequest,
): Promise<ModelPoseTaggingResponse> => {
  const callable = httpsCallable<ModelPoseTaggingRequest, ModelPoseTaggingResponse>(
    functions,
    'tagModelPosesWithGemini',
  );
  const result = await callable(data);
  return result.data;
};

export const createModelFromPaths = async (
  clientId: string,
  name: string,
  poses: CreateModelPoseInput[],
  options: CreateGeneratedModelOptions = {},
): Promise<string> => {
  if (!auth.currentUser) throw new Error('Usuario no autenticado');

  const clientRef = doc(db, 'clients', clientId);
  const clientSnap = await getDoc(clientRef);
  if (!clientSnap.exists()) throw new Error('Cliente no encontrado');
  const client = clientSnap.data() as Client;
  if (isArchivedCatalogEntity(client)) throw new Error('No puedes crear modelos para un cliente archivado.');

  const newModelRef = options.modelId
    ? doc(collection(db, 'models'), options.modelId)
    : doc(collection(db, 'models'));
  const modelId = newModelRef.id;
  const storageRootPath = getModelStorageRootPath(modelId, clientId);

  const poseEntries: Pose[] = poses.map(({ storagePath, contentType: _ct, aiClassification }, i) => ({
    id: uuidv4(),
    storagePath,
    fileName: storagePath.split('/').pop() ?? `pose_${i}`,
    aiClassification: aiClassification ?? null,
    createdAt: new Date().toISOString(),
  }));

  const modelData: Omit<Model, 'id'> = {
    clientId,
    clientNameSnapshot: client.name,
    name: name.trim(),
    identityTraits: options.identityTraits || null,
    status: 'active',
    archivedAt: null,
    archivedByUid: null,
    storageRootPath,
    poses: poseEntries,
    poseCount: poseEntries.length,
    coverPoseId: poseEntries[0]?.id ?? null,
    coverPosePath: poseEntries[0]?.storagePath ?? null,
    generatedPhotoCount: options.generatedPhotoCount ?? 0,
    generatedPhotoCostUsd: options.generatedPhotoCostUsd ?? 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: auth.currentUser.uid,
  };

  await setDoc(newModelRef, modelData);
  return modelId;
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
