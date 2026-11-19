import { isSpreadsheetTemplateActive, type SpreadsheetTemplate } from '../../../shared/src/types';
import { MARKETPLACES } from '../../../shared/src/marketplaces';

/**
 * Las plantillas oficiales subidas por marketplace son la fuente de verdad del cliente.
 * Solo se ofrecen las activas, configuradas (compatibles) y no sustituidas por otra versión.
 */
export const isUsableMarketplaceTemplate = (template: SpreadsheetTemplate) =>
  isSpreadsheetTemplateActive(template)
  && template.exportConfig?.validationStatus === 'compatible'
  && !template.exportConfig.supersededByTemplateId;

export const marketplaceTemplateLabel = (template: SpreadsheetTemplate) => {
  const channel = MARKETPLACES.find(m => m.id === template.exportConfig?.marketplaceId)?.name;
  return channel ? `${channel} · ${template.name}` : template.name;
};

/** Plantillas archivadas que el usuario puede desarchivar (las versiones sustituidas quedan como historial). */
export const isRestorableArchivedTemplate = (template: SpreadsheetTemplate) =>
  template.status === 'archived' && !template.exportConfig?.supersededByTemplateId;
