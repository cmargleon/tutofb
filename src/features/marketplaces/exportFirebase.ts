import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import type { ConfigureMarketplaceTemplateRequest, DownloadMarketplaceExportRequest, DownloadMarketplaceExportResponse, MarketplaceExportPreview, MarketplaceExportScope, SaveMasterProductRequest } from '../../../shared/src/types';
export const previewMarketplaceExports = async (data: MarketplaceExportScope) => (await httpsCallable<MarketplaceExportScope, MarketplaceExportPreview>(functions, 'previewMarketplaceExports', { timeout: 540000 })(data)).data;
export const downloadMarketplaceExports = async (data: DownloadMarketplaceExportRequest) => (await httpsCallable<DownloadMarketplaceExportRequest, DownloadMarketplaceExportResponse>(functions, 'downloadMarketplaceExports', { timeout: 540000 })(data)).data;
export const saveMasterProduct = async (data: SaveMasterProductRequest) => (await httpsCallable<SaveMasterProductRequest, { success: boolean; revision: number }>(functions, 'saveMasterProduct', { timeout: 540000 })(data)).data;
export const configureMarketplaceTemplate = async (data: ConfigureMarketplaceTemplateRequest) => (await httpsCallable<ConfigureMarketplaceTemplateRequest, { success: boolean; templateId: string }>(functions, 'configureMarketplaceTemplate', { timeout: 540000 })(data)).data;
export const archiveMarketplaceTemplate = async (clientId: string, templateId: string) => (await httpsCallable<{ clientId: string; templateId: string }, { success: boolean }>(functions, 'archiveMarketplaceTemplate')({ clientId, templateId })).data;
