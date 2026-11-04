import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ManglarPoseClassifyRequest, Model } from '../../../shared/src/types';
import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import { getAppFirestore } from '../firebase/appFirestore';
import { classifyPoseWithGemini } from '../utils/classifyPose';
import { GEMINI_API_KEY, getGeminiPoseClassificationModel } from '../config/runtime';
import { assertResourceAccess } from './access';
import type { DelegatedCaller } from './context';
export const classifyModelPoses = async (input: ManglarPoseClassifyRequest, caller: DelegatedCaller) => {
    const model = await assertResourceAccess(caller, 'models', input.modelId) as unknown as Model;
    const selected = model.poses.filter(pose => !input.poseIds || input.poseIds.includes(pose.id));
    if (!selected.length || selected.length > 50)
        throw new HttpsError('invalid-argument', 'Selecciona entre 1 y 50 poses.');
    const classifications = new Map();
    for (const pose of selected) {
        const result = await classifyPoseWithGemini({ apiKey: GEMINI_API_KEY.value(), model: getGeminiPoseClassificationModel(), pose, clientId: model.clientId, modelId: input.modelId, userUid: caller.uid });
        classifications.set(pose.id, buildPoseAiClassification({ ...result, taggedAt: Timestamp.now() }));
    }
    const db = getAppFirestore();
    const ref = db.collection('models').doc(input.modelId);
    await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() as Model;
        if (!current || current.clientId !== model.clientId || selected.some(pose => current.poses.find(p => p.id === pose.id)?.storagePath !== pose.storagePath))
            throw new HttpsError('aborted', 'Las poses cambiaron durante la clasificación.');
        tx.update(ref, { poses: current.poses.map(pose => classifications.has(pose.id) ? { ...pose, aiClassification: classifications.get(pose.id) } : pose), updatedAt: FieldValue.serverTimestamp() });
    });
    return { modelId: input.modelId, classifiedPoseIds: [...classifications.keys()] };
};
