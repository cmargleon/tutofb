import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { PublishMarketplaceImagesRequest, PublishMarketplaceImagesResponse } from '../../../shared/src/types';
import { isMarketplaceId } from '../../../shared/src/marketplaces';
import { assertCallableRoles } from '../auth/roles';
import { assertHumanClientAccess } from '../auth/clientAccess';
import { validId } from '../manglar/access';
import { loadExportContext } from '../spreadsheets/marketplaceExportService';
import { publishMarketplaceImage } from '../spreadsheets/marketplaceImages';

export const publishMarketplaceImages = onCall<PublishMarketplaceImagesRequest>(
  { timeoutSeconds: 540, memory: '1GiB', concurrency: 1 },
  async (request): Promise<PublishMarketplaceImagesResponse> => {
    await assertCallableRoles(request, ['admin', 'operador', 'revisor']);
    const input = request.data;
    if (input?.authorizePublicImages !== true) throw new HttpsError('invalid-argument', 'Autoriza la publicación pública de estas fotografías aprobadas.');
    if (!isMarketplaceId(input.marketplaceId)) throw new HttpsError('invalid-argument', 'Marketplace no disponible.');
    const context = await loadExportContext(input, request.auth!.uid);
    if (!context.client.marketplaces?.[input.marketplaceId]?.enabled) throw new HttpsError('permission-denied', 'Marketplace deshabilitado.');
    const product = context.products.find(product => product.id === validId(input.productId));
    if (!product) throw new HttpsError('not-found', 'El producto no pertenece a los lotes seleccionados.');
    if (!product.approvedImages.length) throw new HttpsError('failed-precondition', 'No hay fotografías aprobadas para publicar.');
    if (product.approvedImages.length > 20) throw new HttpsError('resource-exhausted', 'Selecciona lotes con hasta 20 fotografías aprobadas por producto.');
    const result: PublishMarketplaceImagesResponse = { images: [], failures: [] };
    for (const image of product.approvedImages) {
      await assertHumanClientAccess(request.auth!.uid, product.clientId);
      try { result.images.push(await publishMarketplaceImage(product, image, input.marketplaceId, request.auth!.uid)); }
      catch (error) {
        console.error('Marketplace image publication failed', { clientId: product.clientId, outputId: image.outputId, marketplaceId: input.marketplaceId, error });
        result.failures.push({ outputId: image.outputId, message: error instanceof HttpsError || error instanceof Error ? error.message.slice(0, 500) : 'No se pudo publicar la fotografía.' });
      }
    }
    return result;
  },
);
