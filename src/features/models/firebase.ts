import FileSaver from 'file-saver';
import { db, auth, storage } from '../../firebase';
import { collection, doc, setDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp, getDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, getBytes } from 'firebase/storage';
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
} from '../../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';
import { isArchivedCatalogEntity } from '../../../shared/src/domain';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import firebaseConfig from '../../../firebase-applet-config.json';

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

  const modelRef = doc(db, 'models', model.id);
  const storageRootPath = getModelStorageRootPath(model.id, model.clientId, model.storageRootPath);
  const sourceRef = ref(storage, generatedPhoto.storagePath);
  const imageBytes = await getBytes(sourceRef);
  const imageBlob = new Blob([imageBytes], { type: generatedPhoto.contentType || 'image/png' });
  const extension = generatedPhoto.contentType.includes('jpeg') || generatedPhoto.contentType.includes('jpg')
    ? 'jpg'
    : 'png';
  const replacementStoragePath = `${storageRootPath}/poses/${poseId}-regen-${Date.now()}.${extension}`;
  const replacementRef = ref(storage, replacementStoragePath);

  try {
    await uploadBytes(replacementRef, imageBlob, {
      contentType: generatedPhoto.contentType || imageBlob.type || 'image/png',
    });

    const nextPoses = (model.poses || []).map((pose) =>
      pose.id === poseId
        ? {
            ...pose,
            storagePath: replacementStoragePath,
            fileName: replacementStoragePath.split('/').pop() ?? pose.fileName,
            previewStoragePath: null,
            aiClassification: nextAiClassification ?? pose.aiClassification ?? null,
          }
        : pose,
    );

    await updateDoc(modelRef, {
      poses: nextPoses,
      coverPosePath:
        model.coverPoseId === poseId
          ? replacementStoragePath
          : model.coverPosePath || nextPoses[0]?.storagePath || null,
      generatedPhotoCount: (model.generatedPhotoCount || 0) + 1,
      generatedPhotoCostUsd: Number(model.generatedPhotoCostUsd || 0) + Number(estimatedCostUsd || 0),
      updatedAt: serverTimestamp(),
    });

    await Promise.allSettled(
      [targetPose.storagePath, targetPose.previewStoragePath, generatedPhoto.storagePath]
        .filter((value): value is string => Boolean(value))
        .map((storagePath) => deleteObject(ref(storage, storagePath))),
    );
  } catch (error) {
    await Promise.allSettled([
      deleteObject(replacementRef),
      deleteObject(ref(storage, generatedPhoto.storagePath)),
    ]);
    throw error;
  }
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
