import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { Model } from '../../../shared/src/types';
import { buildPoseAiClassification } from '../../../shared/src/utils/poseAiClassification';
import { GEMINI_API_KEY, getGeminiPoseClassificationModel } from '../config/runtime';
import { getAppFirestore } from '../firebase/appFirestore';
import { classifyPoseWithGemini } from '../utils/classifyPose';

/**
 * Automatically classifies new (unclassified) model poses with Gemini Vision
 * whenever a model document is created or updated.
 *
 * - Only processes poses that don't already have `aiClassification`.
 * - Errors on individual poses are caught and logged — the trigger never fails
 *   the entire batch because of one problematic image.
 * - Safe against infinite loops: the write that adds `aiClassification` will
 *   re-trigger this function, but it will exit early (no unclassified poses).
 */
export const onModelWrite = onDocumentWritten(
  { document: 'models/{modelId}', secrets: [GEMINI_API_KEY], timeoutSeconds: 540 },
  async (event) => {
    const afterSnap = event.data?.after;

    // Document was deleted — onModelDelete handles cleanup.
    if (!afterSnap?.exists) return;

    const model = { id: event.params.modelId, ...afterSnap.data() } as Model;

    if (!Array.isArray(model.poses) || model.poses.length === 0) return;

    const unclassifiedPoses = model.poses.filter((p) => !p.aiClassification);
    if (unclassifiedPoses.length === 0) return;

    console.log(
      `[onModelWrite] model=${model.id} (${model.name}) — classifying ${unclassifiedPoses.length} pose(s)`,
    );

    const apiKey = GEMINI_API_KEY.value();
    const geminiModel = getGeminiPoseClassificationModel();
    const taggedAt = admin.firestore.Timestamp.now();

    // Work on a mutable copy of the poses array.
    const updatedPoses = model.poses.map((p) => ({ ...p }));
    let classifiedCount = 0;

    for (const pose of unclassifiedPoses) {
      try {
        const result = await classifyPoseWithGemini({
          apiKey,
          model: geminiModel,
          pose,
          clientId: model.clientId,
          clientNameSnapshot: model.clientNameSnapshot,
          modelId: model.id,
          modelName: model.name,
          userUid: null,
        });

        const aiClassification = buildPoseAiClassification({
          orientationDetail: result.orientationDetail,
          framing: result.framing,
          faceVisible: result.faceVisible,
          confidence: result.confidence,
          taggedAt,
          reasoning: result.reasoning,
        });

        const idx = updatedPoses.findIndex((p) => p.id === pose.id);
        if (idx !== -1) {
          updatedPoses[idx] = { ...updatedPoses[idx], aiClassification };
          classifiedCount++;
          console.log(
            `[onModelWrite] pose=${pose.id} (${pose.fileName}) → ${aiClassification.autoCategory}`,
          );
        }
      } catch (err) {
        // Log and continue — don't block other poses due to one failure.
        console.error(`[onModelWrite] Failed to classify pose ${pose.id} (${pose.fileName}):`, err);
      }
    }

    if (classifiedCount === 0) return;

    await getAppFirestore().collection('models').doc(model.id!).update({
      poses: updatedPoses,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[onModelWrite] model=${model.id} — saved ${classifiedCount}/${unclassifiedPoses.length} classification(s)`,
    );
  },
);
