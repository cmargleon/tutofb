import { estimateGenerationHold, GEMINI_OPERATION_HOLD_USD } from '../automation/budget';
import { getAppFirestore } from '../firebase/appFirestore';
import { mapModelPhotoProviderToProvider } from '../../../shared/src/domain';
import { normalizeProviderImageConfig } from '../../../shared/src/providerImageConfig';
import type { Provider } from '../../../shared/src/types';
import type { Operation } from './registry';
export const estimateManglarAction = async (operation: Operation, data: any) => {
    let units: number | null = null;
    let initialHoldUsd: number | null = null;
    let rateEstimateUsd: number | null = null;
    const key = `${operation.domain}.${operation.action}`;
    if (['catalog.review', 'wizard.classify', 'models.classify', 'models.save'].includes(key)) {
        if (key === 'catalog.review')
            units = 1;
        if (key === 'wizard.classify')
            units = (await getAppFirestore().collection('manglarDrafts').doc(data.id).get()).data()?.items?.length ?? null;
        if (key === 'models.classify') {
            const model = (await getAppFirestore().collection('models').doc(data.modelId).get()).data();
            units = data.poseIds?.length ?? model?.poses?.length ?? null;
        }
        if (key === 'models.save') {
            const model = data.id ? (await getAppFirestore().collection('models').doc(data.id).get()).data() : null;
            units = (data.posesToAdd || []).filter((pose: any) => !pose.aiClassification).length + (model?.poses || []).filter((pose: any) => !pose.aiClassification && !data.poseIdsToRemove?.includes(pose.id)).length;
        }
        if (units !== null) {
            initialHoldUsd = units * GEMINI_OPERATION_HOLD_USD;
            rateEstimateUsd = null;
        }
    }
    else if (key === 'models.generate') {
        units = data.count;
        const provider = mapModelPhotoProviderToProvider(data.provider);
        const config = normalizeProviderImageConfig(provider, data.imageConfig, data.aspectRatio || '3:4').imageConfig;
        const hold = estimateGenerationHold(provider, config, data.referenceStoragePath ? 1 : 0);
        initialHoldUsd = hold.holdUsd * units!;
        rateEstimateUsd = hold.estimateUsd * units!;
    }
    else if (['wizard.createGarment', 'wizard.createProduct'].includes(key)) {
        const request = data.request;
        units = request.garments ? request.garments.length * request.poseIds.length : request.items.length * request.scenes.length;
        const config = normalizeProviderImageConfig(request.provider, request.imageConfig, request.aspectRatio || '3:4').imageConfig;
        const references = request.items ? Math.max(...request.items.map((item: any) => item.referencePaths.length)) : 2;
        const hold = estimateGenerationHold(request.provider as Provider, config, references);
        initialHoldUsd = (hold.holdUsd + GEMINI_OPERATION_HOLD_USD) * units!;
        rateEstimateUsd = hold.estimateUsd * units!;
    }
    return { estimatedGenerationCostUsd: rateEstimateUsd, initialReservationUsd: initialHoldUsd, units, costBasis: 'rate_card_estimates_and_conservative_holds',
        retriesIncluded: false, providerConfirmedUsd: null, note: initialHoldUsd === null ? 'No hay una estimación previa fiable para este flujo; el presupuesto limita cada llamada mediante reservas.' : 'Las reservas de Gemini son estimadas. Las combinaciones compatibles pueden reducir la cantidad; reintentos y revisiones consumen el mismo presupuesto.' };
};
